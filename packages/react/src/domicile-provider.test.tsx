import { describe, expect, it, spyOn } from "bun:test";
import { appDesktop } from "@domicile-desktop/sdk/desktop/app-desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { render, screen } from "@testing-library/react";

import {
  DomicileProvider,
  useAppDomicile,
  useDomicile,
} from "./domicile-provider";

const NamesFocused = () => (
  <span>{useDomicile().windows.focused ?? "the shell"}</span>
);

const HasFiles = () => (
  <span>
    {typeof useAppDomicile().files.readDir === "function" ? "files" : ""}
  </span>
);

/** Swallows the error React logs for the throw a test expects. */
const quietly = (run: () => void) => {
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    run();
  } finally {
    logged.mockRestore();
  }
};

describe("useDomicile", () => {
  it("is the desktop the provider above hands", () => {
    const fake = new FakeDomicileHost();
    fake.set({ focusedWindow: "term" });

    render(
      <DomicileProvider domicile={fake.domicile}>
        <NamesFocused />
      </DomicileProvider>,
    );

    expect(screen.getByText("term")).toBeInTheDocument();
  });

  it("throws without a provider", () => {
    quietly(() => {
      expect(() => render(<NamesFocused />)).toThrow(
        "useDomicile: no <DomicileProvider> above",
      );
    });
  });

  it("throws under an app's desktop, which is not a shell's", () => {
    const app = appDesktop(new FakeDomicileHost().host);

    quietly(() => {
      expect(() =>
        render(
          <DomicileProvider domicile={app}>
            <NamesFocused />
          </DomicileProvider>,
        ),
      ).toThrow(
        "useDomicile: the desktop above is an app's; use useAppDomicile",
      );
    });
  });
});

describe("useAppDomicile", () => {
  it("is an app's desktop", () => {
    const app = appDesktop(new FakeDomicileHost().host);

    render(
      <DomicileProvider domicile={app}>
        <HasFiles />
      </DomicileProvider>,
    );

    expect(screen.getByText("files")).toBeInTheDocument();
  });

  it("is a shell's desktop too, which has everything an app's has", () => {
    render(
      <DomicileProvider domicile={new FakeDomicileHost().domicile}>
        <HasFiles />
      </DomicileProvider>,
    );

    expect(screen.getByText("files")).toBeInTheDocument();
  });

  it("throws without a provider", () => {
    quietly(() => {
      expect(() => render(<HasFiles />)).toThrow(
        "useAppDomicile: no <DomicileProvider> above",
      );
    });
  });
});
