import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";

/** The Domicile page's opening: what it is, and where to start. */
export const Hero = () => (
  <PageHero
    actions={
      <>
        <LinkButton href="#quickstart" size="lg">
          Write your first shell
        </LinkButton>
        <LinkButton href="#docs" size="lg" variant="outline">
          Read the docs
        </LinkButton>
      </>
    }
    lede={
      <>
        With Domicile, a shell is a JavaScript module. Native windows are{" "}
        <code className={codeStyles}>&lt;app&gt;</code> elements and web pages
        are <code className={codeStyles}>&lt;webview&gt;</code>s, side by side
        in the same DOM. Build your desktop with the power of the web: React,
        Svelte, Tailwind or plain CSS.
      </>
    }
    tag={{
      href: "#platform",
      label: "Build a Wayland compositor with web technologies",
    }}
    title="Your desktop is a web page."
  />
);

const codeStyles = css({ color: "foreground", fontFamily: "code" });
