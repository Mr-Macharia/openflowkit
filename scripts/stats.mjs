#!/usr/bin/env node
// `npm run stats`: usage and feedback from the share Worker's D1 (`openflowkit-data`), plus public growth numbers.
// Read-only. D1 is reached through wrangler's own login (`npx wrangler login`), from worker/ so its config resolves.
// Every query is bounded by a day range on an indexed column. Imports the .ts contract: Node 22.18+ strips types.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { USAGE_EVENTS, PAY_OPTIONS } from '../src/services/usage/usageEvents.ts';

const WORKER_DIR = fileURLToPath(new URL('../worker/', import.meta.url));
const DATABASE = 'openflowkit-data';
const WORKERS_FREE_REQUESTS = 100_000;
const DAY_MS = 86_400_000;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const daysAgo = (n, from = today) => new Date(Date.parse(from) - n * DAY_MS).toISOString().slice(0, 10);
const plus = (day, n) => daysAgo(-n, day);
const d7 = daysAgo(6);
const d14 = daysAgo(13);
const d30 = daysAgo(29);
const d90 = daysAgo(89);

const sum = (events) => events.map((event) => `"${event}"`).join(' + ');
const FAMILIES = {
  created: USAGE_EVENTS.filter((event) => event.startsWith('created_')),
  repo_map: ['repo_map_ok'],
  ai: ['ai_applied'],
  agent: USAGE_EVENTS.filter((event) => event.startsWith('agent_')),
  share_link: ['share_view', 'share_edit'],
  export: USAGE_EVENTS.filter((event) => event.startsWith('export_')),
  code_panel: ['code_opened'],
  shared_copied: ['shared_copied'],
};

/** Runs statements in one wrangler call; returns one row array per statement, or throws with wrangler's message. */
function d1(statements) {
  let output;
  try {
    output = execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--command', statements.join(';\n')], {
      cwd: WORKER_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    let reason = text.split('\n').find((line) => /error|✘/i.test(line)) ?? error.message;
    try { reason = JSON.parse(error.stdout).error?.text ?? reason; } catch { /* not JSON */ }
    throw new Error(reason.trim());
  }
  return JSON.parse(output).map((result) => result.results ?? []);
}

function table(title, rows, columns = rows[0] ? Object.keys(rows[0]) : []) {
  console.log(`\n${title}`);
  if (!rows.length) { console.log('  (none yet)'); return; }
  const cells = rows.map((row) => columns.map((column) => (row[column] ?? '–').toString()));
  const widths = columns.map((column, i) => Math.max(column.length, ...cells.map((cell) => cell[i].length)));
  const numeric = columns.map((_, i) => cells.every((cell) => /^[-\d.,%*–]+$/.test(cell[i])));
  const line = (values) => '  ' + values.map((value, i) => numeric[i] ? value.padStart(widths[i]) : value.padEnd(widths[i])).join('  ');
  console.log(line(columns));
  for (const cell of cells) console.log(line(cell));
}
const pct = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '–');
const int = (value) => Number(value ?? 0).toLocaleString('en-US');

function section(name, run) {
  try { run(); } catch (error) { console.log(`\n${name}: unavailable — ${error.message.split('\n')[0]}`); }
}

// Weekly cohorts start on Monday (UTC); the last six complete-or-current weeks before this one.
const thisMonday = daysAgo((now.getUTCDay() + 6) % 7);
const cohorts = [6, 5, 4, 3, 2, 1].map((weeks) => daysAgo(7 * weeks, thisMonday));
const cohortSql = (start) => `SELECT COUNT(*) AS size,
  SUM(EXISTS(SELECT 1 FROM sessions s WHERE s.user = c.user AND s.day >= '${plus(start, 7)}' AND s.day < '${plus(start, 14)}')) AS w1,
  SUM(EXISTS(SELECT 1 FROM sessions s WHERE s.user = c.user AND s.day >= '${plus(start, 28)}' AND s.day < '${plus(start, 35)}')) AS w4
  FROM (SELECT DISTINCT user FROM sessions WHERE first_seen >= '${start}' AND first_seen < '${plus(start, 7)}') c`;
/** Retention for a window: '–' before it starts, '*' while it is still running. */
const retention = (count, size, windowStart) => {
  if (windowStart > today) return '–';
  return pct(count, size) + (plus(windowStart, 7) > today ? '*' : '');
};

console.log(`OpenFlowKit stats — ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC (D1 ${DATABASE})`);

