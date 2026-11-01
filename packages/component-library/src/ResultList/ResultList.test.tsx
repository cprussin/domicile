import { describe, expect, it } from "bun:test";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Marked } from "./Marked";
import { ResultList, resultId } from "./ResultList";
import { RowTile } from "./RowTile";

const FRUIT = ["Apple", "Banana", "Cherry"] as const;

/** The list over `FRUIT` with `highlighted` lit, recording what it reports. */
const fruit = (highlighted: number | undefined) => {
  const chosen: string[] = [];
  const lit: number[] = [];
  render(
    <ResultList
      highlighted={highlighted}
      id="fruit"
      items={FRUIT}
      keyOf={(name) => name}
      label="Fruit"
      onChoose={(name) => {
        chosen.push(name);
      }}
      onHighlight={(at) => {
        lit.push(at);
      }}
    >
      {(name) => name}
    </ResultList>,
  );
  return { chosen, lit, user: userEvent.setup() };
};

describe(ResultList, () => {
  describe("rendering", () => {
    it("is a listbox of its items, in order", () => {
      fruit(undefined);

      expect(
        screen.getAllByRole("option").map((option) => option.textContent ?? ""),
      ).toStrictEqual([...FRUIT]);
      expect(screen.getByRole("listbox", { name: "Fruit" }).id).toBe("fruit");
    });

    it("selects the highlighted row, under the ID a combobox names it by", () => {
      fruit(1);

      const option = screen.getByRole("option", { selected: true });
      expect(option.textContent).toBe("Banana");
      expect(option.id).toBe(resultId("fruit", 1));
    });
  });

  describe("interactions", () => {
    it("moves the highlight to the row the pointer moves over", async () => {
      // One highlight for pointer and keyboard, so only one row looks lit.
      const list = fruit(0);

      await list.user.pointer({
        target: screen.getByRole("option", { name: "Cherry" }),
      });

      expect(list.lit).toStrictEqual([2]);
    });

    it("chooses the row that was clicked", async () => {
      const list = fruit(0);

      await list.user.click(screen.getByRole("option", { name: "Banana" }));

      expect(list.chosen).toStrictEqual(["Banana"]);
    });

    it("leaves focus where it was when a row is pressed", async () => {
      // Focus stays in the box that owns the keyboard.
      const list = fruit(0);
      render(<input aria-label="Search" />);
      const box = screen.getByRole("textbox", { name: "Search" });
      box.focus();

      await list.user.click(screen.getByRole("option", { name: "Apple" }));

      expect(document.activeElement).toBe(box);
    });
  });
});

describe(Marked, () => {
  it("marks the letters the query matched", () => {
    render(
      <p>
        <Marked query="ban" text="Banana" />
      </p>,
    );

    expect(screen.getByRole("paragraph").textContent).toBe("Banana");
    expect(screen.getByRole("mark").textContent).toBe("Ban");
  });
});

describe(RowTile, () => {
  it("draws its glyph, hidden from screen readers", () => {
    const { container } = render(<RowTile icon={FileIcon} />);

    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
