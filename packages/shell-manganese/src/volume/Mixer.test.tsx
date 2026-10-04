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
        playback: [],
      });

      expect(
        screen.queryByRole("button", { name: "Other outputs" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Other inputs" }),
      ).toBeInTheDocument();
    });

    it("meters only what is on screen", async () => {
      const sound = heldSound();
      mixer(sound);
      expect(sound.metered.at(-1)).toEqual(["output:speakers", "input:mic"]);

      await userEvent.click(
        screen.getByRole("button", { name: "Other outputs" }),
      );

      expect(sound.metered.at(-1)).toEqual(["output:hdmi", "playback:42"]);
    });
  });

  describe("other outputs", () => {
    it("slides in the rest, but not the default, and back", async () => {
      const sound = heldSound();
      mixer(sound);

      await userEvent.click(
        screen.getByRole("button", { name: "Other outputs" }),
      );

      expect(
        screen.getByRole("heading", { name: "Other outputs" }),
      ).toBeVisible();
      expect(screen.getByRole("slider", { name: "HDMI" })).toBeVisible();
      expect(
        screen.queryByRole("slider", { name: "Speakers" }),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(
        screen.queryByRole("heading", { name: "Other outputs" }),
      ).not.toBeInTheDocument();
    });

    it("turns one, and makes it the default", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(
        screen.getByRole("button", { name: "Other outputs" }),
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

    it("turns down what is playing, and moves it", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(
        screen.getByRole("button", { name: "Other outputs" }),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Mute Firefox: A song" }),
      );
      await choose("Firefox: A song output", "HDMI");

      expect(sound.asked).toEqual([
        ["setAudioMuted", "playback:42", true],
        ["moveAudioStream", "playback:42", "output:hdmi"],
      ]);
    });
  });

  describe("other inputs", () => {
    it("leaves out the outputs' monitors, but can record from one", async () => {
      const sound = heldSound();
      mixer(sound);
      await userEvent.click(
        screen.getByRole("button", { name: "Other inputs" }),
      );

      expect(
        screen.queryByRole("slider", { name: "Monitor of Speakers" }),
      ).not.toBeInTheDocument();

      await choose("Recorder input", "Monitor of Speakers");

      expect(sound.asked).toEqual([
        ["moveAudioStream", "recording:7", "input:speakers.monitor"],
      ]);
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
