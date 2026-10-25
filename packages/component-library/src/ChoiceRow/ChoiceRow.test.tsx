import { describe, expect, it } from "bun:test";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CheckboxRow, ChoiceList, RadioRow } from "./ChoiceRow";

describe(RadioRow, () => {
  it("shows its name over its detail, after its icon", () => {
    render(
      <ChoiceList defaultValue="dvp">
        <RadioRow
          detail="English (programmer Dvorak)"
          icon={<svg data-testid="icon" />}
          name="dvp"
          value="dvp"
        />
      </ChoiceList>,
    );

    const row = screen.getByRole("radio", { name: /dvp/ });
    expect(row).toHaveTextContent("dvpEnglish (programmer Dvorak)");
    expect(row).toContainElement(screen.getByTestId("icon"));
  });

  it("leaves the detail out when it has none", () => {
    render(
      <ChoiceList>
        <RadioRow icon={undefined} name="us" value="us" />
      </ChoiceList>,
    );

    expect(screen.getByRole("radio")).toHaveTextContent(/^us$/);
  });
});

describe(ChoiceList, () => {
  it("picks the row clicked, and only it", async () => {
    const picked: unknown[] = [];
    render(
      <ChoiceList
        aria-label="Keymap"
        defaultValue="dvp"
        onValueChange={(value) => {
          picked.push(value);
        }}
      >
        <RadioRow icon={undefined} name="dvp" value="dvp" />
        <RadioRow icon={undefined} name="us" value="us" />
      </ChoiceList>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "us" }));

    expect(picked).toStrictEqual(["us"]);
    expect(screen.getByRole("radio", { name: "us" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "dvp" })).not.toBeChecked();
  });
});

describe(CheckboxRow, () => {
  it("picks alongside the others in its group", async () => {
    const picked: string[][] = [];
    render(
      <CheckboxGroup
        defaultValue={["left"]}
        onValueChange={(value) => {
          picked.push(value);
        }}
      >
        <CheckboxRow icon={undefined} name="left" value="left" />
        <CheckboxRow icon={undefined} name="right" value="right" />
      </CheckboxGroup>,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "right" }));

    expect(picked).toStrictEqual([["left", "right"]]);
  });
});
