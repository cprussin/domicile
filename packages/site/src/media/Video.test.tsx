import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Video } from "./Video";

const VIDEO = {
  mp4: "/media/tour-tiling.mp4",
  poster: "/media/tour-tiling.png",
  webm: "/media/tour-tiling.webm",
};

test("a video loops muted, with a button that plays it full screen", () => {
  const html = renderToStaticMarkup(
    <Video alt="Three terminals tiled" className="media" video={VIDEO} />,
  );
  expect(html).toMatch(/<video[^>]*aria-label="Three terminals tiled"/);
  expect(html).toMatch(/<video[^>]*loop=""[^>]*muted=""/);
  expect(html).toMatch(/<button[^>]*aria-label="Watch full screen"/);
});
