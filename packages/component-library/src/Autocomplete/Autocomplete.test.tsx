import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Button } from "../Button/Button";

import type { Suggestion } from "./Autocomplete";
import { Autocomplete } from "./Autocomplete";

const SITES: readonly Suggestion<string>[] = [
  {
    description: "Visited",
    label: "docs.example.com",
    text: "https://docs.example.com",
    value: "https://docs.example.com",
  },
  {
    description: "Visited",
    label: "example.com",
    text: "https://example.com",
    value: "https://example.com",
  },
];

/** The field as a consumer drives it: it owns the text, the list is given. */
const Driven = ({
  autoHighlight = false,
  onSelected,
  suggestions = SITES,
}: {
  autoHighlight?: boolean | undefined;
  onSelected?: ((value: string) => void) | undefined;
  suggestions?: readonly Suggestion<string>[] | undefined;
}) => {
  const [value, setValue] = useState("");
  return (
    <Autocomplete
      aria-label="Address"
      autoHighlight={autoHighlight}
      emptyMessage="Nothing to suggest"
      onSuggestionTaken={onSelected}
      onValueChange={setValue}
      suggestions={suggestions}
      value={value}
    />
  );
};

describe(Autocomplete, () => {
  describe("rendering", () => {
    it("puts the controls it is given at the inline start, where they can be pressed", async () => {
      // A `prefixIcon` is decoration and takes no pointer; a control at the
      // same end of the field is a control, which is what a browser's site
      // indicator is.
      const pressed: string[] = [];
      render(
        <Autocomplete
          aria-label="Address"
          prefixButtons={
            <Button
              label="Connection"
              onClick={() => {
                pressed.push("connection");
              }}
              size="sm"
              variant="ghost"
            >
              <span>lock</span>
            </Button>
          }
          suggestions={SITES}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Connection" }));

      expect(pressed).toStrictEqual(["connection"]);
    });

    it("shows the value it is given and no list until the user types", () => {
      render(<Driven />);

      expect(screen.getByRole("combobox", { name: "Address" })).toHaveValue("");
      expect(screen.queryByText("docs.example.com")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("offers its suggestions once the user types", async () => {
      render(<Driven />);

      await userEvent.type(
        screen.getByRole("combobox", { name: "Address" }),
        "doc",
      );

      expect(await screen.findByText("docs.example.com")).toBeVisible();
    });

    it("reports the suggestion the user takes", async () => {
      const taken: string[] = [];
      render(
        <Driven
          onSelected={(value) => {
            taken.push(value);
          }}
        />,
      );

      await userEvent.type(
        screen.getByRole("combobox", { name: "Address" }),
        "doc",
      );
      await userEvent.click(await screen.findByText("docs.example.com"));

      expect(taken).toStrictEqual(["https://docs.example.com"]);
    });

    // What an address bar needs from it: the line the field is already
    // halfway to is the first one, so Enter takes it without the user having
    // to arrow down to what they were already typing.
    it("takes the first suggestion on Enter when it highlights as the user types", async () => {
      const taken: string[] = [];
      render(
        <Driven
          autoHighlight
          onSelected={(value) => {
            taken.push(value);
          }}
        />,
      );

      await userEvent.type(
        screen.getByRole("combobox", { name: "Address" }),
        "doc{Enter}",
      );

      expect(taken).toStrictEqual(["https://docs.example.com"]);
    });

    it("leaves Enter alone when it does not highlight", async () => {
      const taken: string[] = [];
      render(
        <Driven
          onSelected={(value) => {
            taken.push(value);
          }}
        />,
      );

      await userEvent.type(
        screen.getByRole("combobox", { name: "Address" }),
        "doc{Enter}",
      );

      expect(taken).toStrictEqual([]);
    });

    it("says so when there is nothing to suggest", async () => {
      render(<Driven suggestions={[]} />);

      await userEvent.type(
        screen.getByRole("combobox", { name: "Address" }),
        "doc",
      );

      expect(await screen.findByText("Nothing to suggest")).toBeVisible();
    });
  });
});