section('Usage', () => {
  const [daily, fresh, reach, totals7, totals30, people30, activation, median, sources, countries, todayRows, ...cohortRows] = d1([
    `SELECT day, COUNT(DISTINCT user) AS people, SUM(session) AS sessions FROM sessions WHERE day >= '${d14}' GROUP BY day ORDER BY day`,
    `SELECT first_seen AS day, COUNT(DISTINCT user) AS new FROM sessions WHERE first_seen >= '${d14}' AND day >= '${d14}' GROUP BY first_seen`,
    `SELECT (SELECT COUNT(DISTINCT user) FROM sessions WHERE day >= '${d7}') AS wau,
       (SELECT COUNT(DISTINCT user) FROM sessions WHERE day >= '${d30}') AS mau,
       (SELECT COUNT(*) FROM (SELECT DISTINCT day, user FROM sessions WHERE day >= '${d30}')) / 30.0 AS avg_dau`,
    `SELECT ${USAGE_EVENTS.map((event) => `SUM("${event}") AS "${event}"`).join(', ')} FROM sessions WHERE day >= '${d7}'`,
    `SELECT ${USAGE_EVENTS.map((event) => `SUM("${event}") AS "${event}"`).join(', ')},
       SUM(CASE WHEN entry = 'shared' THEN session ELSE 0 END) AS shared_sessions FROM sessions WHERE day >= '${d30}'`,
    `SELECT COUNT(*) AS people, ${Object.entries(FAMILIES).map(([name]) => `SUM("${name}" > 0) AS "${name}"`).join(', ')}
       FROM (SELECT user, ${Object.entries(FAMILIES).map(([name, events]) => `SUM(${sum(events)}) AS "${name}"`).join(', ')}
       FROM sessions WHERE day >= '${d30}' GROUP BY user)`,
    `SELECT COUNT(*) AS people, SUM(made > 0) AS activated FROM (SELECT user, SUM(${sum(FAMILIES.created)}) AS made
       FROM sessions WHERE first_seen >= '${d30}' AND day >= '${d30}' AND day = first_seen GROUP BY user)`,
    `WITH d AS (SELECT SUM(active_seconds) AS s FROM sessions WHERE day >= '${d30}' GROUP BY user, day)
       SELECT s FROM d ORDER BY s LIMIT 1 OFFSET (SELECT MAX(COUNT(*) - 1, 0) / 2 FROM d)`,
    `SELECT source, COUNT(DISTINCT user) AS people FROM sessions WHERE day >= '${d30}' GROUP BY source ORDER BY people DESC LIMIT 10`,
    `SELECT country, COUNT(DISTINCT user) AS people FROM sessions WHERE day >= '${d30}' GROUP BY country ORDER BY people DESC LIMIT 10`,
    `SELECT COUNT(*) AS rows FROM sessions WHERE day = '${today}'`,
    ...cohorts.map(cohortSql),
  ]);

  const newByDay = Object.fromEntries(fresh.map((row) => [row.day, row.new]));
  const days = Array.from({ length: 14 }, (_, i) => daysAgo(13 - i));
  const byDay = Object.fromEntries(daily.map((row) => [row.day, row]));
  table('Daily active people (14 days, UTC; today is partial)', days.map((day) => ({
    day, people: int(byDay[day]?.people), new: int(newByDay[day]), sessions: int(byDay[day]?.sessions),
  })));

  const { wau, mau, avg_dau: avgDau } = reach[0] ?? {};
  const t30 = totals30[0] ?? {};
  const t7 = totals7[0] ?? {};
  const p30 = people30[0] ?? {};
  const act = activation[0] ?? {};
  table('Reach', [
    { metric: 'WAU (7 days)', value: int(wau) },
    { metric: 'MAU (30 days)', value: int(mau) },
    { metric: 'Stickiness (avg DAU / MAU)', value: pct(avgDau, mau) },
    { metric: 'Activation (new people who created on day 1, 30 days)', value: `${pct(act.activated, act.people)} of ${int(act.people)}` },
    { metric: 'Sessions per active person (30 days)', value: mau ? (t30.session / mau).toFixed(2) : '–' },
    { metric: 'Median active minutes per active day (30 days)', value: median[0] ? (median[0].s / 60).toFixed(1) : '–' },
  ]);

  table('Weekly retention (cohort = first-seen week; * = window still running)', cohortRows.map(([row = {}], i) => ({
    cohort: cohorts[i], people: int(row.size),
    week1: row.size ? retention(row.w1, row.size, plus(cohorts[i], 7)) : '–',
    week4: row.size ? retention(row.w4, row.size, plus(cohorts[i], 28)) : '–',
  })));

  table('Feature adoption (% of 30-day active people who used it)', Object.keys(FAMILIES).map((name) => ({
    feature: name, people: int(p30[name]), share: pct(p30[name], p30.people),
  })));
  table('Event totals', USAGE_EVENTS.map((event) => ({ event, '7 days': int(t7[event]), '30 days': int(t30[event]) })));
  table('Share loop (30 days)', [
    { step: 'share links made', count: int((t30.share_view ?? 0) + (t30.share_edit ?? 0)) },
    { step: 'sessions opened from a link', count: int(t30.shared_sessions) },
    { step: 'viewers who copied to edit', count: int(t30.shared_copied) },
  ]);
  console.log(`\nErrors: ${t30.session ? ((1000 * (t30.app_error ?? 0)) / t30.session).toFixed(1) : '–'} per 1k sessions (30 days)`);
  table('Top sources (30 days, by people; a person can appear under several)', sources);
  table('Top countries (30 days, by people)', countries);

  // ponytail: share-link requests aren't in D1, so this counts beacon rows only. Upgrade: the Workers analytics API.
  const rows = todayRows[0]?.rows ?? 0;
  const share = rows / WORKERS_FREE_REQUESTS;
  console.log(`\nWorker budget: ${int(rows)} beacons today of ${int(WORKERS_FREE_REQUESTS)} requests/day on Workers Free (${pct(rows, WORKERS_FREE_REQUESTS)}; share links not counted).`);
  if (share >= 0.6) console.log('  WARNING: over 60% — upgrade to Workers Paid ($5/month) before share links start failing.');
});

