// Every number the stats page (stats/index.ts) and `npm run stats` (scripts/stats.mjs) show comes from loadStats,
// so the terminal and the page can't disagree. Each statement is bounded by a day range on an indexed column
// (sessions.day, sessions.first_seen, sessions(user, day), feedback.created_at).
// Plain TypeScript with no parameter properties or enums: Node runs this file directly by stripping types.
import {
  MAX_PRO_PRICE, PAY_OPTIONS, PRO_PLANS, USAGE_EVENTS, type PayOption, type ProPlan, type UsageEvent,
} from '../src/services/usage/usageEvents.ts';

export interface Query { readonly sql: string; readonly params: readonly (string | number)[] }
export type Row = Record<string, unknown>;
/** Runs the statements in one round trip (a D1 batch, one wrangler call); one row array per statement. */
export type Run = (queries: readonly Query[]) => Promise<Row[][]>;

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
/** Requests a month included in Workers Paid ($5); beyond it, $0.30 per million. */
export const WORKERS_PAID_REQUESTS = 10_000_000;
/** Day-N retention: back exactly N days after the first day. */
export const RETENTION_DAYS = [1, 7, 30] as const;
/** Unread feedback older than this is not shown. ponytail: a year of unread is a reading problem, not a query one. */
const UNREAD_DAYS = 365;
const DAY_MS = 86_400_000;

export const shiftDay = (day: string, n: number): string => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
const num = (value: unknown): number => Number(value ?? 0) || 0;
const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const sum = (events: readonly string[]): string => events.map((event) => `"${event}"`).join(' + ');

export const FAMILIES: Record<string, readonly UsageEvent[]> = {
  created: USAGE_EVENTS.filter((event) => event.startsWith('created_')),
  repo_map: ['repo_map_ok'],
  ai: ['ai_applied'],
  agent: USAGE_EVENTS.filter((event) => event.startsWith('agent_')),
  share_link: ['share_view', 'share_edit'],
  export: USAGE_EVENTS.filter((event) => event.startsWith('export_')),
  code_panel: ['code_opened'],
  shared_copied: ['shared_copied'],
};

export interface RetentionCell {
  /** Share of the cohort seen in the window; null when the cohort is empty or the window hasn't started. */
  readonly rate: number | null;
  /** pending: window not started; running: started, not over (shown with *); closed: final. */
  readonly state: 'pending' | 'running' | 'closed';
}
export interface FeedbackRow {
  readonly id: number; readonly created_at: string; readonly kind: string; readonly feature: string | null;
  readonly rating: string | null; readonly pmf: string | null; readonly pay: string | null;
  readonly plan: string | null; readonly price: number | null; readonly text: string | null;
  readonly email: string | null; readonly version: string; readonly country: string;
}
export interface Ranked { readonly name: string; readonly people: number }

