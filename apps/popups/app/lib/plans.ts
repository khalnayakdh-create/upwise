/** Plans (prices are placeholders until pricing is decided, blueprint §14.2). */
export const GROWTH_PLAN = "Growth";
export const PAID_PLANS = [{ name: GROWTH_PLAN, amount: 9.99 }];
export type PlanKey = "free" | "growth";

export const PLAN_LIMITS: Record<PlanKey, { signupsPerMonth: number; branding: boolean }> = {
  free: { signupsPerMonth: 250, branding: true },
  growth: { signupsPerMonth: Number.POSITIVE_INFINITY, branding: false },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: ["Email sign-up pop-up", "Exit-intent, delay and scroll triggers", "250 sign-ups / month", "Sign-ups saved as Shopify customers"],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$9.99 / 30 days",
    features: ["Unlimited sign-ups", "No Upwise branding", "A/B tests (coming soon)", "SMS sign-up (coming soon)"],
  },
};
