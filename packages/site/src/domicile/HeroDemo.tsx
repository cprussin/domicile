import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Media } from "../media/Media";

/** The hero's capture: native windows and a website, restyled by CSS. */
export const HeroDemo = () => (
  <figure className={figureStyles}>
    <Media
      alt="SuperTuxKart, Big Buck Bunny in mpv, a terminal aquarium and Wikipedia in a grid. One CSS rule after another tilts them in 3D, blurs all but one, rotates two and rearranges the grid. The rule in effect shows at the bottom."
      name="possible-css"
    />
    <figcaption className={captionStyles}>
      A real capture. The game, the film and the terminal are native Wayland
      apps, and Wikipedia is a website. The line at the bottom is the CSS the
      desktop applies to them.
    </figcaption>
  </figure>
);

const figureStyles = flex({
  direction: "column",
  gap: 3,
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 28,
  paddingInline: 6,
});

const captionStyles = css({
  color: "muted",
  fontSize: "sm",
  marginInline: "auto",
  maxInlineSize: "3xl",
  textAlign: "center",
});
