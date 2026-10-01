import type { Route } from "./+types/healthz";
import { shared } from "../shopify.server";

export const loader = (args: Route.LoaderArgs) => shared.healthz(args as never);
