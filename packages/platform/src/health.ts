/**
 * Health alerts: catch "silent failures" (widget stopped showing, emails stopped
 * sending) before the merchant does.
 *
 * Each app supplies signals for a shop; once a day the app's cron calls
 * runHealthCheck(). A shop with a problem gets an in-app banner (state stored in
 * the app's app_setting table under key "health") and at most one email per
 * problem per ALERT_COOLDOWN_DAYS. When the signal recovers the banner clears.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { isNull } from "drizzle-orm";
import { getDb } from "./db";
import { shopTable } from "./schema";

export interface HealthSignal {
  key: string;
  /** Problem description shown to the merchant, or null when healthy. */
  problem: string | null;
}

export interface HealthState {
  problems: Array<{ key: string; problem: string; since: string }>;
  /** When each problem key was last emailed about. */
  alerted: Record<string, string>;
  checkedAt: string;
}

export const ALERT_COOLDOWN_DAYS = 7;
/** Below this many events a day there's too little traffic to call zero a failure. */
export const MIN_DAILY_BASELINE = 5;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Turn daily counts into a signal: a problem when yesterday was 0 but the
 * previous 7 days averaged at least `minBaseline` a day.
 */
export function dropToZeroSignal(
  key: string,
  label: string,
  rows: Array<{ day: string; n: number }>,
  now = new Date(),
  minBaseline = MIN_DAILY_BASELINE,
): HealthSignal {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.n) || 0]));
  const day = (offset: number) => dayKey(new Date(now.getTime() - offset * 86_400_000));
  const yesterday = byDay.get(day(1)) ?? 0;
  let total = 0;
  for (let i = 2; i <= 8; i++) total += byDay.get(day(i)) ?? 0;
  const baseline = total / 7;
  if (yesterday === 0 && baseline >= minBaseline) {
    return { key, problem: `No ${label} yesterday (usually about ${Math.round(baseline)} a day).` };
  }
  return { key, problem: null };
}

/** Earliest day (YYYY-MM-DD) that dropToZeroSignal needs. */
export const signalWindowStart = (now = new Date()) => dayKey(new Date(now.getTime() - 8 * 86_400_000));

export async function getHealthState(d1: D1Database, shop: string): Promise<HealthState | null> {
  const row = await d1
    .prepare("SELECT value FROM app_setting WHERE shop = ? AND key = 'health'")
    .bind(shop)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as HealthState;
  } catch {
    return null;
  }
}

async function setHealthState(d1: D1Database, shop: string, state: HealthState) {
  await d1
    .prepare(
      "INSERT INTO app_setting (shop, key, value) VALUES (?, 'health', ?) ON CONFLICT (shop, key) DO UPDATE SET value = excluded.value",
    )
    .bind(shop, JSON.stringify(state))
    .run();
}

export interface HealthRunOptions {
  d1: D1Database;
  signalsFor(shop: string): Promise<HealthSignal[]>;
  /** Send one alert for the given new problems. Throwing is logged and retried next run. */
  notify(shop: string, problems: Array<{ key: string; problem: string }>): Promise<void>;
  now?: Date;
}

/** Check every installed shop. Returns counts for logging. */
export async function runHealthCheck(opts: HealthRunOptions) {
  const now = opts.now ?? new Date();
  const shops = await getDb(opts.d1).select({ shop: shopTable.shop }).from(shopTable).where(isNull(shopTable.uninstalledAt));
  const counts = { shops: shops.length, withProblems: 0, alerted: 0, errors: 0 };
  for (const { shop } of shops) {
    try {
      const signals = await opts.signalsFor(shop);
      const prev = await getHealthState(opts.d1, shop);
      const problems = signals
        .filter((s): s is HealthSignal & { problem: string } => Boolean(s.problem))
        .map((s) => ({ key: s.key, problem: s.problem, since: prev?.problems.find((p) => p.key === s.key)?.since ?? now.toISOString() }));
      const alerted = { ...(prev?.alerted ?? {}) };
      const cooldown = ALERT_COOLDOWN_DAYS * 86_400_000;
      const fresh = problems.filter((p) => !alerted[p.key] || now.getTime() - Date.parse(alerted[p.key]) >= cooldown);
      if (problems.length) counts.withProblems++;
      if (fresh.length) {
        try {
          await opts.notify(shop, fresh.map(({ key, problem }) => ({ key, problem })));
          for (const p of fresh) alerted[p.key] = now.toISOString();
          counts.alerted++;
        } catch (error) {
          counts.errors++;
          console.error("health alert failed", shop, error instanceof Error ? error.message : error);
        }
      }
      if (problems.length || prev) {
        await setHealthState(opts.d1, shop, { problems, alerted, checkedAt: now.toISOString() });
      }
    } catch (error) {
      counts.errors++;
      console.error("health check failed", shop, error instanceof Error ? error.message : error);
    }
  }
  return counts;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Merchant alert email. Plain and specific: what broke, where to look. */
export const DEFAULT_HEALTH_CAUSES =
  "Common causes: the app block or embed was removed or turned off in a theme change, the theme was switched, or the products in it went out of stock.";

export function buildHealthEmail(args: { appName: string; shopName: string; problems: string[]; adminUrl: string; causes?: string }) {
  const causes = args.causes ?? DEFAULT_HEALTH_CAUSES;
  const subject = `${args.appName}: something needs a look on ${args.shopName}`.slice(0, 140);
  const items = args.problems.map((p) => `<li>${esc(p)}</li>`).join("");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<p>Hi,</p>
<p>Our daily check of <strong>${esc(args.appName)}</strong> on ${esc(args.shopName)} found:</p>
<ul>${items}</ul>
<p>${esc(causes)}</p>
<p><a href="${esc(args.adminUrl)}" style="color:#1a1a1a">Open ${esc(args.appName)}</a> to check. If everything is as you intended, you can ignore this; we only email once a week per issue.</p>
<p>— Storevine</p>
</body></html>`;
  const text = [
    `Our daily check of ${args.appName} on ${args.shopName} found:`,
    ...args.problems.map((p) => `- ${p}`),
    "",
    causes,
    `Open the app: ${args.adminUrl}`,
    "We only email once a week per issue.",
  ].join("\n");
  return { subject, html, text };
}
