import { describe, expect, it } from "bun:test";

import type { Audio, AudioChoice } from "./audio";
import { Meter } from "./audio";
import { INFO, LIST } from "./pactl.fixture";
import { reading } from "./reading";

const read = (list: string = LIST): Audio =>
  reading(INFO, list).match({
    Err: (error) => {
      throw new Error(`unreadable: ${error}`);
    },
    Ok: (audio) => audio,
  });

const choice = (
  name: string,
  description: string,
  available: boolean,
): AudioChoice => ({ available, description, name });

describe("reading", () => {
  it("reads outputs from the sinks, at their loudest channel", () => {
    expect(read().outputs).toStrictEqual([
      {
        default: true,
        description: "Built-in Audio Analog Stereo",
        id: "output:alsa_output.analog-stereo",
        monitor: false,
        muted: false,
        port: "analog-output-speaker",
        ports: [
          choice("analog-output-speaker", "Speakers", true),
          choice("analog-output-headphones", "Headphones", false),
        ],
        volume: 39_322 / 65_536,
      },
      // An invalid volume reads as silence.
      {
        default: false,
        description: "HDMI",
        id: "output:hdmi",
        monitor: false,
        muted: true,
        port: undefined,
        ports: [],
        volume: 0,
      },
    ]);
  });

  it("reads inputs from the sources, with the monitors marked", () => {
    expect(
      read().inputs.map(({ id, monitor, volume, ...input }) => [
        id,
        monitor,
        input.default,
        volume,
      ]),
    ).toStrictEqual([
      ["input:alsa_output.analog-stereo.monitor", true, false, 1],
      ["input:alsa_input.analog-stereo", false, true, 0.25],
    ]);
  });

  it("names each stream's application and device, and hides other mixers' meters", () => {
    const audio = read();

    expect(audio.playback).toStrictEqual([
      {
        application: "Firefox",
        device: "output:alsa_output.analog-stereo",
        id: "playback:42",
        muted: false,
        title: "A song",
        volume: 1,
      },
      // Without an application name, the media name stands in.
      {
        application: "bell",
        device: "output:alsa_output.analog-stereo",
        id: "playback:43",
        muted: false,
        title: undefined,
        volume: 1,
      },
      // On a sink missing from the list.
      {
        application: "late",
        device: undefined,
        id: "playback:44",
        muted: false,
        title: undefined,
        volume: 1,
      },
    ]);
    expect(audio.recording).toStrictEqual([
      {
        application: "Recorder",
        device: "input:alsa_input.analog-stereo",
        id: "recording:7",
        muted: true,
        title: undefined,
        volume: 0.25,
      },
    ]);
  });

  it("lists each card's profiles best first", () => {
    expect(read().cards).toStrictEqual([
      {
        description: "Built-in Audio",
        id: "alsa_card.pci",
        profile: "output:analog-stereo",
        profiles: [
          choice("output:analog-stereo", "Analog Stereo Output", true),
          choice("output:hdmi-stereo", "Digital Stereo (HDMI) Output", false),
          choice("off", "Off", true),
        ],
      },
      // Without a description, the name stands in.
      {
        description: "bluez_card.00_11",
        id: "bluez_card.00_11",
        profile: undefined,
        profiles: [],
      },
    ]);
  });

  it("meters an output off its monitor, an input off itself and a stream off itself", () => {
    expect(read().meters).toStrictEqual(
      new Map<string, Meter>([
        [
          "output:alsa_output.analog-stereo",
          Meter.Source("alsa_output.analog-stereo.monitor"),
        ],
        [
          "input:alsa_output.analog-stereo.monitor",
          Meter.Source("alsa_output.analog-stereo.monitor"),
        ],
        [
          "input:alsa_input.analog-stereo",
          Meter.Source("alsa_input.analog-stereo"),
        ],
        ["playback:42", Meter.Stream(42)],
        ["playback:43", Meter.Stream(43)],
        ["playback:44", Meter.Stream(44)],
        ["playback:45", Meter.Stream(45)],
      ]),
    );
  });

  it("hides a filter's own stream", () => {
    // A laptop's speaker correction: a sink to play to, and a stream from it
    // into the hardware, tied by their link group.
    const list = LIST.replace(
      `"sinks": [`,
      `"sinks": [
    {"index": 76, "name": "audio_effect.laptop-convolver", "description": "Framework Speakers",
     "mute": false, "volume": {"front-left": {"value": 45875}}, "monitor_source": "audio_effect.laptop-convolver.monitor",
     "properties": {"node.link-group": "filter-chain-3901-18"}, "ports": [], "active_port": null},`,
    ).replace(
      `"sink_inputs": [`,
      `"sink_inputs": [
    {"index": 77, "sink": 51, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"media.name": "Framework Speakers", "node.link-group": "filter-chain-3901-18"}},`,
    );

    expect(read(list).playback.map(({ id }) => id)).toStrictEqual([
      "playback:42",
      "playback:43",
      "playback:44",
    ]);
  });

  it("hides its own meters' recordings", () => {
    const list = LIST.replace(
      `"source_outputs": [`,
      `"source_outputs": [
    {"index": 9, "source": 52, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"application.id": "org.domicile.meter"}},`,
    );

    expect(read(list).recording.map(({ id }) => id)).toStrictEqual([
      "recording:7",
    ]);
  });

  it("reads an input that names no sink as no monitor", () => {
    for (const none of [`""`, `"n/a"`]) {
      const list = LIST.replace(
        `"monitor_source": null,`,
        `"monitor_source": ${none},`,
      );

      expect(read(list).inputs[1]?.monitor).toBe(false);
    }
  });

  it("takes the device class's word for what is a monitor", () => {
    const list = LIST.replace(
      `"monitor_source": "alsa_output.analog-stereo",
     "properties": {}`,
      `"monitor_source": "",
     "properties": {"device.class": "monitor"}`,
    );

    expect(read(list).inputs[0]?.monitor).toBe(true);
  });

  it("fails on what is not pactl's JSON", () => {
    expect(reading(INFO, "Connection failure").isErr()).toBe(true);
    expect(reading(INFO, `{"sinks": [{"index": "one"}]}`).isErr()).toBe(true);
  });
});
