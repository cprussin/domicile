import type { Metadata } from "next";

import { BuiltOnDomicile } from "../../manganese/BuiltOnDomicile";
import { Configure } from "../../manganese/Configure";
import { DOCS } from "../../manganese/docs";
import { Hero } from "../../manganese/Hero";
import { Install } from "../../manganese/Install";
import { Keys } from "../../manganese/Keys";
import { ManganeseMark } from "../../manganese/ManganeseMark";
import { Tour } from "../../manganese/Tour";
import { Media } from "../../media/Media";
import { Accent } from "../../page/Accent";
import { LinkColumns } from "../../page/LinkColumns";
import { REPO, repoFile } from "../../page/repo";
import { Section } from "../../page/Section";
import { SiteFooter } from "../../page/SiteFooter";
import { SiteHeader } from "../../page/SiteHeader";

export const metadata: Metadata = {
  description:
    "A tiling Wayland desktop with Sway's layout and keys, built on Domicile.",
  title: "Manganese",
};

/** domicile-desktop.com/manganese: the reference shell, for its users. */
const ManganesePage = () => (
  <Accent product="manganese">
    <SiteHeader
      action={{ href: "#install", label: "Install" }}
      brand={<ManganeseMark />}
      links={[
        { href: "#tour", label: "Tour" },
        { href: "#keys", label: "Keys" },
        { href: "#configure", label: "Configure" },
        { href: "#docs", label: "Docs" },
        { href: REPO, label: "GitHub" },
      ]}
    />
    <main>
      <Hero />
      <Section>
        <Media
          alt="Manganese tiling a terminal and a browser, opening Settings from the launcher, then showing a notification"
          name="manganese-hero"
        />
      </Section>
      <Tour />
      <Keys />
      <Install />
      <Configure />
      <BuiltOnDomicile />
      <Section id="docs" title="Docs">
        <LinkColumns columns={DOCS} />
      </Section>
    </main>
    <SiteFooter
      links={[
        { href: REPO, label: "GitHub" },
        { href: repoFile("LICENSE"), label: "MIT license" },
      ]}
    >
      <span>
        Manganese is the reference shell for <a href="/">Domicile</a>.
      </span>
    </SiteFooter>
  </Accent>
);

export default ManganesePage;
