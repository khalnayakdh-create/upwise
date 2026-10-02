/** Plans (prices are placeholders until pricing is decided, blueprint §14.2). */
export const GROWTH_PLAN = "Growth";
export const PAID_PLANS = [{ name: GROWTH_PLAN, amount: 14.99 }];
export type PlanKey = "free" | "growth";

export const PLAN_LIMITS: Record<PlanKey, { maxActiveBundles: number }> = {
  free: { maxActiveBundles: 1 },
  growth: { maxActiveBundles: Number.POSITIVE_INFINITY },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["1 active bundle of any type", "Bought together, quantity breaks or mix and match", "Automatic discount at checkout", "Sales report: orders and revenue"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$14.99 / 30 days",
    features: ["Unlimited bundles", "No revenue caps, ever", "Priority human support", "7-day free trial"],
  },
};
