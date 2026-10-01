import type { Route } from "./+types/auth.$";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  await getShopify(context.cloudflare.env).authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
