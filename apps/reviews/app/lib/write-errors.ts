/** Error codes passed back to the review page after a failed submit (no free text in URLs). */
export const WRITE_ERRORS: Record<string, string> = {
  rating: "Choose a star rating.",
  author: "Add your name.",
  body: "Write a few words about the product.",
  photo_type: "Photos must be JPEG, PNG or WebP.",
  photo_size: "Each photo must be 5 MB or smaller.",
  photo_count: "You can add up to 3 photos.",
  failed: "Something went wrong. Please try again.",
};

export function errorCode(message: string | undefined | null): string {
  if (!message) return "failed";
  if (message.includes("star")) return "rating";
  if (message.includes("name")) return "author";
  if (message.includes("few words")) return "body";
  return "failed";
}
