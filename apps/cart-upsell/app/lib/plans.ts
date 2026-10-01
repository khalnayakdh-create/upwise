/** Plan names and limits. Prices are placeholders until pricing is decided (blueprint §14.2). */
export const GROWTH_PLAN = "Growth";

export type PlanKey = "free" | "growth";

export const PLAN_LIMITS: Record<PlanKey, { maxActiveOffers: number; maxProductsPerOffer: number }> = {
  free: { maxActiveOffers: 1, maxProductsPerOffer: 3 },
  growth: { maxActiveOffers: Number.POSITIVE_INFINITY, maxProductsPerOffer: 3 },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[] }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["1 active cart offer", "Up to 3 products per offer", "Cart drawer and cart page", "Basic analytics"],
  },
  growth: {
    name: "Growth",
    price: "$9.99 / 30 days",
    features: ["Unlimited active offers", "Offer priority ordering", "Per-offer analytics", "7-day free trial"],
  },
};
