import { createRequestHandler } from "react-router";
import { ensureMigrated, platformMigrations } from "@upwise/platform";
import { cartUpsellMigrations } from "../app/lib/schema";

const migrations = [...platformMigrations, ...cartUpsellMigrations];

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    // Creates/updates D1 tables once per isolate (cheap no-op afterwards).
    await ensureMigrated(env.DB, migrations);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
