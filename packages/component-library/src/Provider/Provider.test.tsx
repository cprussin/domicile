import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { standaloneThemeSource } from "../ThemeSwitch/standalone-theme-source";
import { ThemeSwitch } from "../ThemeSwitch/ThemeSwitch";
import { Provider } from "./Provider";

describe(Provider, () => {
  it("renders its children", () => {
    render(
      <Provider theme={standaloneThemeSource()}>
        <span data-testid="child">hi</span>
      </Provider>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("supplies the theme context, so a ThemeSwitch resolves it", () => {
    // `ThemeSwitch` reads the theme context and throws without a provider, so
    // its button rendering proves the Provider supplied that context.
    render(
      <Provider theme={standaloneThemeSource()}>
        <ThemeSwitch />
      </Provider>,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
