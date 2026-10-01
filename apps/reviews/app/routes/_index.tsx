import type { Route } from "./+types/_index";
import { redirect } from "react-router";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

export default function Index() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 48, maxWidth: 560 }}>
      <h1>Storevine Reviews</h1>
      <p>Install from the Shopify App Store to get started.</p>
    </main>
  );
}
