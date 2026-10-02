import type { Route } from "./+types/submit";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { notifyReviewSubmitted } from "../lib/flow.server";
import { productInfo, syncProductRating } from "../lib/admin.server";
import { createReview, getSettings, MAX_SUBMISSIONS_PER_HOUR, recentSubmissions, validateSubmission } from "../lib/reviews.server";
import { deletePhotos, savePhotos, verifyUploadToken } from "../lib/photos.server";
import { WRITE_ERRORS } from "../lib/write-errors";

/**
 * POST {APP_URL}/submit — product-page review form with photos (multipart).
 * Called cross-origin from the storefront, authorised by the short-lived token
 * the app-proxy GET handed out for this shop + product.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: WRITE_ERRORS.failed }, 400);
  }
  const shop = String(form.get("shop") ?? "");
  const numeric = String(form.get("productId") ?? "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop) || !/^\d+$/.test(numeric)) return json({ error: WRITE_ERRORS.failed }, 400);
  if (!(await verifyUploadToken(env.SHOPIFY_API_SECRET, shop, numeric, String(form.get("token") ?? "")))) {
    return json({ error: "Please reload the page and try again." }, 403);
  }
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const { input, error } = validateSubmission(raw);
  if (error === "spam") return json({ ok: true, status: "pending" }); // don't tell bots
  if (!input) return json({ error }, 400);
  const db = getDb(env.DB);
  if ((await recentSubmissions(db, shop)) >= MAX_SUBMISSIONS_PER_HOUR) {
    return json({ error: "We're receiving a lot of reviews right now. Please try again later." }, 429);
  }
  let graphql;
  try {
    graphql = (await getShopify(env).unauthenticated.admin(shop)).admin.graphql as never;
  } catch {
    return json({ error: WRITE_ERRORS.failed }, 410);
  }
  const product = await productInfo(graphql, input.productId);
  if (!product) return json({ error: "Unknown product." }, 400);
  const files = form.getAll("photos").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const photos = await savePhotos(env, shop, files);
  if (photos.error) return json({ error: WRITE_ERRORS[photos.error] }, 400);
  const { autoPublish } = await getSettings(db, shop);
  const status = autoPublish ? "published" : "pending";
  try {
    await createReview(db, shop, { ...input, productHandle: product.handle, productTitle: product.title, status, photos: photos.keys });
  } catch (e) {
    await deletePhotos(env, photos.keys);
    throw e;
  }
  if (status === "published") await syncProductRating(graphql, env, shop, input.productId);
  context.cloudflare.ctx.waitUntil(
    notifyReviewSubmitted(graphql, { ...input, verified: false, status, photos: photos.keys.length }),
  );
  return json({ ok: true, status });
};

export const loader = () => new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST" } });
