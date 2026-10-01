import type { Route } from "./+types/webhooks.app.scopes_update";
import { shared } from "../shopify.server";

export const action = (args: Route.ActionArgs) => shared.scopesUpdate(args as never);
