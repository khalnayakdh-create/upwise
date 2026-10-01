export const meta = () => [{ title: "Privacy policy · Storevine Pop-ups" }];

const UPDATED = "October 1, 2026";
const CONTACT = "privacy@storevine.app";

export default function Privacy() {
  return (
    <article>
      <h1>Privacy policy — Storevine Pop-ups</h1>
      <p><em>Last updated {UPDATED}</em></p>
      <p>
        Storevine Pop-ups ("the App") is a Shopify app operated by Karj Trading LLC ("Storevine", "we"). This
        policy explains what the App collects when a merchant installs it on their Shopify store, and how we use
        and protect that information.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Store information</strong>: your shop's myshopify domain, install and uninstall dates, and your Storevine plan.</li>
        <li><strong>Access credentials</strong>: the access token Shopify issues when you install the App.</li>
        <li><strong>Pop-up settings</strong>: the text, colors and display rules you choose.</li>
        <li><strong>Anonymous counts</strong>: daily totals of pop-up views and sign-ups.</li>
        <li>
          <strong>Sign-up emails</strong>: when a visitor enters their email and agrees to receive marketing, the App sends
          the address directly to your Shopify store, where it's saved as a customer subscribed to email marketing. Storevine
          does not keep a copy.
        </li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To provide the App: show your pop-up and add sign-ups to your Shopify customers.</li>
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
        immediately and Shopify asks us to erase your store's data 48 hours later; we then delete your pop-up settings and counts. We honor Shopify's customer data request and erasure requests;
        Sign-up emails live in your Shopify store as customers; Shopify's own data request and erasure processes cover them, and Storevine holds no copy to return or delete.
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
