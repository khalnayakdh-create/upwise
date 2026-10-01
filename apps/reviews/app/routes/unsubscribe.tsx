import type { Route } from "./+types/unsubscribe";
import { getDb } from "@upwise/platform";
import { escapeHtml, getRequest, unsubscribe, verifyToken } from "../lib/requests.server";

/**
 * {APP_URL}/unsubscribe?t=TOKEN
 *   GET  → confirmation page with one button (link scanners never opt people out by just visiting)
 *   POST → opt out. Also handles RFC 8058 one-click (body "List-Unsubscribe=One-Click") from mail apps.
 */
const html = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;line-height:1.5;color:#1a1a1a}button{padding:12px 20px;border:0;border-radius:6px;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const token = new URL(request.url).searchParams.get("t");
  if (!(await verifyToken(env.SHOPIFY_API_SECRET, "unsub", token))) {
    return html("This link isn't valid", "<p>Please use the link from your email.</p>", 400);
  }
  return html(
    "Stop review requests?",
    `<p>You won't receive any more emails asking you to review products from this store.</p>
<form method="post"><input type="hidden" name="t" value="${escapeHtml(token!)}"><button type="submit">Stop review requests</button></form>`,
  );
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const url = new URL(request.url);
  let token = url.searchParams.get("t");
  try {
    const form = await request.formData();
    token = String(form.get("t") ?? "") || token;
  } catch {
    // one-click posts may send an empty or text body; the token is in the URL
  }
  const claim = await verifyToken(env.SHOPIFY_API_SECRET, "unsub", token);
  if (!claim) return html("This link isn't valid", "<p>Please use the link from your email.</p>", 400);
  const db = getDb(env.DB);
  const req = await getRequest(db, claim.shop, claim.requestId);
  if (req) await unsubscribe(db, claim.shop, req.email);
  return html("You're unsubscribed", "<p>You won't receive more review requests from this store.</p>");
};
