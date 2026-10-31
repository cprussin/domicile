import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { LinkButton } from "../page/LinkButton";
import { Section } from "../page/Section";

/** Desktop apps written as JavaScript modules: the short pitch and a link. */
export const Apps = () => (
  <Section id="apps">
    <div className={bandStyles}>
      <div className={textStyles}>
        <h2 className={titleStyles}>Desktop apps, written like web pages.</h2>
        <p className={bodyStyles}>
          A Domicile app is a JavaScript module. It gets its own window and
          storage, plus your files, programs and D-Bus, with no Electron and no
          browser to ship. Domicile's own Settings and History apps are built
          this way.
        </p>
      </div>
      <LinkButton href="/docs/apps/build" variant="outline">
        Build an app
      </LinkButton>
    </div>
  </Section>
);

const bandStyles = flex({
  align: "center",
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  gap: 6,
  justify: "space-between",
  padding: { base: 6, md: 8 },
  wrap: "wrap",
});

const textStyles = flex({ direction: "column", flex: "1 1 24rem", gap: 2 });

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "2xl", md: "3xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
});

const bodyStyles = css({ color: "muted" });
