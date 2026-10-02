export const FLOW_REVIEW_SUBMITTED = "review-submitted";

export interface SubmittedReview {
  productId: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  verified: boolean;
  status: "published" | "pending";
  photos: number;
}

/** Payload for the "Review submitted" Flow trigger (keys match the extension's fields; must stay under 50 KB). */
export function reviewSubmittedPayload(r: SubmittedReview) {
  return {
    product_id: Number(r.productId.split("/").pop()),
    Rating: r.rating,
    Title: r.title.slice(0, 200),
    Body: r.body.slice(0, 5000),
    Author: r.author.slice(0, 100),
    Verified: r.verified,
    Status: r.status,
    Photos: r.photos,
  };
}
