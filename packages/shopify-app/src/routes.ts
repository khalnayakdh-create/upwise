import { eq } from "drizzle-orm";
import {
  claimWebhook,
  getDb,
  handleComplianceWebhook,
  recordInstall,
  recordUninstall,
  sessionTable,
  type PrivacyHooks,
} from "@upwise/platform";
import type { BaseEnv, UpwiseShopify } from "./shopify";

type GetShopify = (env: BaseEnv) => UpwiseShopify;
interface Ctx {
  request: Request;
  context: { cloudflare: { env: BaseEnv; ctx: { waitUntil(p: Promise<unknown>): void } } };
}

/** Shared action/loader implementations; each app's route files re-export these. */
export function sharedRoutes(getShopify: GetShopify, opts: { app: string; privacy?: PrivacyHooks }) {
  return {
    async uninstalled({ request, context }: Ctx) {
      const { env } = context.cloudflare;
      const { shop, topic, webhookId } = await getShopify(env).authenticate.webhook(request);
      const db = getDb(env.DB as never);
      if (await claimWebhook(db, webhookId, topic, shop)) await recordUninstall(db, shop);
      return new Response();
    },

    async scopesUpdate({ request, context }: Ctx) {
      const { env } = context.cloudflare;
      const { payload, session } = await getShopify(env).authenticate.webhook(request);
      const current = ((payload as { current?: string[] }).current ?? []).toString();
      if (session) {
        await getDb(env.DB as never).update(sessionTable).set({ scope: current }).where(eq(sessionTable.id, session.id));
      }
      return new Response();
    },

    async compliance({ request, context }: Ctx) {
      const { env } = context.cloudflare;
      const { shop, topic, webhookId, payload } = await getShopify(env).authenticate.webhook(request);
      await handleComplianceWebhook(getDb(env.DB as never), { topic, shop, webhookId, payload }, opts.privacy);
      return new Response();
    },

    async healthz({ context }: Ctx) {
      const { env } = context.cloudflare;
      const { results } = await env.DB.prepare("SELECT id, name FROM _migrations ORDER BY id").all<{
        id: number;
        name: string;
      }>();
      return Response.json(
        {
          ok: true,
          app: opts.app,
          migrations: results.map((r) => `${r.id}_${r.name}`),
          configured: {
            apiKey: Boolean(env.SHOPIFY_API_KEY),
            apiSecret: Boolean(env.SHOPIFY_API_SECRET),
            appUrl: env.SHOPIFY_APP_URL || null,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },

    /** Use in the /app layout loader: authenticates and records the install. */
    async appLayout({ request, context }: Ctx) {
      const { env, ctx } = context.cloudflare;
      const { session } = await getShopify(env).authenticate.admin(request);
      ctx.waitUntil(recordInstall(getDb(env.DB as never), session.shop));
      return { apiKey: env.SHOPIFY_API_KEY, shop: session.shop };
    },
  };
}
