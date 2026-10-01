/** Plan names and limits. Prices are placeholders until pricing is decided (blueprint §14.2). */
export const GROWTH_PLAN = "Growth";
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
  growth: { maxActiveOffers: Number.POSITIVE_INFINITY, maxProductsPerOffer: 3, discounts: true, thankYouOffers: false },
  pro: { maxActiveOffers: Number.POSITIVE_INFINITY, maxProductsPerOffer: 3, discounts: true, thankYouOffers: true },
};

export const PLAN_PRICES = { [GROWTH_PLAN]: 9.99, [PRO_PLAN]: 24.99 } as const;

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["1 active cart offer", "Up to 3 products per offer", "Cart drawer and cart page", "Basic analytics"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$9.99 / 30 days",
    features: ["Unlimited active offers", "Discounts on offer products", "Offer priority ordering", "7-day free trial"],
  },
  pro: {
    name: "Pro",
    billingName: PRO_PLAN,
    price: "$24.99 / 30 days",
    features: ["Everything in Growth", "Thank-you page offers", "Post-purchase offers (coming soon)", "7-day free trial"],
  },
};

export function planFromSubscriptionName(name: string | undefined | null): PlanKey {
  if (name === PRO_PLAN) return "pro";
  if (name === GROWTH_PLAN) return "growth";
  return "free";
}
