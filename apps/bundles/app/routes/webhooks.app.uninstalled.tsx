import type { Route } from "./+types/webhooks.app.uninstalled";
import { shared } from "../shopify.server";

export const action = (args: Route.ActionArgs) => shared.uninstalled(args as never);
