import { css } from "../../styled-system/css";
import { Apps } from "../domicile/Apps";
import { Batteries } from "../domicile/Batteries";
import { DomicileMark } from "../domicile/DomicileMark";
import { DOCS } from "../domicile/docs";
import { Faq } from "../domicile/Faq";
import { Hero } from "../domicile/Hero";
import { HeroMedia } from "../domicile/HeroMedia";
import { Make } from "../domicile/Make";
import { Npm } from "../domicile/Npm";
import { Quickstart } from "../domicile/Quickstart";
import { ReferenceShell } from "../domicile/ReferenceShell";
import { Showcase } from "../domicile/Showcase";
import { Accent } from "../page/Accent";
import { LinkColumns } from "../page/LinkColumns";
import { REPO, repoFile } from "../page/repo";
import { Section } from "../page/Section";
import { SiteFooter } from "../page/SiteFooter";
import { SiteHeader } from "../page/SiteHeader";
import { shared } from "../page/shared";

export const metadata = shared({
  description:
    "Domicile is a Wayland compositor whose shell is a web page. Write your desktop in one file of React or CSS, or start from manganese.",
  path: "/",
  title: "Domicile: build your Linux desktop with web technologies",
});

/** domicile-desktop.com: Domicile, for shell authors. */
const DomicilePage = () => (
  <Accent product="domicile">
    <SiteHeader
      action={{ href: "#quickstart", label: "Quickstart" }}
      brand={<DomicileMark />}
      links={[
        { href: "#docs", label: "Docs" },
        { href: "/docs/reference/react", label: "API reference" },
        { href: "/manganese", label: "Manganese" },
        { href: REPO, label: "GitHub" },
      ]}
    />
    <main>
      <Hero />
      <HeroMedia />
      <Make />
      <ReferenceShell />
      <Showcase />
      <Batteries />
      <Quickstart />
      <Npm />
      <Apps />
      <Faq />
      <Section id="docs" title="Docs">
        <LinkColumns columns={DOCS} />
      </Section>
    </main>
    <SiteFooter
      links={[
        { href: "/manganese", label: "Manganese" },
        { href: REPO, label: "GitHub" },
        { href: repoFile("LICENSE"), label: "MIT license" },
      ]}
    >
      <blockquote className={quoteStyles}>
        "Your scientists were so preoccupied with whether they could, they
        didn't stop to think if they should."
      </blockquote>
    </SiteFooter>
  </Accent>
);

export default DomicilePage;

const quoteStyles = css({ fontStyle: "italic", maxInlineSize: "xl" });
