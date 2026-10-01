import type { Route } from "./+types/_index";
import { redirect } from "react-router";

// Shopify opens the app at "/?shop=...&host=..."; send embedded traffic to /app.
// Everyone else gets a minimal landing page (the public site lives elsewhere).
export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Index() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>Storevine Cart Upsell</h1>
      <p>Install from the Shopify App Store to get started.</p>
    </main>
  );
}
