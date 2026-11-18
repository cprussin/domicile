import { describe, expect, test } from "bun:test";

import { markdown, parseRun, summarize } from "./summary";

const sample = (busyTicks: number, totalTicks: number, usedKib: number) => ({
  busyTicks,
  load1: 0.5,
  pssKib: usedKib - 1024,
  sessionPssKib: usedKib - 2048,
  totalTicks,
  usedKib,
});

const run = (desktop: string, workload: string, usedKib: number) => ({
  cores: 4,
  desktop,
  run: 1,
  samples: [sample(0, 1000, usedKib), sample(250, 2000, usedKib)],
  top: [{ name: "sway", pssKib: 10_240 }],
  workload,
});

describe("parseRun", () => {
  test("reads a run the VM wrote", () => {
    expect(parseRun(JSON.stringify(run("sway", "rest", 4096))).desktop).toBe(
      "sway",
    );
  });

  test("throws on a sample that read no process's memory", () => {
    const bad = run("sway", "rest", 4096);
    bad.samples[0] = { ...sample(0, 1000, 4096), pssKib: 0 };
    expect(() => parseRun(JSON.stringify(bad))).toThrow();
  });

  test("throws on a run with no samples", () => {
    expect(() =>
      parseRun(JSON.stringify({ ...run("sway", "rest", 4096), samples: [] })),
    ).toThrow();
  });
});

describe("summarize", () => {
  test("takes CPU as cores busy over the window", () => {
    const [row] = summarize([run("sway", "rest", 4096)]);
    // 250 of 1000 ticks busy on 4 cores is one core.
    expect(row?.cpuPercent.median).toBe(100);
  });

  test("takes the median run and the range", () => {
    const [row] = summarize([
      run("sway", "rest", 3072),
      run("sway", "rest", 5120),
      run("sway", "rest", 4096),
    ]);
    expect(row?.usedMib).toEqual({ max: 5, median: 4, min: 3 });
  });

  test("keeps desktops and workloads apart", () => {
    expect(
      summarize([run("sway", "rest", 4096), run("gnome", "rest", 4096)]),
    ).toHaveLength(2);
  });
});

describe("markdown", () => {
  test("gives a row per desktop and a column per workload", () => {
    const table = markdown(
      summarize([run("sway", "rest", 4096), run("sway", "apps", 8192)]),
    );
    expect(table).toContain("| Desktop | rest | apps |");
    expect(table).toContain("| sway | 4 MiB (4–4) | 8 MiB (8–8) |");
  });
});
