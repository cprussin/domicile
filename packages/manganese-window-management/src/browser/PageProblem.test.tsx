import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PageProblem as Problem } from "../usePageProblem";
import { PageProblem } from "./PageProblem";

const failure = (
  kind: "network" | "http" | "certificate" | "warning",
  { canProceed = false, error = "", httpStatus = 0 } = {},
): Problem => ({
  canProceed,
  error,
  httpStatus,
  kind,
  url: "https://example.invalid/page",
});

/** Renders `problem`, recording the answers. */
const show = (problem: Problem, answers: string[], canGoBack = true) =>
  render(
    <PageProblem
      canGoBack={canGoBack}
      onGoBack={() => {
        answers.push("back");
      }}
      onProceed={() => {
        answers.push("proceed");
      }}
      onReload={() => {
        answers.push("reload");
      }}
      problem={problem}
    />,
  );

describe("PageProblem", () => {
  it("says an address couldn't be found, and tries again", async () => {
    const answers: string[] = [];
    show(failure("network", { error: "ERR_NAME_NOT_RESOLVED" }), answers);

    expect(
      screen.getByRole("heading", { name: "Can't reach example.invalid" }),
    ).toBeTruthy();
    expect(screen.getByText("ERR_NAME_NOT_RESOLVED")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(answers).toStrictEqual(["reload", "back"]);
  });

  it("offers no Go back without history", () => {
    show(failure("network", { error: "ERR_INTERNET_DISCONNECTED" }), [], false);

    expect(
      screen.getByRole("heading", { name: "You're offline" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });

  it("names an empty HTTP error's status", () => {
    show(
      failure("http", {
        error: "ERR_HTTP_RESPONSE_CODE_FAILURE",
        httpStatus: 500,
      }),
      [],
    );

    expect(
      screen.getByRole("heading", { name: "example.invalid isn't working" }),
    ).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
  });

  it("puts Continue anyway behind Details for a certificate", async () => {
    const answers: string[] = [];
    show(
      failure("certificate", {
        canProceed: true,
        error: "ERR_CERT_AUTHORITY_INVALID",
      }),
      answers,
    );

    expect(
      screen.getByRole("heading", { name: "Your connection isn't private" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue anyway" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Continue anyway" }),
    );

    expect(answers).toStrictEqual(["proceed"]);
  });

  it("offers no way past a certificate the browser won't pass", () => {
    show(failure("certificate", { error: "ERR_CERT_DATE_INVALID" }), []);

    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("reloads a crashed page", async () => {
    const answers: string[] = [];
    show({ kind: "gone", reason: "crashed" }, answers);

    expect(
      screen.getByRole("heading", { name: "This page crashed" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(answers).toStrictEqual(["reload"]);
  });
});
