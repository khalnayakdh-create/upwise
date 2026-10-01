export const meta = () => [{ title: "Terms of service · Upwise Bundles" }];

const UPDATED = "October 1, 2026";
const CONTACT = "support@upwise.dev";

export default function Terms() {
  return (
    <article>
      <h1>Terms of service — Upwise Bundles</h1>
      <p><em>Last updated {UPDATED}</em></p>
      <p>
        These terms apply to your use of Upwise Bundles ("the App"), provided by Karj Trading LLC ("Upwise",
        "we"). By installing the App you agree to these terms and to Shopify's terms for apps.
      </p>
      <h2>The service</h2>
      <p>
        The App lets you show product bundles on your store and discount them automatically at checkout. We work to keep it available and
        accurate but provide it "as is", without warranties of any kind, and we may change or discontinue features.
      </p>
      <h2>Plans and billing</h2>
      <p>
        The Free plan costs nothing. Paid plans are billed by Shopify on your Shopify invoice every 30 days at the
        price shown when you approve the charge, after any free trial. You can switch plans or cancel at any time
        from the App or by uninstalling it; Shopify handles proration and refunds according to its billing rules.
      </p>
      <h2>Your responsibilities</h2>
      <p>
        You are responsible for the products and content you choose to promote and for complying with laws that
        apply to your store. Don't use the App to mislead shoppers or to interfere with Shopify or the App.
      </p>
      <h2>Liability</h2>
      <p>
        To the extent permitted by law, Upwise is not liable for indirect or consequential losses, and our total
        liability is limited to the fees you paid for the App in the 12 months before the claim.
      </p>
      <h2>Privacy</h2>
      <p>Our <a href="/legal/privacy">privacy policy</a> explains what data the App uses.</p>
      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will show the date above. Questions:{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </article>
  );
}
