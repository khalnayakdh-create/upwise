/** Plans (approved 2026-10-03, blueprint §14.2.1). */
export const GROWTH_PLAN = "Growth";
export const PAID_PLANS = [{ name: GROWTH_PLAN, amount: 9.99 }];
export type PlanKey = "free" | "growth";

/** The free plan is gated on features, never on how many sign-ups a store collects (blueprint §12.2). */
export const PLAN_LIMITS: Record<PlanKey, { branding: boolean; uniqueCodes: boolean }> = {
  free: { branding: true, uniqueCodes: false },
  growth: { branding: false, uniqueCodes: true },
};

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; features: string[]; billingName?: string }> = {
  free: {
    name: "Free",
    price: "$0",
    features: [
      "Unlimited sign-ups, saved as Shopify customers",
      "Exit-intent, delay and scroll triggers",
      "Bot shield and consent record included",
      "One discount code for everyone",
    ],
  },
  growth: {
    name: "Growth",
    billingName: GROWTH_PLAN,
    price: "$9.99 / 30 days",
    features: ["Unique single-use code per sign-up", "No Storevine branding", "Flat price: never based on views or contacts", "7-day free trial"],
  },
};
