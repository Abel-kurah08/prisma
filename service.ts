import node from "@prisma/composer/node";
import { compute, rawPostgres } from "@prisma/composer-prisma-cloud";
import { type } from "arktype";
import { secretString } from "@prisma/composer/arktype";

export default compute({
  name: "nixi",
  deps: { db: rawPostgres() },
  input: type({ sessionSecret: secretString(), adminKey: secretString() }),
  build: node({ module: import.meta.url, entry: "../dist/server.mjs" }),
});
