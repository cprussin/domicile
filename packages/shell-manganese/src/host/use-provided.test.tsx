import { describe, expect, it, spyOn } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createContext } from "react";

import { useProvided } from "./use-provided";

const Named = createContext<string | undefined>(undefined);

const ShowsName = () => <span>{useProvided(Named, "a name")}</span>;

describe("useProvided", () => {
  it("is the value the provider above sets", () => {
    render(
      <Named value="Ada">
        <ShowsName />
      </Named>,
    );

    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("throws, naming what is missing, without a provider", () => {
    // React logs the error it rethrows; that is the failure under test.
    const logged = spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<ShowsName />)).toThrow(
      "manganese: a name was not provided",
    );
    logged.mockRestore();
  });
});
