/** Plan names and limits. Prices approved 2026-10-03 (blueprint §14.2.1): Free + one flat Growth plan. */
export const GROWTH_PLAN = "Growth";
/** Legacy: Pro was folded into Growth on 2026-10-03. Kept so existing Pro subscriptions keep resolving. */
export const PRO_PLAN = "Pro";
export const PAID_PLANS = [GROWTH_PLAN, PRO_PLAN] as const;

export type PlanKey = "free" | "growth" | "pro";

export interface PlanLimits {
  maxActiveOffers: number;
  maxProductsPerOffer: number;
  discounts: boolean;
  thankYouOffers: boolean;
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: { maxActiveOffers: 1, maxProductsPerOffer: 3, discounts: false, thankYouOffers: false },
  growth: { maxActiveOffers: Number.POSITIVE_INFINITY, maxProductsPerOffer: 3, discounts: true, thankYouOffers: true },
  pro: { maxActiveOffers: Number.POSITIVE_INFINITY, maxProductsPerOffer: 3, discounts: true, thankYouOffers: true },
};

export const PLAN_PRICES = { [GROWTH_PLAN]: 14.99, [PRO_PLAN]: 24.99 } as const;

/** Plans offered on the Plans page (Pro is legacy-only). */
export const OFFERED_PLANS: PlanKey[] = ["free", "growth"];

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["1 active cart offer", "Cart drawer and cart page", "Sales from offers, after refunds", "Lift test: what offers really add"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$14.99 / 30 days",
    features: ["Unlimited active offers", "Discounts on offer products", "Thank-you page offers", "Flat price: never based on your orders", "7-day free trial"],
  },
  pro: {
    name: "Pro",
    billingName: PRO_PLAN,
    price: "$24.99 / 30 days",
    features: ["Everything in Growth (legacy plan)"],
  },
};

export function planFromSubscriptionName(name: string | undefined | null): PlanKey {
  if (name === PRO_PLAN) return "pro";
  if (name === GROWTH_PLAN) return "growth";
  return "free";
}
