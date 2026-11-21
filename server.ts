import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { URL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
import service from "./service.mjs";
import { SQL } from "bun";
const { db: computeDb } = service.load();
const serviceSecrets = service.input();
const sessionSecret = serviceSecrets.sessionSecret.expose();
const adminSecret = serviceSecrets.adminKey.expose();
const sql = new SQL({ url: computeDb.url, max: 1, idleTimeout: 10, prepare: false });
const LEGACY_DATA = path.join(ROOT, 'data', 'db.json');
function emptyDbState() {
  return { users: [], transactions: [], conversionRequests: [], withdrawalRequests: [], activationRequests: [], upgradeRequests: [], settings: { conversionFee: 0.071, activationFee: 8300, activationBankName: 'Moniepoint MFB', activationAccountNumber: '0000000000', activationAccountHolder: 'Nixi Platform', brand: 'APiX', mode: 'sandbox', upgradeAccounts: {} } };
}
async function load() {
  const rows = await sql`SELECT payload FROM nixi_app_state WHERE id = 'main'`;
  if (rows.length === 0) {
    let seed = emptyDbState();
    try { if (fs.existsSync(LEGACY_DATA)) seed = JSON.parse(fs.readFileSync(LEGACY_DATA, 'utf8')); } catch (err) { console.warn('Legacy JSON seed could not be read:', err.message); }
    await sql`INSERT INTO nixi_app_state (id, payload) VALUES ('main', ${JSON.stringify(seed)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    return load();
  }
  const db = rows[0].payload || emptyDbState();
  db.users ||= []; db.transactions ||= []; db.conversionRequests ||= []; db.withdrawalRequests ||= []; db.activationRequests ||= []; db.upgradeRequests ||= []; db.settings ||= {};
  for (const user of db.users) {
    if (typeof user.convertedAPX !== 'number') user.convertedAPX = db.conversionRequests.filter(c => c.userId === user.id).reduce((sum,c) => sum + Number(c.amount || 0), 0);
  }
  db.settings.activationFee ??= 8300; db.settings.upgradeAccounts ||= {};
  for (const lv of [2,3,4,5]) db.settings.upgradeAccounts[String(lv)] ||= { bankName: 'Moniepoint MFB', accountNumber: '0000000000', accountHolder: 'Nixi Platform' };
  return db;
}
async function save(db) {
  await sql`INSERT INTO nixi_app_state (id, payload) VALUES ('main', ${JSON.stringify(db)}::jsonb) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
}
const LEVELS = [
  { level: 1, name: 'Starter', fee: 0, perTap: 700, taps: 5, hours: 13, color: 'blue', perks: ['Starter access', 'Basic withdrawals after activation', 'Standard support'] },
  { level: 2, name: 'Silver', fee: 20000, perTap: 2800, taps: 5, hours: 8, color: 'silver', perks: ['4× earning rate vs Level 1', 'Faster 8h tap window', 'Priority withdrawal queue', 'Silver badge', 'Weekly bonus drops'] },
  { level: 3, name: 'Gold', fee: 30000, perTap: 5000, taps: 4, hours: 24, color: 'gold', perks: ['Premium ₦5,000 per tap', 'Reduced conversion fee', 'Gold badge', 'Instant review queue', 'Early feature access', 'Referral bonus'] },
  { level: 4, name: 'Mamba', fee: 55000, perTap: 12000, taps: 5, hours: 16, color: 'green', perks: ['Elite ₦12,000 per tap', 'Zero conversion fee', 'Animated badge', 'Same-day review', 'VIP support', 'Referral bonus'] },
  { level: 5, name: 'Alpha-Apix', fee: 100000, perTap: 25000, taps: 4, hours: 24, color: 'amber', perks: ['Highest tap rate', 'Unlimited withdrawal requests', '0% conversion fee', 'Alpha crown badge', 'Account manager', 'Monthly loyalty drops', 'VIP status'] }
];
const BANKS = ['Access Bank','Access Bank (Diamond)','ALAT by Wema','ASO Savings and Loans','Bayern Microfinance Bank','CEMCS Microfinance Bank','Citibank Nigeria','Coronation Merchant Bank','Ecobank Nigeria','Ekondo Microfinance Bank','Eyowo','FCMB','Fidelity Bank','First Bank of Nigeria','Globus Bank','GTBank','Heritage Bank','Jaiz Bank','Keystone Bank','Kuda Bank','Lotus Bank','Moniepoint MFB','OPay','PalmPay','Polaris Bank','Providus Bank','Stanbic IBTC','Sterling Bank','UBA','Union Bank','Unity Bank','Wema Bank','Zenith Bank'];

function id(prefix='id') { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function hash(password, salt=crypto.randomBytes(16).toString('hex')) { return salt + ':' + crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); }
function verify(password, stored) { try { if (typeof stored !== 'string' || !stored.includes(':')) return false; const [salt, digest] = stored.split(':'); const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256'); const expected = Buffer.from(digest, 'hex'); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual); } catch { return false; } }
function tokenFor(userId) { return crypto.createHmac('sha256', sessionSecret).update(userId).digest('hex') + '.' + userId; }
async function userFromReq(req) { const t = req.headers.authorization?.replace(/^Bearer\s+/i,''); if (!t) return null; const [, uid] = t.split('.'); if (!uid) return null; const expected = tokenFor(uid); if (t !== expected) return null; const db = await load(); return db.users.find(u => u.id === uid) || null; }
function json(res, code, data) { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function parseBody(req) { return new Promise((resolve,reject)=>{ let body=''; req.on('data',c=>{body+=c; if(body.length>12e6){req.destroy(); reject(new Error('Body too large'));}}); req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch(e){reject(e);}}); }); }
function sanitizeUser(u) { const {passwordHash,...safe}=u; return safe; }
function levelOf(n) { return LEVELS.find(x=>x.level===n) || LEVELS[0]; }
function tx(db, userId, type, amount, meta={}) { db.transactions.unshift({id:id('tx'), userId, type, amount, meta, createdAt:new Date().toISOString()}); }
function publicStats(user, db) {
  const level=levelOf(user.level);
  const recent=db.transactions.filter(t=>t.userId===user.id).slice(0,50);
  const pendingUpgrade=db.upgradeRequests.find(x=>x.userId===user.id&&x.status==='pending') || null;
  return {
    user:sanitizeUser(user), level, levels:LEVELS, transactions:recent, banks:BANKS,
    conversionFee: user.level>=4?0:(user.level===3?0.02:db.settings.conversionFee),
    activationFee:db.settings.activationFee,
    activationAccount:{bankName:db.settings.activationBankName,accountNumber:db.settings.activationAccountNumber,holder:db.settings.activationAccountHolder},
    upgradeAccounts:db.settings.upgradeAccounts,
    pendingUpgrade: pendingUpgrade ? {id:pendingUpgrade.id,toLevel:pendingUpgrade.toLevel,status:pendingUpgrade.status,fee:pendingUpgrade.fee,createdAt:pendingUpgrade.createdAt} : null
  };
}

async function route(req,res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p=u.pathname;
  try {
    if(req.method==='GET' && p==='/api/health') return json(res,200,{ok:true,brand:'Nixi',mode:'sandbox'});
    if(req.method==='GET' && p==='/api/config') { const db=await load(); return json(res,200,{brand:'Nixi',levels:LEVELS,banks:BANKS,conversionFee:db.settings.conversionFee,activationFee:db.settings.activationFee,activationAccount:{bankName:db.settings.activationBankName,accountNumber:db.settings.activationAccountNumber,holder:db.settings.activationAccountHolder},support:{telegram:db.settings.supportTelegram||'',email:db.settings.supportEmail||''},mode:db.settings.mode}); }
    if(req.method==='POST' && p==='/api/auth/register') {
      const b=await parseBody(req); if(!b.username||!String(b.username).trim()||!b.email||!b.password) return json(res,400,{error:'Username, email and password are required.'});
      const email=String(b.email).trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json(res,400,{error:'Enter a valid email address.'});
      const domain=email.split('@')[1];
      // Reject duplicates before DNS so returning users are not delayed by domain lookups.
      if((await load()).users.some(x=>String(x.email||'').trim().toLowerCase()===email)) return json(res,409,{error:'Email already registered.'});
      const disposable=new Set(['mailinator.com','10minutemail.com','tempmail.com','guerrillamail.com','yopmail.com','temp-mail.org','getnada.com','trashmail.com','dispostable.com']);
      if(disposable.has(domain)) return json(res,400,{error:'Temporary or disposable email addresses are not accepted. Use your personal email.'});
      // DNS checks are useful but should not hold registration for many seconds.
      // A short timeout allows registration to continue if the host's DNS resolver is temporarily slow.
      const dnsCheck = (async () => {
        try { const mx = await dns.resolveMx(domain); if (mx && mx.length) return true; }
        catch (e) { if (!['ENODATA','ENOTFOUND','ENONAME'].includes(e.code)) return true; }
        try { await dns.resolve4(domain); return true; }
        catch (e) { if (['ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','SERVFAIL'].includes(e.code)) return true; return false; }
      })();
      const domainExists = await Promise.race([dnsCheck, new Promise(resolve => setTimeout(() => resolve(true), 2500))]);
      if (!domainExists) return json(res,400,{error:'This email domain does not appear to exist. Check your email address.'});
      const password=String(b.password);
      if(password.length<6 || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return json(res,400,{error:'Password must be at least 6 characters and include a number and a special character.'});
      const db=await load(); if(db.users.some(x=>x.email.toLowerCase()===email)) return json(res,409,{error:'Email already registered.'});
      const user={id:id('usr'),username:b.username.trim(),email,passwordHash:hash(password),balance:155000,ngnBalance:0,convertedAPX:0,level:1,totalTaps:0,activated:false,joinedAt:new Date().toISOString(),lastTapAt:null,bank:null};
      db.users.push(user); tx(db,user.id,'bonus',155000,{label:'Welcome bonus'}); await save(db); return json(res,201,{token:tokenFor(user.id),...publicStats(user,db)});
    }
    if(req.method==='POST' && p==='/api/auth/login') {
      const b=await parseBody(req); const db=await load(); const loginEmail=String(b.email||'').trim().toLowerCase(); const user=db.users.find(x=>String(x.email||'').trim().toLowerCase()===loginEmail);
      if(!user || !verify(String(b.password||''),user.passwordHash)) return json(res,401,{error:'Invalid email or password.'});
      return json(res,200,{token:tokenFor(user.id),...publicStats(user,db)});
    }
    if(req.method==='GET' && p==='/api/me') { const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'}); const db=await load(); return json(res,200,publicStats(user,db)); }
    if(req.method==='POST' && p==='/api/tap') {
      const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'}); const db=await load();
      const lv=levelOf(user.level); const now=Date.now(); const since=now-lv.hours*3600*1000; const recent=db.transactions.filter(t=>t.userId===user.id && t.type==='tap' && new Date(t.createdAt).getTime()>=since); if(recent.length>=lv.taps) return json(res,429,{error:`Tap limit reached. Try again after the ${lv.hours}-hour window.`});
      user.balance += lv.perTap; user.totalTaps += 1; user.lastTapAt=new Date().toISOString(); tx(db,user.id,'tap',lv.perTap,{level:user.level}); await save(db); return json(res,200,publicStats(user,db));
    }
    if(req.method==='POST' && p==='/api/convert') {
      const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'}); const db=await load(); const amount=Number((await parseBody(req)).amount); if(!Number.isFinite(amount)||!Number.isSafeInteger(amount)||amount<=0||amount>user.balance)return json(res,400,{error:'Invalid amount.'});
      const feeRate=user.level>=4?0:(user.level===3?0.02:db.settings.conversionFee); const fee=amount*feeRate; const receive=amount-fee; user.balance-=amount; user.ngnBalance+=receive; user.convertedAPX=(Number(user.convertedAPX)||0)+amount; db.conversionRequests.unshift({id:id('conv'),userId:user.id,amount,fee,receive,status:'completed',createdAt:new Date().toISOString()}); tx(db,user.id,'conversion',-amount,{fee,receive}); await save(db); return json(res,200,publicStats(user,db));
    }
    if(req.method==='POST' && p==='/api/withdraw') {
      const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'}); if(!user.activated)return json(res,403,{error:'Account activation is required before withdrawals.'});
      const b=await parseBody(req), amount=Number(b.amount); if(!Number.isFinite(amount)||amount<=0||amount>user.ngnBalance)return json(res,400,{error:'Invalid withdrawal amount.'});
      user.ngnBalance-=amount; const db=await load(); const w={id:id('wd'),userId:user.id,amount,bank:b.bank||user.bank||null,accountName:b.accountName||'',accountNumber:b.accountNumber||'',status:'pending',createdAt:new Date().toISOString()}; db.withdrawalRequests.unshift(w); tx(db,user.id,'withdrawal',-amount,{status:'pending'}); await save(db); return json(res,201,{request:w,...publicStats(user,db)});
    }
    if(req.method==='POST' && p==='/api/activation') {
      const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'}); const db=await load(); const b=await parseBody(req); const existing=db.activationRequests.find(x=>x.userId===user.id&&x.status==='pending'); if(existing)return json(res,409,{error:'Activation already pending.'});
      if(!b.receiptData || !b.receiptName) return json(res,400,{error:'Please upload your transaction receipt first.'});
      const match=String(b.receiptData).match(/^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$/); if(!match) return json(res,400,{error:'Receipt must be PNG, JPG, WEBP, or PDF.'});
      const ext=match[1].includes('pdf')?'pdf':match[1].split('/')[1].replace('jpeg','jpg'); const rid=id('receipt'); const fileName=rid+'.'+ext; fs.writeFileSync(path.join(UPLOADS,fileName),Buffer.from(match[2],'base64'));
      const a={id:id('act'),userId:user.id,fee:db.settings.activationFee,bankName:db.settings.activationBankName,accountNumber:db.settings.activationAccountNumber,holder:db.settings.activationAccountHolder,receiptName:b.receiptName,receiptFile:fileName,status:'pending',createdAt:new Date().toISOString()}; db.activationRequests.unshift(a); await save(db); return json(res,201,{request:{...a,receiptFile:undefined}});
    }
    if(req.method==='POST' && p==='/api/upgrade') {
      const user=await userFromReq(req); if(!user)return json(res,401,{error:'Unauthorized'});
      const db=await load(); const b=await parseBody(req); const to=Number(b.level); const target=levelOf(to);
      if(!target || to<=user.level || to>5)return json(res,400,{error:'Invalid upgrade level.'});
      const existing=db.upgradeRequests.find(x=>x.userId===user.id&&x.status==='pending');
      if(existing)return json(res,409,{error:'You already have a pending upgrade request.'});
      if(!target || target.level<2)return json(res,400,{error:'Invalid upgrade level.'});
      if(!b.receiptData || !b.receiptName)return json(res,400,{error:'Please upload your upgrade receipt first.'});
      const match=String(b.receiptData).match(/^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$/);
      if(!match)return json(res,400,{error:'Receipt must be PNG, JPG, WEBP, or PDF.'});
      const ext=match[1].includes('pdf')?'pdf':match[1].split('/')[1].replace('jpeg','jpg');
      const rid=id('upgrade_receipt'); const fileName=rid+'.'+ext;
      fs.writeFileSync(path.join(UPLOADS,fileName),Buffer.from(match[2],'base64'));
      const acc=db.settings.upgradeAccounts[String(to)] || {bankName:'',accountNumber:'',accountHolder:''};
      const r={id:id('upg'),userId:user.id,fromLevel:user.level,toLevel:to,levelName:target.name,fee:target.fee,bankName:acc.bankName,accountNumber:acc.accountNumber,holder:acc.accountHolder,receiptName:b.receiptName,receiptFile:fileName,status:'pending',createdAt:new Date().toISOString()};
      db.upgradeRequests.unshift(r); await save(db); return json(res,201,{request:{...r,receiptFile:undefined},...publicStats(user,db)});
    }
    if(req.method==='GET' && p==='/api/admin/summary') {
      const a=admin(req); if(!a)return json(res,403,{error:'Admin only'}); const db=await load(); const activatedUsers=db.users.filter(x=>x.activated===true).length; const upgradedUsers=new Set(db.upgradeRequests.filter(x=>x.status==='approved').map(x=>x.userId)).size || db.users.filter(x=>Number(x.level)>1).length; return json(res,200,{users:db.users.map(sanitizeUser),transactions:db.transactions,activations:db.activationRequests,withdrawals:db.withdrawalRequests,conversions:db.conversionRequests,upgrades:db.upgradeRequests,settings:db.settings,stats:{totalUsers:db.users.length,activatedUsers,upgradedUsers}});
    }
    if(req.method==='POST' && p==='/api/admin/review') {
      const a=admin(req); if(!a)return json(res,403,{error:'Admin only'}); const b=await parseBody(req); const db=await load();
      if(b.kind==='activation'){const r=db.activationRequests.find(x=>x.id===b.id); if(!r)return json(res,404,{error:'Not found'}); r.status=b.status; const u=db.users.find(x=>x.id===r.userId); if(u&&b.status==='approved')u.activated=true;}
      if(b.kind==='withdrawal'){const r=db.withdrawalRequests.find(x=>x.id===b.id); if(!r)return json(res,404,{error:'Not found'}); r.status=b.status; if(b.status==='rejected'){const u=db.users.find(x=>x.id===r.userId); if(u)u.ngnBalance+=r.amount;}}
      if(b.kind==='upgrade'){
        const r=db.upgradeRequests.find(x=>x.id===b.id); if(!r)return json(res,404,{error:'Not found'});
        if(!['approved','rejected'].includes(b.status))return json(res,400,{error:'Invalid review status.'});
        if(r.status!=='pending')return json(res,409,{error:'This upgrade request has already been reviewed.'});
        r.status=b.status; r.reviewedAt=new Date().toISOString();
        if(b.status==='approved'){
          const u=db.users.find(x=>x.id===r.userId);
          if(!u)return json(res,404,{error:'User not found'});
          if(u.level!==r.fromLevel)return json(res,409,{error:'User level has changed. Review manually.'});
          u.level=r.toLevel; tx(db,u.id,'upgrade',0,{level:r.toLevel,fee:r.fee,label:'Upgrade approved'});
        }
      }
      await save(db); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && p==='/api/admin/settings') {
      const a=admin(req); if(!a)return json(res,403,{error:'Admin only'}); const b=await parseBody(req); const db=await load();
      if(Number.isFinite(Number(b.conversionFee)))db.settings.conversionFee=Number(b.conversionFee);
      if(Number.isFinite(Number(b.activationFee)))db.settings.activationFee=Number(b.activationFee);
      if(typeof b.activationBankName==='string')db.settings.activationBankName=b.activationBankName.trim();
      if(typeof b.activationAccountNumber==='string')db.settings.activationAccountNumber=b.activationAccountNumber.trim();
      if(typeof b.activationAccountHolder==='string')db.settings.activationAccountHolder=b.activationAccountHolder.trim();
      if(typeof b.supportTelegram==='string')db.settings.supportTelegram=b.supportTelegram.trim();
      if(typeof b.supportEmail==='string')db.settings.supportEmail=b.supportEmail.trim().toLowerCase();
      if(b.upgradeAccounts && typeof b.upgradeAccounts==='object'){
        for(const lv of [2,3,4,5]){
          const key=String(lv); const x=b.upgradeAccounts[key]; if (!x || typeof x !== 'object') continue; const old=db.settings.upgradeAccounts[key]||{}; db.settings.upgradeAccounts[key]={
            bankName:typeof x.bankName==='string'?x.bankName.trim():(old.bankName||''),
            accountNumber:typeof x.accountNumber==='string'?x.accountNumber.trim():(old.accountNumber||''),
            accountHolder:typeof x.accountHolder==='string'?x.accountHolder.trim():(old.accountHolder||'')
          };
        }
      }
      await save(db); return json(res,200,{settings:db.settings});
    }
    if(req.method==='GET' && p==='/api/admin/upgrade-receipt') {
      const a=admin(req); if(!a)return json(res,403,{error:'Admin only'}); const db=await load(); const r=db.upgradeRequests.find(x=>x.id===u.searchParams.get('id'));
      if(!r||!r.receiptFile)return json(res,404,{error:'Upgrade receipt not found'});
      const fp=path.join(UPLOADS,r.receiptFile); if(!fs.existsSync(fp))return json(res,404,{error:'Receipt file missing'});
      const ext=path.extname(fp).toLowerCase(); const types={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
      res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'}); return fs.createReadStream(fp).pipe(res);
    }
    if(req.method==='GET' && p==='/api/admin/receipt') { const a=admin(req); if(!a)return json(res,403,{error:'Admin only'}); const db=await load(); const r=db.activationRequests.find(x=>x.id===u.searchParams.get('id')); if(!r||!r.receiptFile)return json(res,404,{error:'Receipt not found'}); const fp=path.join(UPLOADS,r.receiptFile); if(!fs.existsSync(fp))return json(res,404,{error:'Receipt file missing'}); const ext=path.extname(fp).toLowerCase(); const types={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'}); return fs.createReadStream(fp).pipe(res); }
    if(req.method==='GET' && p==='/admin') return serve(res,path.join(PUBLIC,'admin.html'));
    if(req.method==='GET') { let fp=path.join(PUBLIC,p==='/'?'index.html':p.replace(/^\//,'')); if(!fp.startsWith(PUBLIC)||!fs.existsSync(fp))fp=path.join(PUBLIC,'index.html'); return serve(res,fp); }
    json(res,404,{error:'Not found'});
  } catch(e) { console.error(e); json(res,500,{error:'Server error',detail:e.message}); }
}
function admin(req){ const key=req.headers['x-admin-key']; return key && key===(adminSecret); }
function serve(res,fp){ const ext=path.extname(fp); const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'}); fs.createReadStream(fp).pipe(res); }
async function start() {
  try {
    await sql`CREATE TABLE IF NOT EXISTS nixi_app_state (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`;
    await load();
    const server = http.createServer(route);
    server.listen(service.port(), '0.0.0.0', () => console.log(`Nixi listening on Compute port ${service.port()}`));
    const shutdown = async () => { server.close(); await sql.close(); process.exit(0); };
    process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('Nixi startup failed. Confirm the PostgreSQL dependency is provisioned in Prisma Composer.', err);
    process.exit(1);
  }
}
start();
