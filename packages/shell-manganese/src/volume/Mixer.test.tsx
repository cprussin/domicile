import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { heldSound, laptop } from "./fixture";
import { Mixer } from "./Mixer";

const mixer = (sound: ReturnType<typeof heldSound>) =>
  render(
    <Mixer
      audio={laptop}
      domicile={sound.domicile}
      watchLevels={sound.watchLevels}
    />,
  );

/** Open a section, and the region it opened. */
const section = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("region", { name });
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

    it("meters only what is on screen", async () => {
      const sound = heldSound();
      mixer(sound);
      expect(sound.metered.at(-1)).toEqual(["output:speakers", "input:mic"]);

      await section("Outputs");

      expect(sound.metered.at(-1)).toEqual([
        "output:speakers",
        "input:mic",
        "output:hdmi",
      ]);
    });

    it("leaves out a section with nothing in it", () => {
      const sound = heldSound();
      render(
        <Mixer
          audio={{ ...laptop, recording: [] }}
          domicile={sound.domicile}
          watchLevels={sound.watchLevels}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Recording" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("outputs", () => {
    it("turns any of them, and makes one the default", async () => {
      const sound = heldSound();
      mixer(sound);
      const outputs = await section("Outputs");

      within(outputs).getByRole("slider", { name: "HDMI" }).focus();
      await userEvent.keyboard("{ArrowLeft}");
      await userEvent.click(
        within(outputs).getByRole("button", { name: "Make HDMI the default" }),
      );

      expect(
        within(outputs).getByRole("button", {
          name: "Speakers is the default",
        }),
      ).toBeDisabled();
      expect(sound.asked).toEqual([
        ["setAudioVolume", "output:hdmi", 0.99],
        ["setDefaultAudioDevice", "output:hdmi"],
      ]);
    });

    it("switches a port from a list that slides in, and back out", async () => {
      const sound = heldSound();
      mixer(sound);
      const outputs = await section("Outputs");

      await userEvent.click(
        within(outputs).getByRole("button", {
          name: "Speakers port: Speakers",
        }),
      );
      expect(
        screen.getByRole("heading", { name: "Speakers port" }),
      ).toBeVisible();
      await userEvent.click(
        screen.getByRole("button", { name: "Headphones (unplugged)" }),
      );

      expect(sound.asked).toEqual([
        ["setAudioPort", "output:speakers", "analog-output-headphones"],
      ]);
      // Chosen is done: the list slides back out.
      expect(
        screen.queryByRole("heading", { name: "Speakers port" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("inputs", () => {
    it("lists the inputs but not the outputs' monitors", async () => {
      const sound = heldSound();
      mixer(sound);
      const inputs = await section("Inputs");

      expect(
        within(inputs).getByRole("slider", { name: "Microphone" }),
      ).toBeInTheDocument();
      expect(
        within(inputs).queryByRole("slider", { name: "Monitor of Speakers" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("streams", () => {
    it("turns down what is playing, and moves it", async () => {
      const sound = heldSound();
      mixer(sound);
      const playback = await section("Playback");

      await userEvent.click(
        within(playback).getByRole("button", { name: "Mute Firefox: A song" }),
      );
      await userEvent.click(
        within(playback).getByRole("button", {
          name: "Firefox: A song plays on Speakers",
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "HDMI" }));

      expect(sound.asked).toEqual([
        ["setAudioMuted", "playback:42", true],
        ["moveAudioStream", "playback:42", "output:hdmi"],
      ]);
    });

    it("can record from what an output plays", async () => {
      const sound = heldSound();
      mixer(sound);
      const recording = await section("Recording");

      await userEvent.click(
        within(recording).getByRole("button", {
          name: "Recorder records from Microphone",
        }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Monitor of Speakers" }),
      );

      expect(sound.asked).toEqual([
        ["moveAudioStream", "recording:7", "input:speakers.monitor"],
      ]);
    });
  });

  describe("cards", () => {
    it("switches a card's profile", async () => {
      const sound = heldSound();
      mixer(sound);
      const cards = await section("Cards");

      await userEvent.click(
        within(cards).getByRole("button", {
          name: "Built-in Audio profile: Analog Stereo Output",
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Off" }));

      expect(sound.asked).toEqual([
        ["setAudioProfile", "alsa_card.pci", "off"],
      ]);
    });
  });
});
