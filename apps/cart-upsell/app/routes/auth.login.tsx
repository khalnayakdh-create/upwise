import type { Route } from "./+types/auth.login";
import { getShopify } from "../shopify.server";

/**
 * App Store rule: merchants must never type their shop domain. If Shopify sent
 * a ?shop= param, hand off to Shopify's install/login flow; otherwise explain
 * where to open the app.
 */
export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    await getShopify(context.cloudflare.env).login(request);
  }
  return null;
};

export default function Login() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>Open Storevine Cart Upsell from Shopify</h1>
      <p>
        Go to your Shopify admin, open <strong>Apps</strong>, and select Storevine
        Cart Upsell. If you haven't installed it yet, find it on the Shopify App
        Store.
      </p>
    </main>
  );
}
