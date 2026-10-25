import { css } from "../../styled-system/css";
import { Cli } from "../domicile/Cli";
import { CssStrip } from "../domicile/CssStrip";
import { DomicileMark } from "../domicile/DomicileMark";
import { DOCS } from "../domicile/docs";
import { Hero } from "../domicile/Hero";
import { HeroMedia } from "../domicile/HeroMedia";
import { Npm } from "../domicile/Npm";
import { Platform } from "../domicile/Platform";
import { Quickstart } from "../domicile/Quickstart";
import { ReferenceShell } from "../domicile/ReferenceShell";
import { Accent } from "../page/Accent";
import { LinkColumns } from "../page/LinkColumns";
import { REPO, repoFile } from "../page/repo";
import { Section } from "../page/Section";
import { SiteFooter } from "../page/SiteFooter";
import { SiteHeader } from "../page/SiteHeader";

/** domicile-desktop.com: Domicile, for shell authors. */
const DomicilePage = () => (
  <Accent product="domicile">
    <SiteHeader
      action={{ href: "#quickstart", label: "Quickstart" }}
      brand={<DomicileMark />}
      links={[
        { href: "#docs", label: "Docs" },
        {
          href: repoFile("packages/chrome-sdk/README.md"),
          label: "SDK reference",
        },
        { href: "/manganese", label: "Manganese" },
        { href: REPO, label: "GitHub" },
      ]}
    />
    <main>
      <Hero />
      <HeroMedia />
      <CssStrip />
      <Platform />
      <Quickstart />
      <Cli />
      <Npm />
      <ReferenceShell />
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
