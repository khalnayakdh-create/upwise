/** Bundle types and limits shared by server code and the admin UI. */
export type BundleType = "fixed" | "volume";
export interface Tier { min: number; percent: number }

/** Product count limits per bundle type. */
export const PRODUCT_LIMITS: Record<BundleType, { min: number; max: number }> = {
  fixed: { min: 2, max: 5 },
  volume: { min: 1, max: 20 },
};
export const MAX_TIERS = 4;
