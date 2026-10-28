import { css } from "../../styled-system/css";
import { Hero as PageHero } from "../page/Hero";
import { LinkButton } from "../page/LinkButton";
import { SectionLinks } from "./SectionLinks";

/** The Domicile page's opening: what it is, where to start, and what's on the page. */
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
    lede={
      <>
        With Domicile, a shell is a JavaScript module. Native windows are{" "}
        <code className={codeStyles}>&lt;app&gt;</code> elements and web pages
        are <code className={codeStyles}>&lt;webview&gt;</code>s, side by side
        in the same DOM. So anything a web page can do, your desktop can do.
        Write it in React, Tailwind or plain CSS, or describe it to your coding
        agent. It already knows the web.
      </>
    }
    tag={{
      href: "#platform",
      label: "Build a Wayland compositor with web technologies",
    }}
    title="Your desktop is a web page."
  >
    <SectionLinks />
  </PageHero>
);

const codeStyles = css({ color: "foreground", fontFamily: "code" });