export interface Stats {
  readonly days: RangeDays; readonly from: string; readonly today: string; readonly generatedAt: string;
  readonly daily: readonly { day: string; people: number; new: number; sessions: number }[];
  /** dau = today (partial); wau/mau = the last 7/30 days whatever the range; active = people in the range. */
  readonly reach: { dau: number; wau: number; mau: number; avgDau: number; stickiness: number | null; newThisWeek: number; active: number };
  readonly activation: { people: number; activated: number; rate: number | null };
  /** Of new people in the range, by where they came from: who created something on day one. */
  readonly activationBySource: readonly { name: string; people: number; activated: number; rate: number | null }[];
  /** Day 1, 7, 30: of people first seen in the range at least N days ago, the share back exactly on day N. */
  readonly dayRetention: readonly { day: (typeof RETENTION_DAYS)[number]; size: number; rate: number | null }[];
  readonly sessionsPerPerson: number | null;
  readonly medianMinutes: number | null;
  readonly adoption: readonly { family: string; people: number; share: number | null }[];
  readonly sources: readonly Ranked[];
  readonly countries: readonly Ranked[];
  readonly totals: Readonly<Record<UsageEvent, number>>;
  readonly share: { view: number; edit: number; sharedSessions: number; copied: number };
  readonly retention: readonly { cohort: string; size: number; week1: RetentionCell; week4: RetentionCell }[];
  readonly errorsPer1k: number | null;
  /** Usage beacons (Worker requests) in the last 30 days against the Paid plan's monthly allowance. */
  readonly budget: { requests: number; share: number };
  readonly thumbs: readonly { feature: string; up: number; down: number }[];
  readonly pmf: { very: number; somewhat: number; not: number; total: number; veryShare: number | null };
  /** "What would you pay for" from feedback prompts; the Pro waitlist's picks are in `pro.features`. */
  readonly pay: Readonly<Record<PayOption, number>>;
  readonly emails: number;
  /** Pro waitlist: people who opened it (of `reach.active`), entries by plan, fair price (dollars a month), features picked. */
  readonly pro: {
    readonly opened: number; readonly joined: number; readonly joinRate: number | null;
    readonly plans: Readonly<Record<ProPlan, number>>;
    readonly price: { readonly answered: number; readonly median: number | null; readonly bands: readonly { label: string; people: number }[] };
    readonly features: Readonly<Record<PayOption, number>>;
  };
  readonly comments: readonly { day: string; kind: string; feature: string | null; text: string }[];
  /** null when D1 lacks `feedback.read_at` (migration 0002 not applied). */
  readonly unread: { count: number; items: readonly FeedbackRow[] } | null;
}

const q = (sql: string, ...params: (string | number)[]): Query => ({ sql, params });
/** Fair-price bands for the waitlist's slider answers: [label, from, below]. The top band is the slider's "or more". */
const PRICE_BANDS: readonly (readonly [string, number, number])[] = [
  ['Under $5', 0, 5], ['$5–9', 5, 10], ['$10–14', 10, 15], ['$15–19', 15, 20], ['$20–29', 20, 30], [`$30–${MAX_PRO_PRICE}+`, 30, MAX_PRO_PRICE + 1],
];
/** One count per PAY_OPTIONS entry over feedback.pay (a comma list). */
const payColumns = PAY_OPTIONS.map((option) => `SUM(instr(',' || pay || ',', ',${option},') > 0) AS "${option}"`).join(', ');

/** Weekly cohorts (first-seen week, Monday UTC): the six weeks before this one. */
export function cohortStarts(today: string): string[] {
  const monday = shiftDay(today, -((new Date(today).getUTCDay() + 6) % 7));
  return [6, 5, 4, 3, 2, 1].map((weeks) => shiftDay(monday, -7 * weeks));
}

function retentionCell(count: number, size: number, windowStart: string, today: string): RetentionCell {
  if (windowStart > today) return { rate: null, state: 'pending' };
  return { rate: ratio(count, size), state: shiftDay(windowStart, 7) > today ? 'running' : 'closed' };
}