section('Feedback', () => {
  const [thumbs, pmf, pay, emails, comments] = d1([
    `SELECT feature, SUM(rating = 'up') AS up, SUM(rating = 'down') AS down FROM feedback
       WHERE created_at >= '${d90}' AND kind = 'feature' GROUP BY feature ORDER BY feature`,
    `SELECT pmf, COUNT(*) AS n FROM feedback WHERE created_at >= '${d90}' AND pmf IS NOT NULL GROUP BY pmf`,
    `SELECT ${PAY_OPTIONS.map((option) => `SUM(instr(',' || pay || ',', ',${option},') > 0) AS "${option}"`).join(', ')}
       FROM feedback WHERE created_at >= '${d90}' AND pay IS NOT NULL`,
    `SELECT COUNT(*) AS n FROM feedback WHERE created_at >= '${d90}' AND email IS NOT NULL`,
    `SELECT substr(created_at, 1, 10) AS day, kind, feature, text FROM feedback
       WHERE created_at >= '${d90}' AND text IS NOT NULL ORDER BY created_at DESC LIMIT 10`,
  ]);
  table('Feature thumbs (90 days)', thumbs.map((row) => ({ ...row, up_share: pct(row.up, row.up + row.down) })));
  const answers = Object.fromEntries(pmf.map((row) => [row.pmf, row.n]));
  const total = (answers.very ?? 0) + (answers.somewhat ?? 0) + (answers.not ?? 0);
  table('PMF: "How would you feel if you could no longer use OpenFlowKit?" (90 days)', ['very', 'somewhat', 'not'].map((answer) => ({
    disappointed: answer, people: int(answers[answer]), share: pct(answers[answer] ?? 0, total),
  })));
  console.log(`  ${pct(answers.very ?? 0, total)} very disappointed of ${int(total)} (40% is the usual PMF bar)`);
  table('Would pay for (90 days, votes)', PAY_OPTIONS.map((option) => ({ option, votes: int(pay[0]?.[option]) })));
  console.log(`\nEmails left: ${int(emails[0]?.n)} (90 days)`);
  console.log('\nLatest comments');
  if (!comments.length) console.log('  (none yet)');
  for (const row of comments) console.log(`  ${row.day} ${row.kind}${row.feature ? `/${row.feature}` : ''}: ${row.text.replace(/\s+/g, ' ')}`);
});

async function publicNumber(label, url, pick) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'openflowkit-stats', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`  ${label}: ${int(pick(await response.json()))}`);
  } catch (error) {
    console.log(`  ${label}: unavailable — ${error.message}`);
  }
}
console.log('\nPublic growth');
await publicNumber('npm downloads last week (@vrun-design/openflowkit-mcp)',
  'https://api.npmjs.org/downloads/point/last-week/@vrun-design/openflowkit-mcp', (body) => body.downloads);
await publicNumber('GitHub stars (Vrun-design/openflowkit)', 'https://api.github.com/repos/Vrun-design/openflowkit', (body) => body.stargazers_count);
