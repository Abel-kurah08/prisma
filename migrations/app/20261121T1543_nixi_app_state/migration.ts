#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4a20205bdf1a28087e0d4831ade4bd9bc7b22495abdfcade36de01a8d73bbf99/contract';
import endContract from '../../snapshots/4a20205bdf1a28087e0d4831ade4bd9bc7b22495abdfcade36de01a8d73bbf99/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'nixi_app_state',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
