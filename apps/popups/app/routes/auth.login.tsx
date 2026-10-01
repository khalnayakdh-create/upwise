import type { Route } from "./+types/auth.login";
import { getShopify } from "../shopify.server";

/** App Store rule: merchants never type their shop domain. */
export const loader = async ({ request, context }: Route.LoaderArgs) => {
  if (new URL(request.url).searchParams.get("shop")) {
    await getShopify(context.cloudflare.env).login(request);
  }
  return null;
};

export default function Login() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>Open Storevine Pop-ups from Shopify</h1>
      <p>Go to your Shopify admin, open <strong>Apps</strong>, and select Storevine Pop-ups.</p>
    </main>
  );
}
