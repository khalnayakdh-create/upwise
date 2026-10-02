export const meta = () => [{ title: "Privacy policy · Storevine Cart Upsell" }];

const UPDATED = "October 1, 2026";
const CONTACT = "privacy@storevine.app";

export default function Privacy() {
  return (
    <article>
      <h1>Privacy policy — Storevine Cart Upsell</h1>
      <p><em>Last updated {UPDATED}</em></p>
      <p>
        Storevine Cart Upsell ("the App") is a Shopify app operated by Karj Trading LLC ("Storevine", "we"). This
        policy explains what the App collects when a merchant installs it on their Shopify store, and how we use
        and protect that information.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Store information</strong>: your shop's myshopify domain, install and uninstall dates, and your Storevine plan.</li>
        <li><strong>Access credentials</strong>: the access token Shopify issues when you install the App, used only to call Shopify on your behalf.</li>
        <li><strong>Offer settings</strong>: the offers you create (names, headlines, priorities) and the product IDs, titles, handles and image links you choose.</li>
        <li><strong>Aggregated usage counts</strong>: daily totals of how often each offer was shown, clicked and added to cart on your storefront, and daily counts of carts in each group of the holdout test.</li>
        <li><strong>Order totals for reporting</strong>: when an order is placed or refunded, the App reads it from Shopify and keeps only the order ID, date, currency, the amounts of items added from Storevine offers, the order subtotal, refunded amounts, and the holdout test group. Customer details in the order are not stored.</li>
      </ul>
      <p>
        The App does <strong>not</strong> store personal information about your customers — no names,
        email addresses, phone numbers, addresses or payment information. Storefront counts are anonymous totals
        and are not linked to any shopper. To run the holdout test, the storefront script keeps a random group
        letter in the shopper's browser storage and in a hidden cart attribute; it identifies no one.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To provide the App: show your offers in your store's cart and display results in your Storevine dashboard.</li>
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
        immediately and Shopify asks us to erase your store's data 48 hours later; we then delete all offers,
        settings, usage counts and order totals for your store. We honor Shopify's customer data request and erasure requests;
        because the App stores no customer personal data, there is nothing to return or delete for an individual
        customer.
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
