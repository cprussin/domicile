import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OnOneScreen, SCREEN } from "../screens/fixture";
import { heldSound, laptop } from "./fixture";
import { Mixer } from "./Mixer";

const mixer = (sound: ReturnType<typeof heldSound>) =>
  render(
    <Mixer
      audio={laptop}
      domicile={sound.domicile}
      onOpenChange={() => undefined}
      open
      screen={SCREEN}
    />,
    { wrapper: OnOneScreen },
  );

const tab = async (name: string) => {
  await userEvent.click(screen.getByRole("tab", { name }));
  return screen.getByRole("tabpanel");
};

const choose = async (panel: HTMLElement, box: string, option: string) => {
  await userEvent.click(within(panel).getByRole("combobox", { name: box }));
  await userEvent.click(screen.getByRole("option", { name: option }));
};

describe("Mixer", () => {
  describe("playback", () => {
    it("lists what is playing, and turns each down", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Playback");

      const slider = within(panel).getByRole("slider", {
        name: "Firefox: A song",
      });
      slider.focus();
      await userEvent.keyboard("{ArrowLeft}");

      expect(sound.asked).toEqual([["setAudioVolume", "playback:42", 0.99]]);
    });

    it("moves a stream to another output", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Playback");

      await choose(panel, "Firefox: A song plays on", "HDMI");

      expect(sound.asked).toEqual([
        ["moveAudioStream", "playback:42", "output:hdmi"],
      ]);
    });
  });

  describe("recording", () => {
    it("can record from what an output plays", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Recording");

      await choose(panel, "Recorder records from", "Monitor of Speakers");

      expect(sound.asked).toEqual([
        ["moveAudioStream", "recording:7", "input:speakers.monitor"],
      ]);
    });
  });

  describe("outputs", () => {
    it("lists every output, and makes one the default", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Outputs");

      expect(
        within(panel).getByRole("slider", { name: "Speakers" }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Speakers is the default" }),
      ).toBeDisabled();
      await userEvent.click(
        within(panel).getByRole("button", { name: "Make HDMI the default" }),
      );

      expect(sound.asked).toEqual([["setDefaultAudioDevice", "output:hdmi"]]);
    });

    it("switches a device's port, unplugged ones said so", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Outputs");

      await choose(panel, "Speakers port", "Headphones (unplugged)");

      expect(sound.asked).toEqual([
        ["setAudioPort", "output:speakers", "analog-output-headphones"],
      ]);
    });
  });

  describe("inputs", () => {
    it("lists the inputs but not the outputs' monitors", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Inputs");

      expect(
        within(panel).getByRole("slider", { name: "Microphone" }),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByRole("slider", { name: "Monitor of Speakers" }),
      ).not.toBeInTheDocument();
    });

    it("mutes one", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Inputs");

      await userEvent.click(
        within(panel).getByRole("button", { name: "Mute Microphone" }),
      );

      expect(sound.asked).toEqual([["setAudioMuted", "input:mic", true]]);
    });
  });

  describe("cards", () => {
    it("switches a card's profile", async () => {
      const sound = heldSound();
      mixer(sound);
      const panel = await tab("Cards");

      await choose(panel, "Built-in Audio profile", "Off");

      expect(sound.asked).toEqual([
        ["setAudioProfile", "alsa_card.pci", "off"],
      ]);
    });
  });
});
