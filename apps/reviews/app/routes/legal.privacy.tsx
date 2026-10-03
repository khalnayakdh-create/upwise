export const meta = () => [{ title: "Privacy policy · Storevine Reviews" }];

const UPDATED = "October 1, 2026";
const CONTACT = "privacy@storevine.app";

export default function Privacy() {
  return (
    <article>
      <h1>Privacy policy — Storevine Reviews</h1>
      <p><em>Last updated {UPDATED}</em></p>
      <p>
        Storevine Reviews ("the App") is a Shopify app operated by Karj Trading LLC ("Storevine", "we"). This
        policy explains what the App collects when a merchant installs it on their Shopify store, and how we use
        and protect that information.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Store information</strong>: your shop's myshopify domain, install and uninstall dates, and your Storevine plan.</li>
        <li><strong>Access credentials</strong>: the access token Shopify issues when you install the App.</li>
        <li><strong>Reviews</strong>: the star rating, title, text, display name and up to 3 photos a reviewer submits on your store, the product it's about, whether it came from a verified order, and any public reply you write.</li>
        <li><strong>Review requests</strong> (only if you turn them on): when an order is fulfilled, the order number, the products in it, and the customer's email address and first name, used to send one review-request email. The email address and first name are erased 60 days after the request is sent or skipped.</li>
        <li><strong>Opt-outs</strong>: if a customer chooses not to receive review requests, we keep a one-way hash of their email address (not the address itself) so we never email them again.</li>
        <li><strong>Settings</strong>: your moderation and review-request preferences.</li>
      </ul>
      <p>
        The App reads fulfilled orders only to send review requests you have turned on. It does not read customer
        accounts, payment details or addresses. The review form does not ask for an email address; reviewers choose
        the name shown with their review.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To provide the App: display reviews, photos and star ratings on your store, let you moderate them, and send the review-request emails you turn on.</li>
        <li>To bill you through Shopify for paid plans.</li>
        <li>To keep the App secure, prevent abuse and fix problems.</li>
      </ul>
      <p>We do not sell information, and we do not use your data for advertising.</p>

      <h2>Where data is stored and who processes it</h2>
      <p>
        App data and review photos are stored with Cloudflare, Inc. (hosting, database, file storage and email
        delivery for review requests), and processed by Shopify Inc. as the platform the App runs on. Data is
        encrypted in transit and at rest (AES-256).
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while the App is installed. When you uninstall, we delete your access credentials
        immediately and Shopify asks us to erase your store's data 48 hours later; we then delete all reviews, photos, review requests and settings for your store. Customer email addresses and
        first names from review requests are erased 60 days after the request is handled. We honor Shopify's customer
        data request and erasure requests: on an erasure request we delete that customer's review requests. If a
        customer asks us to remove a review they wrote, contact us and we will delete it.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us to access, correct or delete your store's data at any time by contacting us. If you are in
        the EEA, UK or California you have the rights given by GDPR, UK GDPR or CCPA, including the right to
        access and erasure.
      </p>

      <h2>Changes</h2>
      <p>We will update this page if our practices change and show the date of the latest update above.</p>

      <h2>Contact</h2>
      <p>Questions or requests: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </article>
  );
}
