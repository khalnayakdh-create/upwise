/** Plans (prices are placeholders until pricing is decided, blueprint §14.2). */
export const GROWTH_PLAN = "Growth";
export const PAID_PLANS = [{ name: GROWTH_PLAN, amount: 7.99 }];
export type PlanKey = "free" | "growth";

export const PLAN_LIMITS: Record<PlanKey, { importPerMonth: number }> = {
  free: { importPerMonth: 100 },
  growth: { importPerMonth: Number.POSITIVE_INFINITY },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["Unlimited text reviews", "Star ratings on product pages", "Moderation inbox", "Import up to 100 reviews / month"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$7.99 / 30 days",
    features: ["Everything in Free", "Unlimited imports", "Photo reviews (coming soon)", "Google Shopping feed (coming soon)"],
  },
};
