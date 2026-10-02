import { createRequestHandler } from "react-router";
import { ensureMigrated, platformMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import { runScheduledSends } from "../app/lib/send-context.server";
import { runDailyHealthCheck } from "../app/lib/health.server";

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
  // Crons (wrangler.jsonc triggers): due review-request emails every 15 min; health check daily.
  async scheduled(controller, env, ctx) {
    await ensureMigrated(env.DB, migrations);
    if (controller.cron === "11 15 * * *") ctx.waitUntil(runDailyHealthCheck(env));
    else ctx.waitUntil(runScheduledSends(env));
  },
} satisfies ExportedHandler<Env>;
