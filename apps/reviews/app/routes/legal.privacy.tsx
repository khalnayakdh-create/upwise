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
        <li><strong>Reviews</strong>: the star rating, title, text and display name a reviewer types into the review form on your store, the product it's about, and any public reply you write.</li>
        <li><strong>Settings</strong>: your moderation preferences.</li>
      </ul>
      <p>
        The App does <strong>not</strong> read your customers' Shopify accounts or orders, and the review form does not
        ask for email addresses. Reviewers choose the name shown with their review.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To provide the App: display reviews and star ratings on your store and let you moderate them.</li>
        <li>To bill you through Shopify for paid plans.</li>
        <li>To keep the App secure, prevent abuse and fix problems.</li>
      </ul>
      <p>We do not sell information, and we do not use your data for advertising.</p>

      <h2>Where data is stored and who processes it</h2>
      <p>
        App data is stored with Cloudflare, Inc. (hosting and database), and processed by Shopify Inc. as the
        platform the App runs on. Data is encrypted in transit and at rest.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while the App is installed. When you uninstall, we delete your access credentials
        immediately and Shopify asks us to erase your store's data 48 hours later; we then delete all reviews and settings for your store. We honor Shopify's customer data request and erasure requests;
        if a customer asks us to remove a review they wrote, contact us and we will delete it.
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
