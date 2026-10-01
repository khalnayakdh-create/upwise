import type { Route } from "./+types/media.$";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "@upwise/platform";
import { reviewTable } from "../lib/schema";
import { bucket, verifyPhotoSig } from "../lib/photos.server";

/**
 * GET /media/<shop>/<uuid>.<ext> — review photos. Public only while the review
 * is published; otherwise only with an admin-signed URL (exp + sig).
 */
export const loader = async ({ request, params, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const key = params["*"] ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const signed = await verifyPhotoSig(env.SHOPIFY_API_SECRET, key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!signed) {
    const shop = key.split("/")[0];
    const [row] = await getDb(env.DB)
      .select({ id: reviewTable.id })
      .from(reviewTable)
      .where(and(eq(reviewTable.shop, shop), eq(reviewTable.status, "published"), like(reviewTable.photos, `%"${key}"%`)))
      .limit(1);
    if (!row) return new Response("Not found", { status: 404 });
  }
  const obj = await bucket(env)?.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": signed ? "private, max-age=600" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
};
