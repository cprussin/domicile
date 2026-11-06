import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";

/** The Domicile page's opening: the idea, and where to go next. */
export const Hero = () => (
  <PageHero
    actions={
      <>
        <LinkButton href="#possible" size="lg">
          See what's possible
        </LinkButton>
        <LinkButton href="#build" size="lg" variant="outline">
          Build something weird
        </LinkButton>
      </>
    }
    lede={
      <>
        Domicile brings Chromium and Wayland together, making websites and
        native applications part of the same desktop. Your desktop lays out
        websites, native apps become DOM elements, and browser features like
        casting, extensions and notifications become desktop features.
        <span className={experimentStyles}>
          An experiment in what becomes possible when the boundaries disappear.
        </span>
      </>
    }
    tag={{ href: "#why", label: "A Linux desktop on Chromium" }}
    title="The web doesn't have to live in a window."
  >
    {/* A window needs a Wayland session: there is no X11 backend. */}
    <p className={trialStyles}>
      <a className={trialLinkStyles} href="/docs/install#try-it-first">
        Try it in a window
      </a>{" "}
      on your current Wayland desktop.
    </p>
  </PageHero>
);

const experimentStyles = css({
  color: "foreground",
  display: "block",
  marginBlockStart: 3,
});

// Pulled toward the buttons it qualifies, past the hero's gap.
const trialStyles = css({
  color: "muted",
  fontSize: "sm",
  marginBlockStart: -2,
});

const trialLinkStyles = css({
  _hover: { color: "accent" },
  color: "foreground",
  textDecoration: "underline",
});
