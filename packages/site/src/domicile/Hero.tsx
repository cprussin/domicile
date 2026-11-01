import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";

/** The Domicile page's opening: why to use it, and where to start. */
export const Hero = () => (
  <PageHero
    actions={
      <>
        <LinkButton href="#make" size="lg">
          Make your own desktop
        </LinkButton>
        <LinkButton href="#docs" size="lg" variant="outline">
          Read the docs
        </LinkButton>
      </>
    }
    lede="If you can build a web page, you can build a desktop. Use React, CSS and anything on npm, or just describe it to your coding agent. Wayland apps still run natively."
    tag={{
      href: "/docs/reference/elements",
      label: "Build your Wayland desktop with web technologies",
    }}
    title="The fastest way to build a Linux desktop."
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
