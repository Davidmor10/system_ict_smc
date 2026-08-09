// ─────────────────────────────────────────────────────────────────────────────
// Israel-time date helpers. Pure — safe to call anywhere.
//
// The whole pipeline speaks Israel dates: "today" for insights, DoW for the
// starter-tier cadence gate. Centralizing here means DST handling lives in
// one place and every consumer gets it right by construction.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'Asia/Jerusalem';

/** Today in Israel as 'YYYY-MM-DD'. Uses Intl (not raw arithmetic) so DST is
 *  the platform's problem, not ours. */
export function israelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Yesterday in Israel as 'YYYY-MM-DD'.
 *
 *  This is the *trading day* the nightly run analyzes. The cron fires at
 *  01:00 UTC — 03:00/04:00 in Israel — so by the time it runs, the Israel
 *  calendar has already rolled over. Targeting israelToday() there would ask
 *  for trades from a day that is three hours old and always empty.
 *
 *  Implemented by subtracting a day from the *already-localized* date string
 *  rather than from the instant, so a DST shift can't move the answer. */
export function israelYesterday(now: Date = new Date()): string {
  const [y, m, d] = israelToday(now).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return prev.toISOString().slice(0, 10);
}

/** Day-of-week in Israel: Sunday=0 … Saturday=6. */
export function israelDayOfWeek(now: Date = new Date()): number {
  const day = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' });
  const map: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  return map[day] ?? now.getDay();
}

/** Deterministic hash → integer >= 0. Used to spread users across the run
 *  window: same clerk_id → same slot every night → stable "when do I get my
 *  insight" experience for the trader. Not cryptographic — collisions are
 *  fine, they just mean two users share a minute (worker still processes
 *  them safely via SKIP LOCKED). */
export function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** When to schedule this user's job. `spreadMinutes` = the size of the load
 *  window (60 by default per Step 5). Returns a Date `now + (hash % window)`
 *  minutes — evenly-distributed, deterministic per clerk_id. */
export function scheduleSlotFor(
  clerkId: string,
  spreadMinutes: number,
  now: Date = new Date(),
): Date {
  const slot = stableHash(clerkId) % Math.max(1, spreadMinutes);
  return new Date(now.getTime() + slot * 60_000);
}
