import type { AudioChoice } from "@domicile-desktop/system-audio/audio";

const SURROUND = /^output:analog-surround-(\d)(\d)$/;

/**
 * A sound card mode as people would put it: "Stereo sound and microphone"
 * for `output:analog-stereo+input:analog-stereo`. A mode it doesn't know
 * keeps the sound server's name.
 */
export const profileName = (profile: AudioChoice): string => {
  if (profile.name === "off") {
    return "Off";
  } else if (profile.name.startsWith("a2dp-sink")) {
    return "High-quality sound";
  } else if (profile.name.startsWith("headset-head-unit")) {
    return "Headset with microphone";
  } else {
    return mixedName(profile.name.split("+")) ?? profile.description;
  }
};

/** Names `output:…` and `input:…` parts together; `undefined` for any unknown. */
const mixedName = (parts: readonly string[]): string | undefined => {
  const outputs = parts.map(outputName);
  const inputs = parts.filter((part) => part === "input:analog-stereo");
  const output = outputs.find((name) => name !== undefined);
  const known = outputs.filter((name) => name !== undefined).length;
  if (known + inputs.length !== parts.length) {
    return undefined;
  } else if (output === undefined) {
    return "Microphone only";
  } else {
    return inputs.length > 0
      ? `${output} sound and microphone`
      : `${output} sound only`;
  }
};

/** The kind of sound an `output:…` part plays, such as "5.1 surround". */
const outputName = (part: string): string | undefined => {
  if (part === "output:analog-stereo") {
    return "Stereo";
  } else if (SURROUND.test(part)) {
    return part.replace(SURROUND, "$1.$2 surround");
  } else if (/^output:hdmi-stereo(-extra\d+)?$/.test(part)) {
    return "HDMI stereo";
  } else {
    return undefined;
  }
};
