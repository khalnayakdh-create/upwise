import type { Route } from "./+types/healthz";

/** Deployment smoke test: confirms the Worker runs and D1 is migrated. */
export const loader = async ({ context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { results } = await env.DB.prepare(
    "SELECT id, name FROM _migrations ORDER BY id",
  ).all<{ id: number; name: string }>();
  return Response.json(
    {
      ok: true,
      app: "storevine-cart-upsell",
      migrations: results.map((r) => `${r.id}_${r.name}`),
      configured: {
        apiKey: Boolean(env.SHOPIFY_API_KEY),
        apiSecret: Boolean(env.SHOPIFY_API_SECRET),
        appUrl: env.SHOPIFY_APP_URL || null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};