export async function loadStats(run: Run, now: Date, days: RangeDays): Promise<Stats> {
  const today = now.toISOString().slice(0, 10);
  const from = shiftDay(today, -(days - 1));
  const d7 = shiftDay(today, -6);
  const d30 = shiftDay(today, -29);
  const unreadFrom = shiftDay(today, -UNREAD_DAYS);
  const cohorts = cohortStarts(today);
  const families = Object.entries(FAMILIES);

  const results = await run([
    q('SELECT day, COUNT(DISTINCT user) AS people, SUM(session) AS sessions FROM sessions WHERE day >= ? GROUP BY day ORDER BY day', from),
    q('SELECT first_seen AS day, COUNT(DISTINCT user) AS new FROM sessions WHERE first_seen >= ? AND day >= ? GROUP BY first_seen', from, from),
    q(`SELECT (SELECT COUNT(DISTINCT user) FROM sessions WHERE day = ?) AS dau,
       (SELECT COUNT(DISTINCT user) FROM sessions WHERE day >= ?) AS wau,
       (SELECT COUNT(DISTINCT user) FROM sessions WHERE day >= ?) AS mau,
       (SELECT COUNT(*) FROM (SELECT DISTINCT day, user FROM sessions WHERE day >= ?)) AS user_days,
       (SELECT COUNT(DISTINCT user) FROM sessions WHERE first_seen >= ? AND day >= ?) AS new_week,
       (SELECT COUNT(DISTINCT user) FROM sessions WHERE day >= ?) AS active`, today, d7, d30, d30, d7, d7, from),
    q(`SELECT ${USAGE_EVENTS.map((event) => `SUM("${event}") AS "${event}"`).join(', ')},
       SUM(CASE WHEN entry = 'shared' THEN session ELSE 0 END) AS shared_sessions FROM sessions WHERE day >= ?`, from),
    q(`SELECT COUNT(*) AS people, ${families.map(([name]) => `SUM("${name}" > 0) AS "${name}"`).join(', ')}
       FROM (SELECT user, ${families.map(([name, events]) => `SUM(${sum(events)}) AS "${name}"`).join(', ')}
       FROM sessions WHERE day >= ? GROUP BY user)`, from),
    q(`SELECT COUNT(*) AS people, SUM(made > 0) AS activated FROM (SELECT user, SUM(${sum(FAMILIES.created)}) AS made
       FROM sessions WHERE first_seen >= ? AND day >= ? AND day = first_seen GROUP BY user)`, from, from),
    q(`WITH d AS (SELECT SUM(active_seconds) AS s FROM sessions WHERE day >= ? GROUP BY user, day)
       SELECT s FROM d ORDER BY s LIMIT 1 OFFSET (SELECT MAX(COUNT(*) - 1, 0) / 2 FROM d)`, from),
    q('SELECT source AS name, COUNT(DISTINCT user) AS people FROM sessions WHERE day >= ? GROUP BY source ORDER BY people DESC, name LIMIT 10', from),
    q('SELECT country AS name, COUNT(DISTINCT user) AS people FROM sessions WHERE day >= ? GROUP BY country ORDER BY people DESC, name LIMIT 10', from),
    q('SELECT COALESCE(SUM(beacons), 0) AS n FROM sessions WHERE day >= ?', d30),
    q(`SELECT feature, SUM(rating = 'up') AS up, SUM(rating = 'down') AS down FROM feedback
       WHERE created_at >= ? AND kind = 'feature' GROUP BY feature ORDER BY feature`, from),
    q('SELECT pmf, COUNT(*) AS n FROM feedback WHERE created_at >= ? AND pmf IS NOT NULL GROUP BY pmf', from),
    q(`SELECT ${payColumns} FROM feedback WHERE created_at >= ? AND kind <> 'pro' AND pay IS NOT NULL`, from),
    q('SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ? AND email IS NOT NULL', from),
    q(`SELECT substr(created_at, 1, 10) AS day, kind, feature, text FROM feedback
       WHERE created_at >= ? AND text IS NOT NULL ORDER BY created_at DESC LIMIT 10`, from),
    q('SELECT COUNT(DISTINCT user) AS n FROM sessions WHERE day >= ? AND pro_opened > 0', from),
    // ponytail: one row per entry; someone who joins twice counts twice. Dedupe by email if that shows up.
    q(`SELECT ${PRO_PLANS.map((plan) => `SUM(plan = '${plan}') AS "${plan}"`).join(', ')},
       ${PRICE_BANDS.map(([, low, high], i) => `SUM(price >= ${low} AND price < ${high}) AS "band${i}"`).join(', ')}, ${payColumns}
       FROM feedback WHERE created_at >= ? AND kind = 'pro'`, from),
    q(`WITH p AS (SELECT price FROM feedback WHERE created_at >= ? AND kind = 'pro' AND price IS NOT NULL)
       SELECT price FROM p ORDER BY price LIMIT 1 OFFSET (SELECT MAX(COUNT(*) - 1, 0) / 2 FROM p)`, from),
    q(`SELECT source AS name, COUNT(*) AS people, SUM(made > 0) AS activated FROM (SELECT user, source, SUM(${sum(FAMILIES.created)}) AS made
       FROM sessions WHERE first_seen >= ? AND day >= ? AND day = first_seen GROUP BY user)
       GROUP BY source ORDER BY people DESC, name LIMIT 10`, from, from),
    ...RETENTION_DAYS.map((n) => q(`SELECT COUNT(*) AS size,
       SUM(EXISTS(SELECT 1 FROM sessions s WHERE s.user = c.user AND s.day = date(c.first_seen, '+${n} day'))) AS back
       FROM (SELECT DISTINCT user, first_seen FROM sessions WHERE first_seen >= ? AND first_seen <= ? AND day = first_seen) c`,
    from, shiftDay(today, -n))),
    ...cohorts.map((start) => q(`SELECT COUNT(*) AS size,
       SUM(EXISTS(SELECT 1 FROM sessions s WHERE s.user = c.user AND s.day >= ? AND s.day < ?)) AS w1,
       SUM(EXISTS(SELECT 1 FROM sessions s WHERE s.user = c.user AND s.day >= ? AND s.day < ?)) AS w4
       FROM (SELECT DISTINCT user FROM sessions WHERE first_seen >= ? AND first_seen < ?) c`,
    shiftDay(start, 7), shiftDay(start, 14), shiftDay(start, 28), shiftDay(start, 35), start, shiftDay(start, 7))),
  ]);
  const [daily, fresh, [reachRow = {}], [totalsRow = {}], [adoptionRow = {}], [activationRow = {}], median, sources, countries,
    [budgetRow = {}], thumbs, pmfRows, [payRow = {}], [emailRow = {}], comments, [proOpenedRow = {}], [proRow = {}], proMedian,
    bySource, ...rest] = results;
  const dayRows = rest.slice(0, RETENTION_DAYS.length);
  const cohortRows = rest.slice(RETENTION_DAYS.length);
  const unread = await loadUnread(run, unreadFrom);

  const byDay = new Map(daily.map((row) => [String(row.day), row]));
  const newByDay = new Map(fresh.map((row) => [String(row.day), num(row.new)]));
  const totals = Object.fromEntries(USAGE_EVENTS.map((event) => [event, num(totalsRow[event])])) as Record<UsageEvent, number>;
  const mau = num(reachRow.mau);
  const avgDau = num(reachRow.user_days) / 30;
  const active = num(reachRow.active);
  const adoptionBase = num(adoptionRow.people);
  const activation = { people: num(activationRow.people), activated: num(activationRow.activated) };
  const answers = Object.fromEntries(pmfRows.map((row) => [String(row.pmf), num(row.n)]));
  const pmf = { very: num(answers.very), somewhat: num(answers.somewhat), not: num(answers.not) };
  const pmfTotal = pmf.very + pmf.somewhat + pmf.not;
  const requests = num(budgetRow.n);
  const plans = Object.fromEntries(PRO_PLANS.map((plan) => [plan, num(proRow[plan])])) as Record<ProPlan, number>;
  const joined = PRO_PLANS.reduce((total, plan) => total + plans[plan], 0);
  const proOpened = num(proOpenedRow.n);
  const ranked = (list: Row[]): Ranked[] => list.map((row) => ({ name: String(row.name), people: num(row.people) }));

  return {
    days, from, today, generatedAt: now.toISOString(),
    daily: Array.from({ length: days }, (_, i) => {
      const day = shiftDay(from, i);
      return { day, people: num(byDay.get(day)?.people), new: newByDay.get(day) ?? 0, sessions: num(byDay.get(day)?.sessions) };
    }),
    reach: { dau: num(reachRow.dau), wau: num(reachRow.wau), mau, avgDau, stickiness: ratio(avgDau, mau), newThisWeek: num(reachRow.new_week), active },
    activation: { ...activation, rate: ratio(activation.activated, activation.people) },
    activationBySource: bySource.map((row) => ({
      name: String(row.name), people: num(row.people), activated: num(row.activated), rate: ratio(num(row.activated), num(row.people)),
    })),
    dayRetention: RETENTION_DAYS.map((day, i) => {
      const row = dayRows[i]?.[0] ?? {};
      return { day, size: num(row.size), rate: ratio(num(row.back), num(row.size)) };
    }),
    sessionsPerPerson: ratio(totals.session, active),
    medianMinutes: median[0] ? num(median[0].s) / 60 : null,
    adoption: families.map(([family]) => ({ family, people: num(adoptionRow[family]), share: ratio(num(adoptionRow[family]), adoptionBase) })),
    sources: ranked(sources),
    countries: ranked(countries),
    totals,
    share: { view: totals.share_view, edit: totals.share_edit, sharedSessions: num(totalsRow.shared_sessions), copied: totals.shared_copied },
    retention: cohorts.map((cohort, i) => {
      const row = cohortRows[i]?.[0] ?? {};
      const size = num(row.size);
      return {
        cohort, size,
        week1: retentionCell(num(row.w1), size, shiftDay(cohort, 7), today),
        week4: retentionCell(num(row.w4), size, shiftDay(cohort, 28), today),
      };
    }),
    errorsPer1k: totals.session > 0 ? (1000 * totals.app_error) / totals.session : null,
    budget: { requests, share: requests / WORKERS_PAID_REQUESTS },
    thumbs: thumbs.map((row) => ({ feature: String(row.feature), up: num(row.up), down: num(row.down) })),
    pmf: { ...pmf, total: pmfTotal, veryShare: ratio(pmf.very, pmfTotal) },
    pay: Object.fromEntries(PAY_OPTIONS.map((option) => [option, num(payRow[option])])) as Record<PayOption, number>,
    emails: num(emailRow.n),
    pro: {
      opened: proOpened, joined, joinRate: ratio(joined, proOpened), plans,
      price: {
        answered: PRICE_BANDS.reduce((total, _, i) => total + num(proRow[`band${i}`]), 0),
        median: proMedian[0] ? num(proMedian[0].price) : null,
        bands: PRICE_BANDS.map(([label], i) => ({ label, people: num(proRow[`band${i}`]) })),
      },
      features: Object.fromEntries(PAY_OPTIONS.map((option) => [option, num(proRow[option])])) as Record<PayOption, number>,
    },
    comments: comments.map((row) => ({ day: String(row.day), kind: String(row.kind), feature: (row.feature as string | null) ?? null, text: String(row.text) })),
    unread,
  };
}

