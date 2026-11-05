import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { ScreencastIcon } from "@phosphor-icons/react/dist/ssr/Screencast";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { TelevisionSimpleIcon } from "@phosphor-icons/react/dist/ssr/TelevisionSimple";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { Media } from "../media/Media";
import { IconTile } from "../page/IconTile";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

type Demo = {
  title: string;
  body: ReactNode;
  /** The capture's name in `docs/media/`, and what it shows. */
  media: { name: string; shows: string };
  code: { text: string; language: Language };
  /** Where to read the detail, and what doesn't work. */
  more: { href: string; label: string };
};

const linkStyles = css({ color: "foreground", textDecoration: "underline" });

/** The capabilities, each shown by a capture of a real desktop. */
const DEMOS: readonly Demo[] = [
  {
    body: "A website opens in a window of its own, with no browser around it. It tiles beside native apps, moves between workspaces, floats and resizes, with the same keys as every other window.",
    code: {
      language: "tsx",
      text: '<webview src="https://en.wikipedia.org" />',
    },
    media: {
      name: "possible-websites",
      shows:
        "In manganese, Wikipedia opened from the launcher beside a LibreOffice document, put side by side, sent to workspace 2 and floated",
    },
    more: { href: "/docs/shells/browser-windows", label: "Browser windows" },
    title: "Websites are windows.",
  },
  {
    body: "An <app> element shows a native app's window, so CSS applies to it as to any element: layout, transforms, filters, blending and animation. This desktop is an article. The terminal floats in its text, and the windows scroll with the page.",
    code: {
      language: "css",
      text: ".terminal {\n  float: right;\n}\n\n.film h2 {\n  mix-blend-mode: difference;\n}",
    },
    media: {
      name: "possible-blend",
      shows:
        "A desktop laid out as an article: text wraps around a live terminal aquarium, Wikipedia sits in it as a figure, and Big Buck Bunny plays under a heading blended over it. The article scrolls, and every window scrolls with it.",
    },
    more: {
      href: repoFile(
        "docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity",
      ),
      label: "CSS on an <app> matches a <div>, pixel for pixel",
    },
    title: "Native windows are elements.",
  },
  {
    body: "To a Chrome extension, every website on the desktop is a tab, on any workspace. This one is a few dozen lines: its popup lists them all, and picking one asks the desktop to show it. Manifest V3 only, and some calls, such as moving tabs, are refused.",
    code: {
      language: "tsx",
      text: "const sites = await chrome.tabs.query({});\n\nchrome.tabs.update(site.id, { active: true });",
    },
    media: {
      name: "possible-extensions",
      shows:
        "An extension's popup, opened from manganese's bar, lists the websites on three workspaces. Clicking Wikipedia switches to its workspace.",
    },
    more: {
      href: repoFile("docs/architecture/EXTENSIONS.md#tabs"),
      label: "What extensions can do",
    },
    title: "Extensions see the whole desktop.",
  },
];

/** Browser features that reach the desktop's own apps. */
const FEATURES: readonly { icon: ReactNode; title: string; body: string }[] = [
  {
    body: "Share a native app's window into a video call in a website. The desktop draws the picker.",
    icon: <ScreencastIcon />,
    title: "Screen sharing",
  },
  {
    body: "Chromecasts through the engine's own Google Cast, Miracast TVs through Domicile. Mirror a window or extend onto the TV.",
    icon: <TelevisionSimpleIcon />,
    title: "Casting",
  },
  {
    body: "Websites and native apps notify through the same server, into the same list.",
    icon: <BellIcon />,
    title: "Notifications",
  },
  {
    body: "When a site asks for the camera or your location, your desktop asks you.",
    icon: <ShieldCheckIcon />,
    title: "Permissions",
  },
];

/** What unifying the browser and the desktop makes possible. */
export const Possible = () => (
  <Section
    id="possible"
    lede="Once the web is out of its window, websites, native apps and the desktop's interface share one page, and the line between a website and an app stops mattering."
    title="What becomes possible."
  >
    <div className={rowsStyles}>
      {DEMOS.map((demo) => (
        <article className={rowStyles} key={demo.title}>
          <div className={mediaStyles}>
            <Media alt={demo.media.shows} name={demo.media.name} />
          </div>
          <div className={textStyles}>
            <h3 className={titleStyles}>{demo.title}</h3>
            <p className={bodyStyles}>{demo.body}</p>
            <CodeBlock code={demo.code.text} language={demo.code.language} />
            <a className={linkStyles} href={demo.more.href}>
              {demo.more.label}
            </a>
          </div>
        </article>
      ))}
      <article className={featuresStyles}>
        <div className={textStyles}>
          <h3 className={titleStyles}>
            Browser features are desktop features.
          </h3>
          <p className={bodyStyles}>
            The engine that runs your websites also runs the desktop, so what it
            can do reaches native apps too.
          </p>
        </div>
        <ul className={featureListStyles}>
          {FEATURES.map((feature) => (
            <li className={featureStyles} key={feature.title}>
              <IconTile>{feature.icon}</IconTile>
              <span className={featureTitleStyles}>{feature.title}</span>
              <span className={featureBodyStyles}>{feature.body}</span>
            </li>
          ))}
        </ul>
      </article>
    </div>
  </Section>
);

const rowsStyles = flex({ direction: "column", gap: 20 });

// Each capture about two thirds of the page, beside its text, on alternating
// sides. On a phone the text goes under it.
const rowStyles = flex({
  "&:nth-of-type(even)": { flexDirection: { lg: "row-reverse" } },
  align: "center",
  direction: { base: "column", lg: "row" },
  gap: { base: 5, lg: 10 },
});

const mediaStyles = css({
  flex: { lg: 3 },
  inlineSize: "100%",
  minInlineSize: 0,
});

const textStyles = flex({
  direction: "column",
  flex: { lg: 2 },
  gap: 3,
  inlineSize: "100%",
  minInlineSize: 0,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "2xl", md: "3xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
});

const bodyStyles = css({ color: "muted" });

const featuresStyles = flex({ direction: "column", gap: 6 });

const featureListStyles = grid({
  gap: 5,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
  listStyle: "none",
});

const featureStyles = flex({ direction: "column", gap: 2 });

const featureTitleStyles = css({ fontWeight: "semibold" });

const featureBodyStyles = css({ color: "muted", fontSize: "sm" });
