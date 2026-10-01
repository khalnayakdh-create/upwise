import type { Route } from "./+types/webhooks.app.scopes_update";
import { eq } from "drizzle-orm";
import { getDb, sessionTable } from "@upwise/platform";
import { getShopify } from "../shopify.server";

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { payload, session } = await getShopify(env).authenticate.webhook(request);
  const current = (payload.current as string[] | undefined) ?? [];
  if (session) {
    await getDb(env.DB)
      .update(sessionTable)
      .set({ scope: current.toString() })
      .where(eq(sessionTable.id, session.id));
  }
  return new Response();
};
