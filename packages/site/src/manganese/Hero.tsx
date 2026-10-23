import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";
import { CopyCommand } from "./CopyCommand";

/** The manganese page's opening: what it is, and how to try it. */
export const Hero = () => (
  <PageHero
    actions={
      <>
        <LinkButton href="#install" size="lg">
          Install manganese
        </LinkButton>
        <LinkButton href="#tour" size="lg" variant="outline">
          Take the tour
        </LinkButton>
      </>
    }
    lede="Manganese is a tiling Wayland desktop with Sway's layout and keys. It comes with a browser built in, a launcher, a top bar and notifications."
    tag={{ href: "/", label: "The reference shell for Domicile →" }}
    title="Sway, with more <div>s."
  >
    <CopyCommand command="nix run github:cprussin/domicile/stable#manganese" />
    <span className={noteStyles}>
      Try it in a window first. Packages for Debian, Ubuntu, Fedora, openSUSE
      and Arch are{" "}
      <a className={linkStyles} href="#install">
        below
      </a>
      .
    </span>
  </PageHero>
);

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({ color: "accent" });
