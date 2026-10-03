/** Plans (approved 2026-10-03, blueprint §14.2.1). Flat price; never billed on orders or review volume. */
export const GROWTH_PLAN = "Growth";
export const PAID_PLANS = [{ name: GROWTH_PLAN, amount: 9.99 }];
export type PlanKey = "free" | "growth";

// Imports are unlimited on every plan: switching from another app should never cost extra.
export const PLAN_LIMITS: Record<PlanKey, { importPerMonth: number; requestsPerMonth: number }> = {
  free: { importPerMonth: Number.POSITIVE_INFINITY, requestsPerMonth: 100 },
  growth: { importPerMonth: Number.POSITIVE_INFINITY, requestsPerMonth: Number.POSITIVE_INFINITY },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["Unlimited reviews with photos", "Star ratings and Google rich results", "Moderation inbox", "Unlimited imports and CSV export", "100 review-request emails / month"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$9.99 / 30 days",
    features: ["Everything in Free", "Unlimited review-request emails", "Flat price: never based on orders or reviews", "7-day free trial"],
  },
};
