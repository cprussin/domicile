import { z } from "zod";

/** One reading the VM takes every few seconds of the measured window. */
const sampleSchema = z.object({
  busyTicks: z.number(),
  load1: z.number(),
  pssKib: z.number(),
  sessionPssKib: z.number(),
  totalTicks: z.number(),
  usedKib: z.number(),
});

/** What one boot of one desktop under one workload measured. */
const runSchema = z.object({
  cores: z.number().int().positive(),
  desktop: z.string(),
  run: z.number().int(),
  samples: z.array(sampleSchema).min(2),
  top: z.array(z.object({ name: z.string(), pssKib: z.number() })),
  workload: z.string(),
});

export type Run = z.infer<typeof runSchema>;

/** The median of a measure across runs, and its lowest and highest run. */
type Spread = { max: number; median: number; min: number };

/** A desktop under a workload, across its runs. */
export type Row = {
  cpuPercent: Spread;
  desktop: string;
  load1: Spread;
  runs: number;
  sessionPssMib: Spread;
  usedMib: Spread;
  workload: string;
};

/** Parses a run's JSON as the VM wrote it. */
export const parseRun = (json: string): Run =>
  runSchema.parse(JSON.parse(json));

/** The value at `index`, which the caller knows is in range. */
const at = (values: readonly number[], index: number): number => {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`no value at ${String(index)} of ${String(values.length)}`);
  }
  return value;
};

/** The middle value, or the mean of the middle two. */
const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (at(sorted, middle - 1) + at(sorted, middle)) / 2
    : at(sorted, middle);
};

/** The median and range of a measure across runs. */
const spread = (values: readonly number[]): Spread => ({
  max: Math.max(...values),
  median: median(values),
  min: Math.min(...values),
});

/** KiB as whole MiB. */
const mib = (kib: number): number => Math.round(kib / 1024);

/** Cores kept busy over the window, as a percentage of one core. */
const cpuPercent = (run: Run): number => {
  const first = run.samples[0];
  const last = run.samples.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(`${run.desktop}/${run.workload} has no samples`);
  }
  const busy =
    (last.busyTicks - first.busyTicks) / (last.totalTicks - first.totalTicks);
  return Math.round(busy * run.cores * 100);
};

/** One run's measures: medians over its window, and its CPU. */
const perRun = (run: Run) => ({
  cpuPercent: cpuPercent(run),
  load1: median(run.samples.map((sample) => sample.load1)),
  sessionPssMib: mib(median(run.samples.map((s) => s.sessionPssKib))),
  usedMib: mib(median(run.samples.map((sample) => sample.usedKib))),
});

/** Groups runs by desktop and workload, in the order each first appears. */
export const summarize = (runs: readonly Run[]): Row[] =>
  Map.groupBy(runs, (run) => `${run.desktop}\0${run.workload}`)
    .values()
    .map((group) => {
      const measured = group.map(perRun);
      const [first] = group;
      if (first === undefined) {
        throw new Error("a group with no runs");
      }
      return {
        cpuPercent: spread(measured.map((m) => m.cpuPercent)),
        desktop: first.desktop,
        load1: spread(measured.map((m) => m.load1)),
        runs: measured.length,
        sessionPssMib: spread(measured.map((m) => m.sessionPssMib)),
        usedMib: spread(measured.map((m) => m.usedMib)),
        workload: first.workload,
      };
    })
    .toArray();

/** One measure as a table: a row per desktop, a column per workload. */
const table = (
  rows: readonly Row[],
  title: string,
  cell: (row: Row) => string,
): string => {
  const desktops = [...new Set(rows.map((row) => row.desktop))];
  const workloads = [...new Set(rows.map((row) => row.workload))];
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [
    `### ${title}`,
    "",
    line(["Desktop", ...workloads]),
    line(["---", ...workloads.map(() => "---")]),
    ...desktops.map((desktop) =>
      line([
        desktop,
        ...workloads.map((workload) => {
          const row = rows.find(
            (r) => r.desktop === desktop && r.workload === workload,
          );
          return row === undefined ? "–" : cell(row);
        }),
      ]),
    ),
  ].join("\n");
};

/** The median run, then its range. */
const ranged = (value: Spread, unit: string): string =>
  `${String(value.median)}${unit} (${String(value.min)}–${String(value.max)})`;

/** The summary as markdown tables: the median run, then its range. */
export const markdown = (rows: readonly Row[]): string =>
  [
    table(rows, "Memory in use (whole VM)", (row) =>
      ranged(row.usedMib, " MiB"),
    ),
    table(rows, "Session processes (PSS)", (row) =>
      ranged(row.sessionPssMib, " MiB"),
    ),
    table(rows, "CPU (% of one core)", (row) => ranged(row.cpuPercent, "%")),
    table(rows, "Load average (1 min)", (row) => ranged(row.load1, "")),
  ].join("\n\n");
