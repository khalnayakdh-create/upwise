import { createRequestHandler } from "react-router";
import { ensureMigrated, platformMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const migrations = [...platformMigrations, ...appMigrations];
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    await ensureMigrated(env.DB, migrations);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
