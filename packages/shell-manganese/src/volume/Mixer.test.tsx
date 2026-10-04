import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { device, heldSound, laptop } from "./fixture";
import { Mixer } from "./Mixer";

const mixer = (
  sound: ReturnType<typeof heldSound>,
  audio: typeof laptop = laptop,
) =>
  render(
    <Mixer
      audio={audio}
      domicile={sound.domicile}
      watchLevels={sound.watchLevels}
    />,
  );

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

    it("switches the default output's port without leaving", async () => {
      const sound = heldSound();
      mixer(sound);

      await choose("Speakers port", "Headphones (unplugged)");

      expect(sound.asked).toEqual([
        ["setAudioPort", "output:speakers", "analog-output-headphones"],
      ]);
    });

    it("has no way to the rest when there is none", () => {
      const sound = heldSound();
      mixer(sound, {
        ...laptop,
        outputs: [device({ default: true })],
      });

      expect(
        screen.queryByRole("button", { name: "More outputs" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "More inputs" }),
      ).not.toBeInTheDocument();
    });

    it("meters only what is on screen", async () => {
      const sound = heldSound();
      mixer(sound);
      expect(sound.metered.at(-1)).toEqual(["output:speakers", "input:mic"]);

      await userEvent.click(
        screen.getByRole("button", { name: "More outputs" }),
      );

      expect(sound.metered.at(-1)).toEqual([
        "output:speakers",
        "input:mic",
        "output:hdmi",
      ]);
    });
  });

  describe("more outputs", () => {
    it("opens a drawer of the rest under the default, and shuts it", async () => {
      const sound = heldSound();
      mixer(sound);
      const more = screen.getByRole("button", { name: "More outputs" });

      await userEvent.click(more);

      expect(screen.getByRole("slider", { name: "HDMI" })).toBeVisible();
      expect(
        screen.queryByRole("slider", { name: "Speakers" }),
      ).not.toBeInTheDocument();
      // The default is still there, over its drawer.
      expect(screen.getByRole("slider", { name: "Volume" })).toBeVisible();

      await userEvent.click(more);

      expect(
        screen.queryByRole("slider", { name: "HDMI" }),
      ).not.toBeInTheDocument();
    });

    it("turns one, and makes it the default", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(
        screen.getByRole("button", { name: "More outputs" }),
      );

      screen.getByRole("slider", { name: "HDMI" }).focus();
      await userEvent.keyboard("{ArrowLeft}");
      await userEvent.click(
        screen.getByRole("button", { name: "Make HDMI the default" }),
      );

      expect(sound.asked).toEqual([
        ["setAudioVolume", "output:hdmi", 0.99],
        ["setDefaultAudioDevice", "output:hdmi"],
      ]);
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
        ["setAudioMuted", "playback:42", true],
        ["moveAudioStream", "playback:42", "output:hdmi"],
      ]);
    });

    it("can record from what an output plays", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(screen.getByRole("button", { name: "Apps" }));

      await choose("Recorder input", "Monitor of Speakers");

      expect(sound.asked).toEqual([
        ["moveAudioStream", "recording:7", "input:speakers.monitor"],
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
      await userEvent.click(screen.getByRole("button", { name: "Cards" }));

      await choose("Built-in Audio profile", "Off");

      expect(sound.asked).toEqual([
        ["setAudioProfile", "alsa_card.pci", "off"],
      ]);
    });
  });
});
