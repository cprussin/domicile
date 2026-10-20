import { describe, expect, it } from "bun:test";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { css } from "../styled-system/css";
import { device, heldSound, laptop } from "./fixture";
import { Volume } from "./Volume";

const shown = (sound: ReturnType<typeof heldSound>) => {
  render(<Volume audio={sound.audio} server={sound.server} />);
  sound.report(laptop);
};

const opened = async (sound: ReturnType<typeof heldSound>) => {
  shown(sound);
  await userEvent.click(screen.getByRole("button", { name: "Volume 50%" }));
};

describe("Volume", () => {
  describe("on the bar", () => {
    it("shows nothing on a desk with no sound server", () => {
      const sound = heldSound();

      render(<Volume audio={sound.audio} server={sound.server} />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("says the default output's volume, and dims when it is muted", () => {
      const sound = heldSound();
      shown(sound);
      expect(
        screen.getByRole("button", { name: "Volume 50%" }).className,
      ).not.toContain(css({ "& > svg": { opacity: "inactive" } }));

      sound.report({
        ...laptop,
        outputs: [device({ default: true, muted: true })],
      });

      expect(
        screen.getByRole("button", { name: "Volume muted" }).className,
      ).toContain(css({ "& > svg": { opacity: "inactive" } }));
    });

    it("draws more waves the louder the default output", () => {
      const sound = heldSound();
      shown(sound);
      const icon = (volume: number) => {
        sound.report({
          ...laptop,
          outputs: [device({ default: true, volume })],
        });
        return screen.getByRole("button").innerHTML;
      };

      expect(new Set([icon(0), icon(0.3), icon(0.8)]).size).toBe(3);
    });

    it("slashes the speaker while muted", () => {
      const sound = heldSound();
      shown(sound);
      sound.report({
        ...laptop,
        outputs: [device({ default: true, muted: true })],
      });
      const muted = screen.getByRole("button").innerHTML;

      const { container } = render(
        <SpeakerSlashIcon size={15} weight="bold" />,
      );

      expect(muted).toBe(container.innerHTML);
    });

    it("mutes and unmutes the default output with a middle click", () => {
      const sound = heldSound();
      shown(sound);

      fireEvent(
        screen.getByRole("button", { name: "Volume 50%" }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
      sound.report({
        ...laptop,
        outputs: [device({ default: true, muted: true })],
      });
      fireEvent(
        screen.getByRole("button", { name: "Volume muted" }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );

      expect(sound.asked).toEqual([
        ["setMuted", "output:speakers", true],
        ["setMuted", "output:speakers", false],
      ]);
    });

    it("turns the default output with the wheel", () => {
      const sound = heldSound();
      shown(sound);

      fireEvent.wheel(screen.getByRole("button", { name: "Volume 50%" }), {
        deltaY: -100,
      });

      expect(sound.asked).toEqual([["setVolume", "output:speakers", 0.55]]);
    });
  });

  describe("its panel", () => {
    it("has the default output and microphone, at their levels", async () => {
      const sound = heldSound();
      await opened(sound);

      expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute(
        "aria-valuenow",
        "50",
      );
      expect(
        screen.getByRole("slider", { name: "Microphone" }),
      ).toHaveAttribute("aria-valuenow", "30");
    });

    it("asks the desk for the level a slider is moved to", async () => {
      const sound = heldSound();
      await opened(sound);

      act(() => {
        screen.getByRole("slider", { name: "Microphone" }).focus();
      });
      await userEvent.keyboard("{ArrowRight}");

      expect(sound.asked).toEqual([["setVolume", "input:mic", 0.31]]);
    });

    it("mutes and unmutes", async () => {
      const sound = heldSound();
      await opened(sound);

      await userEvent.click(
        screen.getByRole("button", { name: "Mute Volume" }),
      );
      sound.report({
        ...laptop,
        inputs: [device({ default: true, id: "input:mic", muted: true })],
      });
      await userEvent.click(
        screen.getByRole("button", { name: "Unmute Microphone" }),
      );

      expect(sound.asked).toEqual([
        ["setMuted", "output:speakers", true],
        ["setMuted", "input:mic", false],
      ]);
    });

    it("leaves out the microphone on a desk with none", async () => {
      const sound = heldSound();
      shown(sound);
      sound.report({
        ...laptop,
        inputs: laptop.inputs.filter((input) => input.monitor),
      });
      await userEvent.click(screen.getByRole("button", { name: "Volume 50%" }));

      expect(
        screen.queryByRole("slider", { name: "Microphone" }),
      ).not.toBeInTheDocument();
    });

    it("meters while it is open, and stops when it shuts", async () => {
      const sound = heldSound();
      await opened(sound);
      expect(sound.metered.at(-1)).toEqual(["output:speakers", "input:mic"]);

      await userEvent.keyboard("{Escape}");

      expect(sound.metered.at(-1)).toEqual([]);
    });
  });

  describe("its panel on a locked desk", () => {
    // A locked desk refuses meters, inputs and everything but an output's
    // volume and mute.
    it("has only the default output, unmetered", async () => {
      const sound = heldSound();
      render(<Volume audio={sound.audio} locked server={sound.server} />);
      sound.report(laptop);

      await userEvent.click(screen.getByRole("button", { name: "Volume 50%" }));
      act(() => {
        screen.getByRole("slider", { name: "Volume" }).focus();
      });
      await userEvent.keyboard("{ArrowRight}");
      await userEvent.click(
        screen.getByRole("button", { name: "Mute Volume" }),
      );

      expect(screen.getAllByRole("slider")).toHaveLength(1);
      expect(sound.started).toBe(0);
      expect(sound.asked).toEqual([
        ["setVolume", "output:speakers", 0.51],
        ["setMuted", "output:speakers", true],
      ]);
    });
  });
});
