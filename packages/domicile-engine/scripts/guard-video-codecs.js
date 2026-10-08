// The shell guard-video-codecs.sh drives. Reports whether the engine plays
// each codec, as `canPlayType` answers it:
//
//   GUARD codecs aac=<answer> h264=<answer> vp9=<answer>
//
// `answer` is `probably`, `maybe` or `no`. VP9 is the control: Chromium plays
// it in every build, so a `no` there means this page cannot see a codec.

const CODECS = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  h264: 'video/mp4; codecs="avc1.42E01E"',
  vp9: 'video/webm; codecs="vp9"',
};

export const Shell = () => {
  const video = document.createElement("video");
  console.log(
    `GUARD codecs ${Object.entries(CODECS)
      .map(([name, type]) => `${name}=${answer(video.canPlayType(type))}`)
      .join(" ")}`,
  );
};

// `canPlayType` says no with an empty string, which would not show in the log.
const answer = (canPlay) => (canPlay === "" ? "no" : canPlay);
