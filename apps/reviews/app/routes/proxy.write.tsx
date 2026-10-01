import type { Route } from "./+types/proxy.write";
import { getDb } from "@upwise/platform";
import { gql, type GraphqlFn } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { reviewedFromRequest } from "../lib/reviews.server";
import { escapeHtml, getRequest, verifyToken } from "../lib/requests.server";
import { WRITE_ERRORS } from "../lib/write-errors";

/**
 * Review page linked from request emails, served through the app proxy:
 *   GET /apps/storevine-reviews/write?t=TOKEN&p=PRODUCT&r=RATING
 * Returned as Liquid so it renders inside the store's own theme. The form posts
 * straight to the app ({APP_URL}/write, multipart with photos) because the app
 * proxy isn't meant for file uploads; the app then redirects back here with
 * ?done=PRODUCT&s=published|pending or ?e=ERROR_CODE.
 * Every dynamic value is HTML-escaped and braces are neutralised so nothing
 * (product titles, names) can be evaluated as Liquid.
 */

const safe = (s: string) => escapeHtml(s).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
const liquid = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "application/liquid", "Cache-Control": "no-store" } });

interface Product { id: string; numericId: string; title: string; imageUrl: string | null }

async function loadProducts(graphql: GraphqlFn, ids: string[]): Promise<Product[]> {
  const data = await gql<{ nodes: Array<{ id: string; title: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null } | null> }>(
    graphql,
    `#graphql
    query StorevineWriteProducts($ids: [ID!]!) {
      nodes(ids: $ids) { ... on Product { id title featuredMedia { preview { image { url(transform: { maxWidth: 240, maxHeight: 240 }) } } } } }
    }`,
    { ids },
  );
  return data.nodes
    .filter((p): p is NonNullable<typeof p> => Boolean(p && p.id))
    .map((p) => ({ id: p.id, numericId: p.id.split("/").pop()!, title: p.title, imageUrl: p.featuredMedia?.preview?.image?.url ?? null }));
}

const STYLE = `<style>
.sv-write{max-width:640px;margin:40px auto;padding:0 20px;font-size:16px;line-height:1.5}
.sv-write h1{font-size:1.6em;margin:0 0 16px}
.sv-write .sv-product{display:flex;gap:16px;align-items:center;margin:0 0 20px}
.sv-write .sv-product img{width:96px;height:96px;object-fit:cover;border-radius:8px}
.sv-write fieldset{border:0;padding:0;margin:0 0 16px}
.sv-write legend,.sv-write label{display:block;font-weight:600;margin:0 0 6px}
.sv-stars{display:inline-flex;flex-direction:row-reverse;gap:4px}
.sv-stars input{position:absolute;opacity:0;width:1px;height:1px}
.sv-stars label{font-size:32px;line-height:1;color:#c8c8c8;cursor:pointer;margin:0;font-weight:400}
.sv-stars input:checked~label,.sv-stars label:hover,.sv-stars label:hover~label{color:#f5a623}
.sv-stars input:focus-visible+label{outline:2px solid currentColor;outline-offset:2px}
.sv-write input[type=text],.sv-write textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #8a8a8a;border-radius:6px;font:inherit;margin:0 0 16px}
.sv-write textarea{min-height:140px}
.sv-write .sv-hint{font-size:.875em;opacity:.75;margin:-10px 0 16px}
.sv-write button{padding:12px 24px;border:0;border-radius:6px;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}
.sv-write .sv-error{color:#b00020;font-weight:600}
.sv-write ul{padding-left:20px}
</style>`;

function page(inner: string) {
  return `${STYLE}<div class="sv-write">${inner}</div>`;
}

