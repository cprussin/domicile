import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { AudioError } from "./audio-error";
import { argv, coalesce, Request } from "./request";

const words = (request: Request): readonly string[] =>
  argv(request).match({
    Err: (error) => {
      throw new Error(`refused: ${JSON.stringify(error)}`);
    },
    Ok: (args) => args,
  });

describe("argv", () => {
  it("sets a volume as the raw value of every channel", () => {
    expect(words(Request.Volume("output:speakers", 0.5))).toStrictEqual([
      "--",
      "set-sink-volume",
      "speakers",
      "32768",
    ]);
    expect(words(Request.Volume("input:mic", 1))).toStrictEqual([
      "--",
      "set-source-volume",
      "mic",
      "65536",
    ]);
    expect(words(Request.Volume("playback:42", 0.25))).toStrictEqual([
      "--",
      "set-sink-input-volume",
      "42",
      "16384",
    ]);
    expect(words(Request.Volume("recording:7", 0))).toStrictEqual([
      "--",
      "set-source-output-volume",
      "7",
      "0",
    ]);
  });

  it("keeps a volume between silence and pavucontrol's 150%", () => {
    expect(words(Request.Volume("output:s", 9))[3]).toBe("98304");
    expect(words(Request.Volume("output:s", -1))[3]).toBe("0");
    expect(argv(Request.Volume("output:s", Number.NaN))).toStrictEqual(
      Err(AudioError.NotANumber()),
    );
    expect(
      argv(Request.Volume("output:s", Number.POSITIVE_INFINITY)),
    ).toStrictEqual(Err(AudioError.NotANumber()));
  });

  it("mutes the same things", () => {
    expect(words(Request.Muted("output:speakers", true))).toStrictEqual([
      "--",
      "set-sink-mute",
      "speakers",
      "1",
    ]);
    expect(words(Request.Muted("recording:7", false))).toStrictEqual([
      "--",
      "set-source-output-mute",
      "7",
      "0",
    ]);
  });

  it("makes only a device the default", () => {
    expect(words(Request.Default("output:speakers"))).toStrictEqual([
      "--",
      "set-default-sink",
      "speakers",
    ]);
    expect(words(Request.Default("input:mic"))).toStrictEqual([
      "--",
      "set-default-source",
      "mic",
    ]);
    expect(argv(Request.Default("playback:4"))).toStrictEqual(
      Err(AudioError.NotADevice("playback:4")),
    );
  });

  it("moves a stream to a device of its own direction", () => {
    expect(
      words(Request.Move("playback:42", "output:headphones")),
    ).toStrictEqual(["--", "move-sink-input", "42", "headphones"]);
    expect(
      words(Request.Move("recording:7", "input:speakers.monitor")),
    ).toStrictEqual(["--", "move-source-output", "7", "speakers.monitor"]);
    expect(argv(Request.Move("playback:42", "input:mic"))).toStrictEqual(
      Err(AudioError.Mismatched("playback:42", "input:mic")),
    );
  });

  it("switches ports and profiles", () => {
    expect(
      words(Request.Port("output:s", "analog-output-headphones")),
    ).toStrictEqual(["--", "set-sink-port", "s", "analog-output-headphones"]);
    expect(words(Request.Port("input:m", "analog-input-mic"))).toStrictEqual([
      "--",
      "set-source-port",
      "m",
      "analog-input-mic",
    ]);
    expect(words(Request.Profile("alsa_card.pci", "off"))).toStrictEqual([
      "--",
      "set-card-profile",
      "alsa_card.pci",
      "off",
    ]);
  });

  it("refuses an id it never gave out", () => {
    for (const id of [
      "speakers",
      "sink:speakers",
      "playback:forty-two",
      "playback:-1",
      "output:",
    ]) {
      expect(argv(Request.Muted(id, true))).toStrictEqual(
        Err(AudioError.UnknownId(id)),
      );
    }
  });

  it("starts with `--`, so a name cannot be read as an option", () => {
    expect(words(Request.Default("output:--help"))).toStrictEqual([
      "--",
      "set-default-sink",
      "--help",
    ]);
    expect(argv(Request.Default("output:x"))).toStrictEqual(
      Ok(["--", "set-default-sink", "x"]),
    );
  });
});

describe("coalesce", () => {
  it("asks for a drag where it ends up", () => {
    const mute = Request.Muted("output:a", true);

    expect(
      coalesce([
        Request.Volume("output:a", 0.1),
        Request.Volume("input:b", 0.2),
        Request.Volume("output:a", 0.3),
        mute,
        Request.Volume("output:a", 0.4),
      ]),
    ).toStrictEqual([
      Request.Volume("input:b", 0.2),
      Request.Volume("output:a", 0.3),
      mute,
      Request.Volume("output:a", 0.4),
    ]);
  });
});
