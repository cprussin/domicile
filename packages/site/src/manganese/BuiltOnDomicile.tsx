import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Accent } from "../page/Accent";
import { LinkButton } from "../page/LinkButton";
import { Section } from "../page/Section";

/** Manganese as one desktop on Domicile, in Domicile's color. */
export const BuiltOnDomicile = () => (
  <Section>
    <Accent product="domicile">
      <div className={bandStyles}>
        <div className={textStyles}>
          <h2 className={titleStyles}>One desktop of many.</h2>
          <p className={bodyStyles}>
            Manganese is HTML and CSS running on Domicile, on the same public
            API any desktop gets. Its bar, launcher, notifications and lock
            screen are npm packages: reuse them, replace them, or build a
            desktop that looks nothing like this one.
          </p>
        </div>
        <LinkButton href="/#possible" size="lg">
          See what else is possible →
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
