import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { device, heldSound, laptop } from "./fixture";
import { Mixer } from "./Mixer";

const mixer = (
  sound: ReturnType<typeof heldSound>,
  audio: typeof laptop = laptop,
) => render(<Mixer audio={audio} server={sound.server} />);

/** Pick `name` from the `Select` called `label`. */
const choose = async (label: string, name: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(screen.getByRole("option", { name }));
};

describe("Mixer", () => {
  describe("at a glance", () => {
    it("has the default output and microphone, each with a meter", () => {
      const sound = heldSound();
      mixer(sound);

      sound.levels(
        new Map([
          ["output:speakers", 1],
          ["input:mic", 0.001],
        ]),
      );

      expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute(
        "aria-valuenow",
        "50",
      );
      expect(
        screen.getByRole("meter", { name: "Volume level" }),
      ).toHaveAttribute("aria-valuenow", "100");
      expect(
        screen.getByRole("meter", { name: "Microphone level" }),
      ).toHaveAttribute("aria-valuenow", "0");
    });

    it("grays a muted device's row and marks its meter", () => {
      const sound = heldSound();
      mixer(sound, {
        ...laptop,
        inputs: laptop.inputs.map((input) => ({ ...input, muted: true })),
      });

      sound.levels(
        new Map([
          ["output:speakers", 1],
          ["input:mic", 1],
        ]),
      );

      expect(
        screen.getByRole("meter", { name: "Volume level" }),
      ).not.toHaveAttribute("data-muted");
      expect(
        screen.getByRole("meter", { name: "Microphone level" }),
      ).toHaveAttribute("data-muted");
      expect(
        screen
          .getByRole("button", { name: "Mute Volume" })
          .closest("[data-muted]"),
      ).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "Unmute Microphone" })
          .closest("[data-muted]")?.className,
      ).toContain(css({ color: "muted" }));
    });

    it("has the first microphone when the server's default input is a monitor", () => {
      const sound = heldSound();
      mixer(sound, {
        ...laptop,
        inputs: laptop.inputs.map((input) => ({
          ...input,
          default: input.monitor,
        })),
      });

      expect(
        screen.getByRole("slider", { name: "Microphone" }),
      ).toHaveAttribute("aria-valuenow", "30");
    });

    it("meters only what is on screen", async () => {
      const sound = heldSound();
      mixer(sound);
      expect(sound.metered.at(-1)).toEqual(["output:speakers", "input:mic"]);

      await userEvent.click(screen.getByRole("button", { name: "Apps" }));

      expect(sound.metered.at(-1)).toEqual([
        "output:speakers",
        "input:mic",
        "playback:42",
      ]);
    });
  });

  describe("where sound goes", () => {
    it("lists each plugged-in port and device, the one in use picked", () => {
      const sound = heldSound();
      mixer(sound);

      const outputs = screen.getByRole("radiogroup", { name: "Play sound on" });
      expect(
        within(outputs)
          .getAllByRole("radio")
          .map((radio) => [
            radio.textContent,
            radio.getAttribute("aria-checked"),
          ]),
      ).toStrictEqual([
        ["Speakers", "true"],
        ["HDMI", "false"],
      ]);
    });

    it("makes another device the default", async () => {
      const sound = heldSound();
      mixer(sound);

      await userEvent.click(screen.getByRole("radio", { name: "HDMI" }));

      expect(sound.asked).toEqual([["setDefault", "output:hdmi"]]);
    });

    it("switches the device's port", async () => {
      const sound = heldSound();
      mixer(sound, {
        ...laptop,
        outputs: laptop.outputs.map((output) => ({
          ...output,
          ports: output.ports.map((port) => ({ ...port, available: true })),
        })),
      });

      await userEvent.click(screen.getByRole("radio", { name: "Headphones" }));

      expect(sound.asked).toEqual([
        ["setPort", "output:speakers", "analog-output-headphones"],
      ]);
    });

    it("offers no choice with only one way", () => {
      const sound = heldSound();
      mixer(sound, {
        ...laptop,
        outputs: [device({ default: true })],
      });

      expect(
        screen.queryByRole("radiogroup", { name: "Play sound on" }),
      ).toBeNull();
      expect(
        screen.queryByRole("radiogroup", { name: "Record from" }),
      ).toBeNull();
    });
  });

  describe("apps", () => {
    it("opens a drawer of each app and its streams", async () => {
      const sound = heldSound();
      mixer(sound);

      await userEvent.click(screen.getByRole("button", { name: "Apps" }));

      expect(screen.getByRole("heading", { name: "Firefox" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "Recorder" })).toBeVisible();
      expect(sound.metered.at(-1)).toEqual([
        "output:speakers",
        "input:mic",
        "playback:42",
      ]);
    });

    it("turns down what is playing, and moves it", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(screen.getByRole("button", { name: "Apps" }));

      await userEvent.click(
        screen.getByRole("button", { name: "Mute Firefox: A song" }),
      );
      await choose("Firefox: A song output", "HDMI");

      expect(sound.asked).toEqual([
        ["setMuted", "playback:42", true],
        ["moveStream", "playback:42", "output:hdmi"],
      ]);
    });

    it("can record from what an output plays", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(screen.getByRole("button", { name: "Apps" }));

      await choose("Recorder input", "Monitor of Speakers");

      expect(sound.asked).toEqual([
        ["moveStream", "recording:7", "input:speakers.monitor"],
      ]);
    });

    it("has no drawer when nothing plays or records", () => {
      const sound = heldSound();
      mixer(sound, { ...laptop, playback: [], recording: [] });

      expect(
        screen.queryByRole("button", { name: "Apps" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("cards", () => {
    it("switches a card's profile", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(
        screen.getByRole("button", { name: "Sound cards" }),
      );

      await choose("Built-in Audio profile", "Off");

      expect(sound.asked).toEqual([["setProfile", "alsa_card.pci", "off"]]);
    });
  });
});
