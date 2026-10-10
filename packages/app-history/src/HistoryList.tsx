import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import type { KeyboardEvent } from "react";
import { useId } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { dayLabel } from "./day";
import type { Day } from "./entries";
import { HistoryRow } from "./HistoryRow";
import type { Entry } from "./history-page";

type Props = {
  days: readonly Day[];
  faviconUrl: (pageUrl: string) => string;
  leaving: ReadonlySet<string>;
  /** The row whose menu is open. */
  menuFor: string | undefined;
  now: number;
  onLeft: (id: string) => void;
  onMenu: (entry: Entry, at: Point) => void;
  onOpenInNewWindow: (entry: Entry) => void;
  onToggle: (id: string, shift: boolean) => void;
  search: string;
  selected: ReadonlySet<string>;
};

/**
 * The rows under sticky day headers.
 *
 * Up and Down (or K and J) move between rows, Home and End to the ends, and
 * Space checks the row with focus.
 */
export const HistoryList = ({ days, now, ...rowProps }: Props) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions lint/a11y/noStaticElementInteractions: the keys move focus between the rows' links, which handle everything else
  <div
    className={listStyles}
    onKeyDown={(event) => {
      handleKey(event, rowProps.onToggle);
    }}
  >
    {days.map((day) => (
      <DaySection day={day} key={day.day} now={now} {...rowProps} />
    ))}
  </div>
);

type DaySectionProps = Omit<Props, "days"> & { day: Day };

const DaySection = ({
  day,
  faviconUrl,
  leaving,
  menuFor,
  now,
  search,
  selected,
  ...handlers
}: DaySectionProps) => {
  const headingId = useId();
  const { date, relative } = dayLabel(day.day, now);
  return (
    <section aria-labelledby={headingId} className={sectionStyles}>
      <header className={headerStyles}>
        <h2 className={headingStyles} id={headingId}>
          {relative !== undefined && (
            <>
              <span className={relativeStyles}>{relative}</span>
              <span className={separatorStyles}> - </span>
            </>
          )}
          <span>{date}</span>
        </h2>
        <span aria-hidden className={countStyles}>
          {day.entries.length}
        </span>
      </header>
      <ul className={cardStyles}>
        {day.entries.map((entry, index) => (
          <HistoryRow
            entry={entry}
            faviconUrl={faviconUrl(entry.url)}
            index={index}
            key={entry.id}
            leaving={leaving.has(entry.id)}
            menuOpen={menuFor === entry.id}
            search={search}
            selected={selected.has(entry.id)}
            {...handlers}
          />
        ))}
      </ul>
    </section>
  );
};

const listStyles = flex({
  direction: "column",
  gap: 6,
});

const sectionStyles = css({
  animation: "rise {durations.slower} {easings.outQuart} backwards",
});

// A frosted pill that sticks over the rows as they pass under it.
const headerStyles = hstack({
  backdropFilter: "blur({spacing.3}) saturate(160%)",
  backgroundColor: "color-mix(in oklab, {colors.card} 88%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 9%, transparent)",
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  gap: 3,
  inlineSize: "fit-content",
  insetBlockStart: 3,
  marginBlockEnd: 3,
  marginInlineStart: 2,
  paddingBlock: 1.5,
  paddingInlineEnd: 1.5,
  paddingInlineStart: 4,
  position: "sticky",
  zIndex: 1,
});

const headingStyles = css({
  color: "muted",
  fontSize: "sm",
  fontWeight: "medium",
  letterSpacing: "tight",
  margin: 0,
});

const relativeStyles = css({
  color: "foreground",
  fontWeight: "semibold",
});

const separatorStyles = css({
  color: "color-mix(in oklab, {colors.foreground} 30%, {colors.background})",
});

const countStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 7%, transparent)",
  borderRadius: "full",
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "medium",
  paddingBlock: 0.5,
  paddingInline: 2,
});

const cardStyles = css({
  _light: {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 82%, transparent)",
  },
  backgroundColor: "color-mix(in oklab, {colors.card} 70%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "2xl",
  boxShadow:
    "0 1px 0 color-mix(in oklab, {colors.foreground} 5%, transparent) inset, {shadows.lifted}",
  display: "flex",
  flexDirection: "column",
  listStyle: "none",
  margin: 0,
  padding: 1.5,
});

/** Moves focus between row links, or checks the row with focus. */
const handleKey = (
  event: KeyboardEvent<HTMLElement>,
  onToggle: (id: string, shift: boolean) => void,
) => {
  const links = [
    ...event.currentTarget.querySelectorAll<HTMLAnchorElement>(
      "li:not([data-leaving]) [data-row-link]",
    ),
  ];
  const targets: readonly EventTarget[] = links;
  const index = targets.indexOf(event.target);
  if (index !== -1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const step = keyTarget(event.key, links, index);
    if (step !== undefined) {
      event.preventDefault();
      step.focus();
      step.scrollIntoView({ block: "nearest" });
    } else if (event.key === " ") {
      event.preventDefault();
      onToggle(rowId(links[index]), event.shiftKey);
    }
  }
};

/** The link `key` moves to from `links[index]`, if it is a moving key. */
const keyTarget = (
  key: string,
  links: HTMLAnchorElement[],
  index: number,
): HTMLAnchorElement | undefined => {
  switch (key) {
    case "ArrowDown":
    case "j":
      return links[Math.min(index + 1, links.length - 1)];
    case "ArrowUp":
    case "k":
      return links[Math.max(index - 1, 0)];
    case "Home":
      return links[0];
    case "End":
      return links.at(-1);
    default:
      return undefined;
  }
};

/** The id of the row `link` is in. */
const rowId = (link: HTMLAnchorElement | undefined): string => {
  const id = link?.closest<HTMLElement>("[data-entry-id]")?.dataset.entryId;
  if (id === undefined) {
    throw new Error("a row link outside a row");
  } else {
    return id;
  }
};
