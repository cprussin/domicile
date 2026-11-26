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
  measures: {},
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

  test("takes steal apart from busy, when the runs read it", () => {
    const stolen = {
      ...run("sway", "rest", 4096),
      samples: [
        { ...sample(0, 1000, 4096), stealTicks: 0 },
        { ...sample(250, 2000, 4096), stealTicks: 125 },
      ],
    };
    const [row] = summarize([stolen]);
    expect(row?.cpuPercent.median).toBe(100);
    // 125 of 1000 ticks on 4 cores is half a core.
    expect(row?.stealPercent?.median).toBe(50);
    expect(markdown([row].flatMap((r) => (r ? [r] : [])))).toContain("steal");
    expect(summarize([run("sway", "rest", 4096)])[0]?.stealPercent).toBe(
      undefined,
    );
  });

  test("keeps desktops and workloads apart", () => {
    expect(
      summarize([run("sway", "rest", 4096), run("gnome", "rest", 4096)]),
    ).toHaveLength(2);
  });
});

describe("host measures", () => {
  // QEMU's CPU and its share of the host's GPU, read on the host.
  const withHost = (desktop: string) => ({
    ...run(desktop, "rest", 4096),
    hostTicksPerSecond: 100,
    samples: [
      {
        ...sample(0, 1000, 4096),
        host: { gpuMib: 100, gpuPercent: 10, qemuTicks: 0, seconds: 0 },
      },
      {
        ...sample(250, 2000, 4096),
        host: { gpuMib: 300, gpuPercent: 30, qemuTicks: 1500, seconds: 10 },
      },
    ],
  });

  test("takes QEMU's CPU from its ticks over the window", () => {
    const [row] = summarize([withHost("sway")]);
    // 1500 ticks at 100 a second over 10 seconds is one and a half cores.
    expect(row?.host?.qemuCpuPercent.median).toBe(150);
  });

  test("takes the GPU's medians", () => {
    const [row] = summarize([withHost("sway")]);
    expect(row?.host?.gpuPercent.median).toBe(20);
    expect(row?.host?.gpuMib.median).toBe(200);
  });

  test("leaves them out of runs measured without a GPU", () => {
    const [row] = summarize([run("sway", "rest", 4096)]);
    expect(row?.host).toBeUndefined();
    expect(markdown([row].filter((r) => r !== undefined))).not.toContain("GPU");
  });

  test("throws on a group that mixes the two", () => {
    expect(() =>
      summarize([withHost("sway"), run("sway", "rest", 4096)]),
    ).toThrow();
  });

  test("tables them", () => {
    expect(markdown(summarize([withHost("sway")]))).toContain(
      "| sway | 20% (20–20) |",
    );
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

describe("busiest threads", () => {
  const busy = (threads: { cpuPercent: number; name: string }[]) => ({
    ...run("domicile", "rest", 4096),
    threads,
  });

  test("tables each group's threads by their median run", () => {
    const table = markdown(
      summarize([
        busy([{ cpuPercent: 3, name: "bun/bun" }]),
        busy([{ cpuPercent: 1, name: "bun/bun" }]),
        // A run where the thread spent nothing counts as nothing.
        busy([]),
      ]),
    );
    expect(table).toContain("#### domicile, rest");
    expect(table).toContain("| bun/bun | 1% |");
  });

  test("leaves them out when no run read them", () => {
    expect(markdown(summarize([run("sway", "rest", 4096)]))).not.toContain(
      "Busiest threads",
    );
  });
});

describe("memory over the window", () => {
  test("takes the peak and the drift from first to last sample", () => {
    const growing = {
      ...run("sway", "rest", 4096),
      samples: [
        sample(0, 1000, 4096),
        sample(100, 2000, 10_240),
        sample(250, 3000, 6144),
      ],
    };
    const [row] = summarize([growing]);
    expect(row?.peakMib.median).toBe(10);
    expect(row?.driftMib.median).toBe(2);
  });
});

describe("measures", () => {
  const measured = (measures: Record<string, number>) => ({
    ...run("sway", "chat-and-web", 4096),
    measures,
  });

  test("takes each one's median and range across runs", () => {
    const [row] = summarize([
      measured({ frameRate: 50 }),
      measured({ frameRate: 60 }),
      measured({ frameRate: 40 }),
    ]);
    expect(row?.measures.frameRate).toEqual({
      max: 60,
      median: 50,
      min: 40,
    });
  });

  test("throws on a group where some runs lack one", () => {
    expect(() =>
      summarize([measured({ frameRate: 50 }), measured({})]),
    ).toThrow();
  });

  test("throws on a measure it has no title for", () => {
    expect(() => markdown(summarize([measured({ bogus: 1 })]))).toThrow();
  });

  test("tables each one under its title", () => {
    expect(markdown(summarize([measured({ frameRate: 58 })]))).toContain(
      "| sway | 58 fps (58–58) |",
    );
  });
});
