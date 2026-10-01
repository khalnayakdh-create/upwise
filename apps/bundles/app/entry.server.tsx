import { createHandleRequest } from "@upwise/shopify-app";
import { getShopify } from "./shopify.server";

export default createHandleRequest(getShopify as never);
