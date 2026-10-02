import type { D1Database } from "@cloudflare/workers-types";
import { buildHealthEmail, runHealthCheck, type HealthSignal } from "@upwise/platform";
import { gql, storeHandle, type GraphqlFn } from "./admin";

export const ALERT_SENDER = "alerts@storevine.app";

export interface EmailBinding {
  send(message: Record<string, unknown>): Promise<{ messageId?: string }>;
}

export interface AppHealthOptions {
  d1: D1Database;
  /** Merchant-facing app name, e.g. "Storevine Bundles". */
  appName: string;
  /** Admin app handle, e.g. "upwise-bundles". */
  appHandle: string;
  /** Cloudflare Email Service binding; without it only the in-app banner is set. */
  email: EmailBinding | undefined;
  /** Offline Admin API client for a shop (throws when the shop has no session). */
  admin(shop: string): Promise<GraphqlFn>;
  signalsFor(shop: string): Promise<HealthSignal[]>;
  /** Likely causes, shown in the email (defaults to theme/block causes). */
  causes?: string;
  now?: Date;
}

/** Daily health check for one app: banner state for every shop, email for new problems. */
export async function runAppHealthCheck(opts: AppHealthOptions) {
  const counts = await runHealthCheck({
    d1: opts.d1,
    now: opts.now,
    signalsFor: opts.signalsFor,
    async notify(shop, problems) {
      if (!opts.email) throw new Error("email binding missing");
      const graphql = await opts.admin(shop);
      const { shop: info } = await gql<{ shop: { name: string; email: string; contactEmail: string | null } }>(
        graphql,
        `#graphql
        query StorevineShopForAlert { shop { name email contactEmail } }`,
      );
      const to = info.email || info.contactEmail;
      if (!to) throw new Error("shop has no email");
      const { subject, html, text } = buildHealthEmail({
        appName: opts.appName,
        shopName: info.name,
        problems: problems.map((p) => p.problem),
        causes: opts.causes,
        adminUrl: `https://admin.shopify.com/store/${storeHandle(shop)}/apps/${opts.appHandle}`,
      });
      await opts.email.send({ to, from: { email: ALERT_SENDER, name: "Storevine" }, subject, html, text });
    },
  });
  if (counts.withProblems || counts.errors) console.log("health check", opts.appName, JSON.stringify(counts));
  return counts;
}
