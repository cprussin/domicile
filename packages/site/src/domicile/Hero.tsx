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
    lede="If you can build a web page, you can build a desktop. Use React, CSS and anything on npm, or just describe it to your coding agent. Your apps still run natively, at full speed."
    tag={{
      href: "/docs/reference/elements",
      label: "Build a Wayland compositor with web technologies",
    }}
    title="The fastest way to build a Linux desktop."
  />
);
