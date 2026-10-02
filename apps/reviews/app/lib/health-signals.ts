import type { D1Database } from "@cloudflare/workers-types";
import type { HealthSignal } from "@upwise/platform";

const OVERDUE_HOURS = 6;


/** Review-request emails failing, or due emails not going out at all. */
export async function reviewSignals(d1: D1Database, shop: string, now = new Date()): Promise<HealthSignal[]> {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const overdueBefore = new Date(now.getTime() - OVERDUE_HOURS * 3_600_000).toISOString();
  const row = await d1
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'failed' AND sent_at >= ?2 THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'sent' AND sent_at >= ?2 THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'scheduled' AND send_after < ?3 THEN 1 ELSE 0 END) AS overdue
       FROM review_request WHERE shop = ?1`,
    )
    .bind(shop, dayAgo, overdueBefore)
    .first<{ failed: number | null; sent: number | null; overdue: number | null }>();
  const failed = Number(row?.failed ?? 0);
  const sent = Number(row?.sent ?? 0);
  const overdue = Number(row?.overdue ?? 0);
  return [
    {
      key: "request_failures",
      problem:
        failed > 0 && failed >= sent
          ? `${failed} review request email${failed === 1 ? "" : "s"} failed to send in the last day. See Settings > Recent requests for the reason.`
          : null,
    },
    {
      key: "request_backlog",
      problem: overdue > 0 ? `${overdue} review request email${overdue === 1 ? " is" : "s are"} overdue and not sending.` : null,
    },
  ];
}
