import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CopyCommand } from "../manganese/CopyCommand";
import { Backticked } from "../page/Backticked";
import { Section } from "../page/Section";

const POINTS: readonly { title: string; body: string }[] = [
  {
    body: "`domicile load-shell` serves your new build in place. Nothing you had open closes.",
    title: "Your windows stay open",
  },
  {
    body: "A build that fails prints the error and keeps your desktop running.",
    title: "Mistakes can't lock you out",
  },
  {
    body: "The whole API is TypeScript, so you and your agent catch mistakes before they run.",
    title: "Typed from end to end",
  },
];

/** Why changing a Domicile desktop is quick, by hand or with an agent. */
export const Iterate = () => (
  <Section id="iterate" title="Made for fast iteration.">
    <div className={pointsStyles}>
      {POINTS.map(({ title, body }) => (
        <div className={pointStyles} key={title}>
          <h3 className={titleStyles}>{title}</h3>
          <p className={bodyStyles}>
            <Backticked text={body} />
          </p>
        </div>
      ))}
    </div>
    <div className={agentStyles}>
      <p className={agentLabelStyles}>Using a coding agent? Start it with:</p>
      <CopyCommand
        command="Read https://domicile-desktop.com/llms.txt and help me make a Domicile desktop."
        kind="message"
      />
    </div>
  </Section>
);

const pointsStyles = grid({ gap: 6, minChildWidth: "16rem" });

const pointStyles = flex({ direction: "column", gap: 1 });

const titleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted" });

const agentStyles = flex({ direction: "column", gap: 2, marginBlockStart: 8 });

const agentLabelStyles = css({ fontWeight: "semibold" });