function formHtml(args: { action: string; token: string; product: Product; rating: number | null; author: string; error?: string; values?: Record<string, string> }) {
  const { product, values = {} } = args;
  const rating = Number(values.rating) || args.rating || 0;
  const stars = [5, 4, 3, 2, 1]
    .map(
      (r) =>
        `<input type="radio" id="sv-r${r}" name="rating" value="${r}"${rating === r ? " checked" : ""} required><label for="sv-r${r}" title="${r} star${r > 1 ? "s" : ""}"><span aria-hidden="true">&#9733;</span><span style="position:absolute;left:-9999px">${r} star${r > 1 ? "s" : ""}</span></label>`,
    )
    .join("");
  const img = product.imageUrl ? `<img src="${safe(product.imageUrl)}" alt="">` : "";
  return page(`<h1>Write a review</h1>
<div class="sv-product">${img}<strong>${safe(product.title)}</strong></div>
${args.error ? `<p class="sv-error" role="alert">${safe(args.error)}</p>` : ""}
<form method="post" action="${safe(args.action)}" enctype="multipart/form-data">
<input type="hidden" name="t" value="${safe(args.token)}">
<input type="hidden" name="p" value="${safe(product.numericId)}">
<fieldset><legend>Your rating</legend><div class="sv-stars">${stars}</div></fieldset>
<label for="sv-author">Name shown with your review</label>
<input type="text" id="sv-author" name="author" maxlength="60" required value="${safe(values.author ?? args.author)}">
<label for="sv-title">Title (optional)</label>
<input type="text" id="sv-title" name="title" maxlength="120" value="${safe(values.title ?? "")}">
<label for="sv-body">Your review</label>
<textarea id="sv-body" name="body" maxlength="2000" required>${safe(values.body ?? "")}</textarea>
<label for="sv-photos">Photos (optional, up to 3)</label>
<input type="file" id="sv-photos" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
<p class="sv-hint">JPEG, PNG or WebP, up to 5 MB each.</p>
<button type="submit">Submit review</button>
</form>`);
}

function message(title: string, text: string, links = "") {
  return page(`<h1>${safe(title)}</h1><p>${safe(text)}</p>${links}`);
}

async function context(request: Request, env: Env, token: string | null) {
  const { session, admin } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session || !admin) return { error: message("This link isn't working", "Please try again later.") };
  const claim = await verifyToken(env.SHOPIFY_API_SECRET, "review", token);
  if (!claim || claim.shop !== session.shop) return { error: message("This link isn't valid", "It may have been copied incompletely. Please use the link from your email.") };
  const db = getDb(env.DB);
  const req = await getRequest(db, session.shop, claim.requestId);
  if (!req) return { error: message("This link has expired", "Thank you for your interest in leaving a review.") };
  return { session, admin, db, req, token: token! };
}

function remainingLinks(token: string, products: Product[]) {
  if (!products.length) return "";
  return `<p>Would you like to review something else from your order?</p><ul>${products
    .map((p) => `<li><a href="/apps/storevine-reviews/write?t=${safe(token)}&amp;p=${safe(p.numericId)}">${safe(p.title)}</a></li>`)
    .join("")}</ul>`;
}

export const loader = async ({ request, context: ctx }: Route.LoaderArgs) => {
  const { env } = ctx.cloudflare;
  const url = new URL(request.url);
  const c = await context(request, env, url.searchParams.get("t"));
  if ("error" in c) return liquid(c.error as string);
  const ids = JSON.parse(c.req.productIds) as string[];
  const done = await reviewedFromRequest(c.db, c.session.shop, c.req.id);
  const products = await loadProducts(c.admin.graphql as never, ids);
  const open = products.filter((p) => !done.has(p.id));
  if (!open.length && !url.searchParams.get("done")) return liquid(message("Thanks, you've reviewed everything", "We appreciate you taking the time."));
  const doneId = url.searchParams.get("done");
  if (doneId) {
    const published = url.searchParams.get("s") === "published";
    return liquid(
      message(
        "Thank you for your review!",
        published ? "It's now live on the product page." : "It will appear on the product page after a quick check.",
        remainingLinks(c.token, open),
      ),
    );
  }
  const wanted = url.searchParams.get("p");
  const product = open.find((p) => p.numericId === wanted) ?? open[0];
  const r = Number(url.searchParams.get("r"));
  const errorCode = url.searchParams.get("e") ?? "";
  return liquid(
    formHtml({
      action: `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/write`,
      token: c.token,
      product,
      rating: r >= 1 && r <= 5 ? r : null,
      author: c.req.firstName,
      error: WRITE_ERRORS[errorCode],
    }),
  );
};
