import { Outlet } from "react-router";

/** Shared shell for public legal pages (privacy, terms). */
export default function LegalLayout() {
  return (
    <main
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 20px",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <Outlet />
      <hr style={{ margin: "40px 0 16px", border: 0, borderTop: "1px solid #ddd" }} />
      <p style={{ fontSize: 14, color: "#555" }}>
        Storevine is operated by Karj Trading LLC. <a href="/legal/privacy">Privacy policy</a> ·{" "}
        <a href="/legal/terms">Terms of service</a>
      </p>
    </main>
  );
}