/** Its own batch: before migration 0002 (`read_at`) reaches D1 the rest of the numbers still load. */
async function loadUnread(run: Run, from: string): Promise<Stats['unread']> {
  try {
    const [[countRow = {}], items] = await run([
      q('SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ? AND read_at IS NULL', from),
      q(`SELECT id, created_at, kind, feature, rating, pmf, pay, plan, price, text, email, version, country FROM feedback
         WHERE created_at >= ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 100`, from),
    ]);
    return { count: num(countRow.n), items: items as unknown as FeedbackRow[] };
  } catch {
    return null;
  }
}

/** "Mark all read": only what the page showed (created at or before `before`), so feedback that arrived since stays unread. */
export function markReadQuery(now: Date, before: string): Query {
  return q('UPDATE feedback SET read_at = ? WHERE created_at >= ? AND created_at <= ? AND read_at IS NULL',
    now.toISOString(), shiftDay(now.toISOString().slice(0, 10), -UNREAD_DAYS), before);
}

/** For `wrangler d1 execute --command`, which takes no bound parameters: quotes each `?` value as an SQL literal. */
export function inlineParams({ sql, params }: Query): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const value = params[i++];
    if (value === undefined) throw new Error(`missing parameter ${i} for: ${sql}`);
    return typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
  });
}

// One formatting for both readers. '—' is "no data", never 0%.
export const DASH = '—';
export const pct = (value: number | null, digits = 1): string => (value === null || !Number.isFinite(value) ? DASH : `${(100 * value).toFixed(digits)}%`);
export const int = (value: number | null): string => (value === null || !Number.isFinite(value) ? DASH : Math.round(value).toLocaleString('en-US'));
export const fixed = (value: number | null, digits = 1): string => (value === null || !Number.isFinite(value) ? DASH : value.toFixed(digits));
export const retentionLabel = (cell: RetentionCell): string =>
  cell.state === 'pending' || cell.rate === null ? DASH : pct(cell.rate, 0) + (cell.state === 'running' ? '*' : '');
