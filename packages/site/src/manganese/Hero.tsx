import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";
import { CopyCommand } from "./CopyCommand";

/** The manganese page's opening: what it is, and how to try it. */
export const Hero = () => (
  <PageHero
    actions={
      <>
        <LinkButton href="#try" size="lg">
          Try manganese
        </LinkButton>
        <LinkButton href="#tour" size="lg" variant="outline">
          Take the tour
        </LinkButton>
      </>
    }
    lede="A tiling Wayland desktop that feels like Sway, where websites are windows too. Change its bar, launcher or anything else in React and CSS, without writing a desktop."
    tag={{ href: "/", label: "The reference shell for Domicile →" }}
    title="Sway, with more <div>s."
  >
    <CopyCommand command="nix run github:cprussin/domicile/stable#manganese" />
    <span className={noteStyles}>
      With Nix, try it in a window first. Packages for Debian, Ubuntu, Fedora,
      openSUSE and Arch are{" "}
      <a className={linkStyles} href="#install">
        below
      </a>
      .
    </span>
  </PageHero>
);

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({ color: "accent" });
