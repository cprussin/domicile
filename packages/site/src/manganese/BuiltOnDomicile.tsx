import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Accent } from "../page/Accent";
import { Eyebrow } from "../page/Eyebrow";
import { LinkButton } from "../page/LinkButton";
import { Section } from "../page/Section";

/** Points manganese's users at Domicile, in Domicile's color. */
export const BuiltOnDomicile = () => (
  <Section>
    <Accent product="domicile">
      <div className={bandStyles}>
        <div className={textStyles}>
          <Eyebrow>Built on Domicile</Eyebrow>
          <h2 className={titleStyles}>
            Every pixel is a web page you can change.
          </h2>
          <p className={bodyStyles}>
            Manganese is HTML and CSS running on Domicile, and every part of it
            is a package. Write your own bar item, swap out the launcher, or
            build a whole new desktop.
          </p>
        </div>
        <LinkButton href="/" size="lg">
          Build on Domicile →
        </LinkButton>
      </div>
    </Accent>
  </Section>
);

const bandStyles = flex({
  align: "center",
  backgroundColor:
    "color-mix(in oklab, {colors.accent} 6%, {colors.background})",
  border: "1px solid color-mix(in oklab, {colors.accent} 30%, {colors.border})",
  borderRadius: "3xl",
  gap: 6,
  justify: "space-between",
  padding: 10,
  wrap: "wrap",
});

const textStyles = flex({ direction: "column", flex: "1 1 26.25rem", gap: 3 });

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "2xl", md: "4xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
});

const bodyStyles = css({ color: "muted" });
