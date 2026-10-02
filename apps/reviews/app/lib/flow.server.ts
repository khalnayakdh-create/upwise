import { gql, type GraphqlFn } from "@upwise/shopify-app";
import { FLOW_REVIEW_SUBMITTED, reviewSubmittedPayload, type SubmittedReview } from "./flow-payload";

/** Tell Shopify Flow a review came in. Never throws: Flow is optional for merchants. */
export async function notifyReviewSubmitted(graphql: GraphqlFn, review: SubmittedReview) {
  try {
    const r = await gql<{ flowTriggerReceive: { userErrors: Array<{ message: string }> } }>(
      graphql,
      `#graphql
      mutation StorevineFlowReview($handle: String, $payload: JSON) {
        flowTriggerReceive(handle: $handle, payload: $payload) { userErrors { field message } }
      }`,
      { handle: FLOW_REVIEW_SUBMITTED, payload: reviewSubmittedPayload(review) },
    );
    if (r.flowTriggerReceive.userErrors.length) console.error("flow trigger", JSON.stringify(r.flowTriggerReceive.userErrors));
  } catch (e) {
    console.error("flow trigger failed", e instanceof Error ? e.message : e);
  }
}
