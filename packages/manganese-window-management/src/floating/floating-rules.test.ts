import { describe, expect, it } from "bun:test";
import { listedWindow } from "@domicile-desktop/sdk/fake-host";

import { floatingRulesSchema, opensFloating } from "./floating-rules";

const PINENTRY = listedWindow("app-1", {
  desktopId: "org.gnupg.pinentry-qt",
  title: "pinentry-qt",
});
const HUDDLE = listedWindow("app-2", {
  desktopId: "Slack",
  title: "Huddle: #general",
});

describe("opensFloating", () => {
  it("floats a dialog with no rules", () => {
    expect(opensFloating([], { ...PINENTRY, dialog: true })).toBe(true);
  });

  it("tiles a window no rule names", () => {
    const rules = floatingRulesSchema.parse([{ app: "pinentry" }]);
    expect(opensFloating(rules, HUDDLE)).toBe(false);
  });

  it("floats a window whose app id a rule matches", () => {
    const rules = floatingRulesSchema.parse([{ app: "pinentry" }]);
    expect(opensFloating(rules, PINENTRY)).toBe(true);
  });

  it("needs every part of a rule to match", () => {
    const rules = floatingRulesSchema.parse([
      { app: "^Slack$", title: "^Huddle" },
    ]);
    expect(opensFloating(rules, HUDDLE)).toBe(true);
    expect(opensFloating(rules, { ...HUDDLE, title: "Slack | general" })).toBe(
      false,
    );
  });
});

describe("floatingRulesSchema", () => {
  it("is empty when not given", () => {
    expect(floatingRulesSchema.parse(undefined)).toStrictEqual([]);
  });

  it("refuses a rule that matches nothing in particular", () => {
    expect(() => floatingRulesSchema.parse([{}])).toThrow();
  });

  it("refuses a pattern that is not a regular expression", () => {
    expect(() => floatingRulesSchema.parse([{ app: "(" }])).toThrow();
  });
});
