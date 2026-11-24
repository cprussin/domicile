import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionPlayer } from "./MotionPlayer";
import type { SceneProps } from "./motion";

const Scene = ({ played }: SceneProps) => <p>{played ? "after" : "before"}</p>;

describe("MotionPlayer", () => {
  it("plays the motion forward, then back", async () => {
    render(
      <MotionPlayer motion={{ id: "door", name: "Door", Scene }} speed={1} />,
    );
    expect(screen.getByText("before")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play Door" }));
    expect(screen.getByText("after")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Play Door back" }),
    );
    expect(screen.getByText("before")).toBeInTheDocument();
  });
});
