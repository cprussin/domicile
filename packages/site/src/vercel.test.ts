import { expect, test } from "bun:test";

import config from "../vercel.json";

const deploys = (branch: string) => {
  const rules = Object.entries(config.git.deploymentEnabled);
  const exact = rules.find(([pattern]) => pattern === branch);
  if (exact) {
    return exact[1];
  }
  // Vercel deploys a branch unless a disabling pattern matches it.
  return !rules.some(
    ([pattern, enabled]) => !enabled && new Bun.Glob(pattern).match(branch),
  );
};

test("Vercel deploys stable and no other branch", () => {
  expect(deploys("stable")).toBe(true);
  for (const branch of [
    "main",
    "claude/project-thread-cvi1pk",
    "renovate/major-deps",
    "changeset-release/main",
  ]) {
    expect({ branch, deploys: deploys(branch) }).toEqual({
      branch,
      deploys: false,
    });
  }
});
