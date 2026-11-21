import { module } from "@prisma/composer";
import { rawPostgres, envSecret } from "@prisma/composer-prisma-cloud";
import nixiService from "./service.ts";

export default module("nixi-apix", ({ provision }) => {
  const db = provision(rawPostgres({ name: "database" }));
  provision(nixiService, {
    deps: { db },
    input: {
      sessionSecret: envSecret("NIXI_SESSION_SECRET"),
      adminKey: envSecret("NIXI_ADMIN_KEY"),
    },
  });
});
