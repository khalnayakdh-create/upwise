import type { Route } from "./+types/webhooks.compliance";
import { shared } from "../shopify.server";

export const action = (args: Route.ActionArgs) => shared.compliance(args as never);
