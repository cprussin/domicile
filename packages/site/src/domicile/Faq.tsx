import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Backticked } from "../page/Backticked";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

/** What people ask before they trust a desktop, each with where to read more. */
const QUESTIONS: readonly {
  question: string;
  answer: string;
  link: { href: string; label: string };
}[] = [
  {
    answer:
      "No. Only your shell and app modules get `domicile`. A page in a browser window is an ordinary website.",
    link: { href: "/docs/shells/system-access", label: "System access" },
    question: "Can websites use the desktop APIs?",
  },
  {
    answer:
      "Anything you can. It runs as you, with your files, programs and D-Bus. Install shells and apps you trust, as you would any program.",
    link: { href: "/docs/apps/build", label: "Build an app" },
    question: "What can a shell or an app do?",
  },
  {
    answer:
      "Your windows stay open. A reload starts the shell's page over, so state kept in the page is lost. If the engine or the compositor crashes, it restarts and your apps' windows survive.",
    link: {
      href: repoFile(
        "docs/architecture/THE-DOMICILE-BINARY.md#crashes-are-recovered",
      ),
      label: "Crash recovery",
    },
    question: "What happens if the shell crashes or reloads?",
  },
  {
    answer:
      "The engine is a patch series on a pinned Chromium release, built and tested in Domicile's CI.",
    link: {
      href: repoFile("docs/architecture/ENGINE-FORK.md"),
      label: "The engine fork",
    },
    question: "How is the Chromium fork kept up to date?",
  },
  {
    answer:
      "Wayland apps do, and Electron, SDL and Qt apps start in Wayland mode. There is no Xwayland, so X11-only apps don't run.",
    link: { href: repoFile("docs/KNOWN-GAPS.md"), label: "Known gaps" },
    question: "Will my apps work?",
  },
];

/** Short answers to what people ask first, each linking to the detail. */
export const Faq = () => (
  <Section id="faq" title="Questions">
    <div className={listStyles}>
      {QUESTIONS.map(({ question, answer, link }) => (
        <details className={itemStyles} key={question}>
          <summary className={questionStyles}>{question}</summary>
          <p className={answerStyles}>
            <Backticked text={answer} />{" "}
            <a className={linkStyles} href={link.href}>
              {link.label}
            </a>
          </p>
        </details>
      ))}
    </div>
  </Section>
);

const listStyles = flex({ direction: "column", gap: 2 });

const itemStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  paddingBlock: 4,
  paddingInline: 5,
});

const questionStyles = css({
  _focusVisible: {
    outline: "2px solid {colors.accent}",
    outlineOffset: "4px",
  },
  borderRadius: "sm",
  cursor: "pointer",
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const answerStyles = css({ color: "muted", marginBlockStart: 2 });

const linkStyles = css({ color: "foreground", textDecoration: "underline" });
