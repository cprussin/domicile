import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FullScreen } from "./FullScreen";

test("a video gets a button that plays it full screen", () => {
  const html = renderToStaticMarkup(
    <FullScreen label="Watch full screen">
      <video aria-label="Three terminals tiled" loop muted />
    </FullScreen>,
  );
  expect(html).toMatch(/<video[^>]*aria-label="Three terminals tiled"/);
  expect(html).toMatch(/<button[^>]*aria-label="Watch full screen"/);
});

test("a picture gets a button that shows it full screen", () => {
  const html = renderToStaticMarkup(
    <FullScreen label="View full screen">
      <img alt="The lock screen" src="/media/tour-lock.png" />
    </FullScreen>,
  );
  expect(html).toMatch(/<img[^>]*alt="The lock screen"/);
  expect(html).toMatch(/<button[^>]*aria-label="View full screen"/);
});

// A docs page's picture sits in a paragraph, which can't hold a <div>.
test("its markup can sit in a paragraph", () => {
  const html = renderToStaticMarkup(
    <FullScreen label="View full screen">
      <img alt="The lock screen" src="/media/tour-lock.png" />
    </FullScreen>,
  );
  expect(html).not.toContain("<div");
});
