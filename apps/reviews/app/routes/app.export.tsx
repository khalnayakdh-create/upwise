import type { Route } from "./+types/app.export";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { exportCsv } from "../lib/reviews.server";

/** GET /app/export — every review as CSV (the admin page fetches this with the session token). */
export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const csv = await exportCsv(getDb(env.DB), session.shop);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="storevine-reviews-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
