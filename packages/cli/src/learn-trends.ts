// Renders the proxy's optional `trends` block (caveman.learn.v1): week-over-week
// change per UTC ISO week from scanned sessions. Observation only: medians and
// pooled shares with n, no currency, and a trend is never a saving. Older
// proxies omit the block; every renderer returns [] then.

export type LearnTrendMetric = {
  key: string;
  label: string;
  unit: "tokens" | "pct" | "per_100_turns" | "points" | string;
  better: "lower" | "higher";
  statistic: string;
  series: (number | null)[];
  current?: number;
  prior?: number;
  current_sessions: number;
  prior_sessions: number;
  delta_pct?: number;
  direction: "improved" | "worse" | "flat" | "insufficient_data";
};

export type LearnTrends = {
  basis: "inferred";
  bucket: string;
  current_week: string;
  prior_weeks: number;
  min_sessions: number;
  dead_band_pct: number;
  undated_sessions?: number;
  weeks: { week: string; start: string; partial?: boolean; in_progress?: boolean; sessions: number; turns: number; insufficient_data?: boolean }[];
  metrics: LearnTrendMetric[];
  score?: { source: string; omitted: string; history_source?: string; history?: { date: string; score: number }[] };
  movers?: {
    since: string;
    days: number;
    grew?: LearnTrendMover[];
    shrank?: LearnTrendMover[];
  };
  note: string;
};

type LearnTrendMover = { sink_id: string; title: string; status: string; delta_tokens_per_turn: number };

const BARS = "▁▂▃▄▅▆▇█";
const COMPACT_KEYS = ["tokens_per_session", "peak_context_pct", "dumbzone_turn_pct"];

export function learnSparkline(series: (number | null)[]): string {
  const values = series.filter((value): value is number => typeof value === "number");
  if (values.length === 0) return "·".repeat(series.length);
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo;
  return series
    .map((value) => typeof value !== "number" ? "·" : BARS[span === 0 ? 0 : Math.round(((value - lo) / span) * (BARS.length - 1))])
    .join("");
}

// trendSpark sets the week in progress apart ("▃▅▆┊█"): it is plotted but
// never the compared week.
function trendSpark(trends: LearnTrends, metric: LearnTrendMetric): string {
  const spark = learnSparkline(metric.series);
  return trends.weeks.at(-1)?.in_progress && spark.length > 1 ? `${spark.slice(0, -1)}┊${spark.slice(-1)}` : spark;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(value).toLocaleString("en-US");
}

function trendValue(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "tokens") return compactNumber(value);
  if (unit === "pct") return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  if (unit === "per_100_turns") return `${value.toFixed(1).replace(/\.0$/, "")}/100 turns`;
  if (unit === "points") return `-${Math.round(value)} pts`;
  return String(value);
}

// Share metrics show the change in percentage points; a relative percent of a
// percent reads as a much bigger move than it is.
function trendDelta(metric: LearnTrendMetric): string {
  const sign = (value: number) => (value > 0 ? "+" : "");
  if (metric.unit === "pct" && metric.current !== undefined && metric.prior !== undefined) {
    const diff = metric.current - metric.prior;
    return `${sign(diff)}${diff.toFixed(1).replace(/\.0$/, "")}pp `;
  }
  return metric.delta_pct === undefined ? "" : `${sign(metric.delta_pct)}${Math.round(metric.delta_pct)}% `;
}

function trendChange(metric: LearnTrendMetric, priorWeeks: number): string {
  if (metric.direction === "insufficient_data") return "insufficient data";
  return `${trendDelta(metric)}vs prior ${priorWeeks}w · ${metric.direction}`;
}

// learnTrendLines is the compact 2-4 line section shown after the score.
export function learnTrendLines(trends: LearnTrends | undefined): string[] {
  if (!trends?.metrics?.length) return [];
  const metrics = COMPACT_KEYS
    .map((key) => trends.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is LearnTrendMetric => metric !== undefined);
  if (metrics.length === 0) return [];
  const head = `trend ${trends.weeks.length}w`;
  const width = Math.max(...metrics.map((metric) => metric.label.length));
  return [
    ...metrics.map((metric, index) =>
      `${index === 0 ? head : " ".repeat(head.length)}  ${metric.label.padEnd(width)}  ${trendSpark(trends, metric)}  ${trendChange(metric, trends.prior_weeks)}  (n=${metric.current_sessions})`,
    ),
    `${" ".repeat(head.length)}  a trend is not a saving and does not show cause`,
  ];
}

// learnTrendTable is the --all / --md view: every metric, plus score history
// and sink movers when saved reports exist.
export function learnTrendTable(trends: LearnTrends | undefined, markdown: boolean): string[] {
  if (!trends?.metrics?.length) return [];
  const header = ["metric", `${trends.weeks.length}w`, trends.current_week, `prior ${trends.prior_weeks}w`, "change", "n"];
  const rows = trends.metrics.map((metric) => [
    metric.label,
    trendSpark(trends, metric),
    trendValue(metric.current, metric.unit),
    trendValue(metric.prior, metric.unit),
    metric.direction === "insufficient_data"
      ? "insufficient data"
      : `${trendDelta(metric)}${metric.direction}`,
    `${metric.current_sessions} vs ${metric.prior_sessions}`,
  ]);
  const lines: string[] = [markdown ? "### Trends" : "trends"];
  if (markdown) {
    lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`));
  } else {
    const widths = header.map((_, col) => Math.max(...[header, ...rows].map((row) => row[col]!.length)));
    for (const row of [header, ...rows]) lines.push(row.map((cell, col) => cell.padEnd(widths[col]!)).join("  ").trimEnd());
  }
  const weeks = trends.weeks
    .map((week) => `${week.week}${week.in_progress ? " (in progress)" : week.partial ? "*" : ""} n=${week.sessions}`)
    .join(" · ");
  lines.push(
    `weeks (UTC ISO, * partial, ┊ in progress, never compared): ${weeks}`,
    `medians across sessions, shares pooled across turns; under ${trends.min_sessions} sessions = insufficient data; under ${trends.dead_band_pct}% change = flat`,
    trends.note,
  );
  const history = trends.score?.history ?? [];
  if (history.length >= 2) {
    lines.push(`score history (${trends.score?.history_source ?? "snapshots"}): ${history.map((point) => `${point.date.slice(5)} ${point.score}`).join(" → ")}`);
  }
  const movers = trends.movers;
  if (movers) {
    const fmt = (mover: LearnTrendMover) => {
      const delta = mover.delta_tokens_per_turn;
      return `${mover.title} (${delta > 0 ? "+" : delta < 0 ? "-" : ""}${compactNumber(Math.abs(delta))}/turn, ${mover.status})`;
    };
    if (movers.grew?.length) lines.push(`grew since ${movers.since} (${movers.days}d): ${movers.grew.map(fmt).join("; ")}`);
    if (movers.shrank?.length) lines.push(`shrank since ${movers.since} (${movers.days}d): ${movers.shrank.map(fmt).join("; ")}`);
  }
  return markdown ? lines.map((line, index) => (index === 0 || line.startsWith("|") ? line : `- ${line}`)) : lines;
}
