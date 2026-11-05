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
    lede="Websites are windows. Windows are HTML elements. The whole desktop is one web page, drawn by a modified Chromium that is also the Wayland compositor, so apps and sites tile, layer, animate and mix like anything else on the web."
    tag={{ href: "#why", label: "An experimental Linux desktop" }}
    title="The web ate your desktop."
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
