import { Button } from "@domicile-desktop/component-library/Button";
import { Field } from "@domicile-desktop/component-library/Field";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { Input } from "@domicile-desktop/component-library/Input";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  RefCallback,
} from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { css, cx } from "../styled-system/css";
import type { Day, Hsv, Time } from "./picker-values";
import {
  addDays,
  calendarOf,
  compareDays,
  formatDate,
  formatDateTime,
  formatMonth,
  formatTime,
  formatWeek,
  hexToHsv,
  hsvToHex,
  isWithin,
  parseDate,
  parseDateTime,
  parseHex,
  parseMonth,
  parseTime,
  parseWeek,
  weekOf,
} from "./picker-values";
import type { PickerRequest } from "./usePickerRequest";

type Props = {
  /** Gets the element to focus as the picker opens. */
  ref?: RefCallback<HTMLElement> | undefined;
  request: PickerRequest;
  /** Today, for the calendar; a test passes a fixed one. */
  today?: Day | undefined;
};

/** How far below its control the picker hangs, in CSS pixels. */
export const GAP = 4;

/**
 * Draws the picker a form control in the page opened, hung from the
 * control: a color, a calendar, months, times, or a `<datalist>`'s options.
 *
 * Escape or a press outside it keeps the old value. Takes no focus itself:
 * the caller focuses `ref`'s element as its own focus rules allow.
 */
export const PickerAsk = ({ ref, request, today = todayHere() }: Props) => {
  const card = useRef<HTMLDivElement>(null);
  const { anchor } = request;
  const [place, setPlace] = useState({
    left: anchor.x,
    top: anchor.y + anchor.height + GAP,
  });

  // Below the control, or above it when the page has no room below; kept
  // inside the page across.
  useLayoutEffect(() => {
    const box = card.current;
    const page = box?.parentElement;
    // A page not laid out yet, as in a test, keeps the first place.
    if (
      box !== null &&
      page !== null &&
      page !== undefined &&
      page.clientWidth > 0
    ) {
      const below = anchor.y + anchor.height + GAP;
      const above = anchor.y - GAP - box.offsetHeight;
      setPlace({
        left: Math.max(
          0,
          Math.min(anchor.x, page.clientWidth - box.offsetWidth),
        ),
        top:
          below + box.offsetHeight > page.clientHeight && above >= 0
            ? above
            : below,
      });
    }
  }, [anchor.height, anchor.x, anchor.y]);

  return (
    <div
      className={layerStyles}
      onPointerDown={(event: PointerEvent) => {
        if (event.target === event.currentTarget) {
          request.cancel();
        }
      }}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape keeps the old value wherever focus is in it, as PageModal's does */}
      <div
        aria-label={LABELS[request.kind]}
        className={cardStyles}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault();
            request.cancel();
          }
        }}
        ref={card}
        role="dialog"
        style={{ insetBlockStart: place.top, insetInlineStart: place.left }}
      >
        {bodyFor(request, ref, today)}
      </div>
    </div>
  );
};

const LABELS: Record<PickerRequest["kind"], string> = {
  color: "Pick a color",
  date: "Pick a date",
  "datetime-local": "Pick a date and time",
  list: "Suggestions",
  month: "Pick a month",
  time: "Pick a time",
  week: "Pick a week",
};

const todayHere = (): Day => {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
};

const bodyFor = (
  request: PickerRequest,
  ref: Props["ref"],
  today: Day,
): ReactNode => {
  switch (request.kind) {
    case "color": {
      return <ColorPicker focus={ref} request={request} />;
    }
    case "date":
    case "week":
    case "datetime-local": {
      return <CalendarPicker focus={ref} request={request} today={today} />;
    }
    case "month": {
      return <MonthPicker focus={ref} request={request} today={today} />;
    }
    case "time": {
      return <TimePicker focus={ref} request={request} />;
    }
    case "list": {
      return <ListPicker focus={ref} request={request} />;
    }
  }
};

type PartProps = {
  focus: Props["ref"];
  request: PickerRequest;
};

/** Cancel and the answer, as a `PageModal`'s footer. */
const Footer = ({
  children,
  onCancel,
}: {
  children?: ReactNode;
  onCancel: () => void;
}) => (
  <footer className={footerStyles}>
    <Button onClick={onCancel} size="sm" variant="outline">
      Cancel
    </Button>
    {children}
  </footer>
);

// ---- Color --------------------------------------------------------------

const ColorPicker = ({ focus, request }: PartProps) => {
  const [hsv, setHsv] = useState<Hsv>(() =>
    hexToHsv(parseHex(request.value) ?? "#000000"),
  );
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const hex = hsvToHex(hsv);
  const done = () => {
    request.choose(parseHex(typed ?? hex) ?? hex);
  };

  // Saturation across, brightness up, from where the pointer is.
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const across = (event.clientX - box.left) / Math.max(1, box.width);
    const down = (event.clientY - box.top) / Math.max(1, box.height);
    setTyped(undefined);
    setHsv({
      hue: hsv.hue,
      saturation: clamp(across),
      value: clamp(1 - down),
    });
  };

  return (
    <form
      className={columnStyles}
      onSubmit={(event) => {
        event.preventDefault();
        done();
      }}
    >
      <div
        aria-label="Saturation and brightness"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(hsv.saturation * 100)}
        aria-valuetext={hex}
        className={fieldStyles}
        onKeyDown={(event: KeyboardEvent) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          const moves: Record<string, [number, number]> = {
            ArrowDown: [0, -step],
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
          };
          const move = moves[event.key];
          if (move !== undefined) {
            event.preventDefault();
            setTyped(undefined);
            setHsv({
              hue: hsv.hue,
              saturation: clamp(hsv.saturation + move[0]),
              value: clamp(hsv.value + move[1]),
            });
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            pick(event);
          }
        }}
        ref={focus}
        role="slider"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.hue} 100% 50%))`,
        }}
        tabIndex={0}
      >
        <span
          className={thumbStyles}
          style={{
            backgroundColor: hex,
            insetBlockStart: `${(1 - hsv.value) * 100}%`,
            insetInlineStart: `${hsv.saturation * 100}%`,
          }}
        />
      </div>
      <input
        aria-label="Hue"
        className={hueStyles}
        max={359}
        min={0}
        onChange={(event) => {
          setTyped(undefined);
          setHsv({ ...hsv, hue: Number(event.target.value) });
        }}
        type="range"
        value={Math.round(hsv.hue)}
      />
      {request.options.length > 0 && (
        <div className={swatchesStyles}>
          {request.options.map((option) => (
            <button
              aria-label={option.label === "" ? option.value : option.label}
              className={swatchStyles}
              key={option.value}
              onClick={() => {
                request.choose(parseHex(option.value) ?? option.value);
              }}
              style={{ backgroundColor: option.value }}
              type="button"
            />
          ))}
        </div>
      )}
      <div className={hexRowStyles}>
        <span
          aria-hidden
          className={swatchStyles}
          style={{ backgroundColor: parseHex(typed ?? hex) ?? hex }}
        />
        <Field label="Hex">
          <Input
            onChange={(event) => {
              const value = event.target.value;
              setTyped(value);
              const parsed = parseHex(value);
              if (parsed !== undefined) {
                setHsv(hexToHsv(parsed));
              }
            }}
            size="sm"
            spellCheck={false}
            value={typed ?? hex}
          />
        </Field>
      </div>
      <Footer onCancel={request.cancel}>
        <Button size="sm" type="submit" variant="accent">
          Done
        </Button>
      </Footer>
    </form>
  );
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

// ---- Calendar -----------------------------------------------------------

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const monthName = (year: number, month: number, style: "long" | "short") =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: style,
    timeZone: "UTC",
  });

/** The day a date-like value names, for each kind with days. */
const dayOf = (request: PickerRequest, value: string): Day | undefined => {
  switch (request.kind) {
    case "week": {
      return parseWeek(value);
    }
    case "datetime-local": {
      return parseDateTime(value)?.day ?? parseDate(value.split("T")[0] ?? "");
    }
    default: {
      return parseDate(value);
    }
  }
};

const CalendarPicker = ({
  focus,
  request,
  today,
}: PartProps & { today: Day }) => {
  const picked = dayOf(request, request.value);
  const min = dayOf(request, request.min);
  const max = dayOf(request, request.max);
  const [cursor, setCursor] = useState<Day>(picked ?? today);
  const [chosen, setChosen] = useState<Day | undefined>(picked);
  const [time, setTime] = useState<Time>(
    parseDateTime(request.value)?.time ?? { hour: 12, minute: 0 },
  );
  const withTime = request.kind === "datetime-local";
  const weeks = request.kind === "week";

  const choose = (day: Day) => {
    if (!isWithin(day, min, max)) {
      return;
    } else if (withTime) {
      setChosen(day);
      setCursor(day);
    } else {
      request.choose(weeks ? formatWeek(day) : formatDate(day));
    }
  };

  const moveMonth = (by: number) => {
    const first = { day: 1, month: cursor.month, year: cursor.year };
    const target = addDays(first, by > 0 ? 31 : -1);
    setCursor({
      day: Math.min(cursor.day, 28),
      month: target.month,
      year: target.year,
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowDown: 7,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      moved.current = true;
      setCursor(addDays(cursor, move));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(cursor);
    }
  };

  // Focus follows the cursor once the keys or the arrows move it, as in a
  // grid. The caller places the first focus.
  const cursorCell = useRef<HTMLButtonElement | null>(null);
  const moved = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the cursor moves, which the focused cell follows
  useLayoutEffect(() => {
    if (moved.current) {
      cursorCell.current?.focus({ preventScroll: true });
    }
  }, [cursor]);

  return (
    <div className={columnStyles}>
      <header className={monthHeaderStyles}>
        <IconButton
          label="Previous month"
          onClick={() => {
            moveMonth(-1);
          }}
          size="sm"
        >
          <CaretLeftIcon aria-hidden size={12} weight="bold" />
        </IconButton>
        <h2 aria-live="polite" className={monthTitleStyles}>
          {monthName(cursor.year, cursor.month, "long")} {cursor.year}
        </h2>
        <IconButton
          label="Next month"
          onClick={() => {
            moveMonth(1);
          }}
          size="sm"
        >
          <CaretRightIcon aria-hidden size={12} weight="bold" />
        </IconButton>
      </header>
      <table className={gridStyles}>
        <thead>
          <tr>
            {weeks && <th className={weekdayStyles}>Wk</th>}
            {WEEKDAYS.map((weekday) => (
              <th className={weekdayStyles} key={weekday}>
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarOf(cursor.year, cursor.month).map((week) => {
            const monday = week[1] ?? week[0];
            const chosenWeek =
              weeks &&
              chosen !== undefined &&
              monday !== undefined &&
              formatWeek(monday) === formatWeek(chosen);
            return (
              <tr
                className={chosenWeek ? chosenWeekStyles : undefined}
                key={formatDate(week[0] as Day)}
              >
                {weeks && monday !== undefined && (
                  <td className={weekNumberStyles}>{weekOf(monday).week}</td>
                )}
                {week.map((day) => {
                  const atCursor = compareDays(day, cursor) === 0;
                  const isChosen =
                    !weeks &&
                    chosen !== undefined &&
                    compareDays(day, chosen) === 0;
                  return (
                    <td key={formatDate(day)}>
                      <button
                        aria-current={
                          compareDays(day, today) === 0 ? "date" : undefined
                        }
                        aria-label={`${monthName(day.year, day.month, "long")} ${day.day}, ${day.year}`}
                        aria-pressed={isChosen}
                        className={dayStyles}
                        data-chosen={isChosen ? "" : undefined}
                        data-outside={
                          day.month === cursor.month ? undefined : ""
                        }
                        disabled={!isWithin(day, min, max)}
                        onClick={() => {
                          setCursor(day);
                          choose(day);
                        }}
                        onKeyDown={onKeyDown}
                        ref={(cell) => {
                          if (atCursor && cell !== null) {
                            cursorCell.current = cell;
                            focus?.(cell);
                          }
                        }}
                        tabIndex={atCursor ? 0 : -1}
                        type="button"
                      >
                        {day.day}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {withTime ? (
        <>
          <TimeColumns onChange={setTime} step={request.step} time={time} />
          <Footer onCancel={request.cancel}>
            <Button
              disabled={chosen === undefined}
              onClick={() => {
                if (chosen !== undefined) {
                  request.choose(formatDateTime(chosen, time));
                }
              }}
              size="sm"
              variant="accent"
            >
              Done
            </Button>
          </Footer>
        </>
      ) : (
        <Footer onCancel={request.cancel}>
          <Button
            disabled={!isWithin(today, min, max)}
            onClick={() => {
              choose(today);
            }}
            size="sm"
            variant="outline"
          >
            {weeks ? "This week" : "Today"}
          </Button>
        </Footer>
      )}
    </div>
  );
};

// ---- Month --------------------------------------------------------------

const MonthPicker = ({ focus, request, today }: PartProps & { today: Day }) => {
  const picked = parseMonth(request.value);
  const min = parseMonth(request.min);
  const max = parseMonth(request.max);
  const [year, setYear] = useState((picked ?? today).year);
  return (
    <div className={columnStyles}>
      <header className={monthHeaderStyles}>
        <IconButton
          label="Previous year"
          onClick={() => {
            setYear(year - 1);
          }}
          size="sm"
        >
          <CaretLeftIcon aria-hidden size={12} weight="bold" />
        </IconButton>
        <h2 aria-live="polite" className={monthTitleStyles}>
          {year}
        </h2>
        <IconButton
          label="Next year"
          onClick={() => {
            setYear(year + 1);
          }}
          size="sm"
        >
          <CaretRightIcon aria-hidden size={12} weight="bold" />
        </IconButton>
      </header>
      <div className={monthsStyles}>
        {Array.from({ length: 12 }, (_, index) => {
          const month = { day: 1, month: index + 1, year };
          const isChosen =
            picked !== undefined && compareDays(month, picked) === 0;
          const atStart =
            isChosen ||
            (picked === undefined &&
              index + 1 === today.month &&
              year === today.year);
          return (
            <button
              aria-pressed={isChosen}
              className={dayStyles}
              data-chosen={isChosen ? "" : undefined}
              disabled={!isWithin(month, min, max)}
              key={index}
              onClick={() => {
                request.choose(formatMonth(month));
              }}
              ref={atStart ? focus : undefined}
              type="button"
            >
              {monthName(year, index + 1, "short")}
            </button>
          );
        })}
      </div>
      <Footer onCancel={request.cancel} />
    </div>
  );
};

// ---- Time ---------------------------------------------------------------

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The minutes a `step` in seconds allows, every minute when unset. */
const minutesFor = (step: string): number[] => {
  const seconds = Number(step);
  const every =
    Number.isFinite(seconds) && seconds >= 60 && seconds % 60 === 0
      ? Math.min(60, seconds / 60)
      : 1;
  return Array.from(
    { length: Math.ceil(60 / every) },
    (_, index) => index * every,
  );
};

const TimeColumns = ({
  focus,
  onChange,
  step,
  time,
}: {
  focus?: Props["ref"];
  onChange: (time: Time) => void;
  step: string;
  time: Time;
}) => (
  <div className={timeStyles}>
    <TimeColumn
      focus={focus}
      label="Hour"
      onPick={(hour) => {
        onChange({ ...time, hour });
      }}
      value={time.hour}
      values={HOURS}
    />
    <TimeColumn
      label="Minute"
      onPick={(minute) => {
        onChange({ ...time, minute });
      }}
      value={time.minute}
      values={minutesFor(step)}
    />
  </div>
);

const TimeColumn = ({
  focus,
  label,
  onPick,
  value,
  values,
}: {
  focus?: Props["ref"] | undefined;
  label: string;
  onPick: (value: number) => void;
  value: number;
  values: number[];
}) => (
  <div aria-label={label} className={timeColumnStyles} role="listbox">
    {values.map((entry) => (
      <button
        aria-selected={entry === value}
        className={dayStyles}
        data-chosen={entry === value ? "" : undefined}
        key={entry}
        onClick={() => {
          onPick(entry);
        }}
        ref={(cell) => {
          if (entry === value && cell !== null) {
            cell.scrollIntoView?.({ block: "center" });
            focus?.(cell);
          }
        }}
        role="option"
        type="button"
      >
        {String(entry).padStart(2, "0")}
      </button>
    ))}
  </div>
);

const TimePicker = ({ focus, request }: PartProps) => {
  const [time, setTime] = useState<Time>(
    parseTime(request.value) ?? { hour: 12, minute: 0 },
  );
  return (
    <div className={columnStyles}>
      <TimeColumns
        focus={focus}
        onChange={setTime}
        step={request.step}
        time={time}
      />
      <Footer onCancel={request.cancel}>
        <Button
          onClick={() => {
            request.choose(formatTime(time));
          }}
          size="sm"
          variant="accent"
        >
          Done
        </Button>
      </Footer>
    </div>
  );
};

// ---- List ---------------------------------------------------------------

/**
 * The options that hold what was typed, or all of them when none do, as
 * Chrome narrows a `<datalist>`.
 */
export const matchingOptions = (request: PickerRequest) => {
  const typed = request.value.trim().toLowerCase();
  const matching = request.options.filter(
    (option) =>
      option.value.toLowerCase().includes(typed) ||
      option.label.toLowerCase().includes(typed),
  );
  return matching.length > 0 ? matching : request.options;
};

const ListPicker = ({ focus, request }: PartProps) => {
  const options = matchingOptions(request);
  return (
    <div aria-label="Suggestions" className={listStyles} role="listbox">
      {options.map((option, index) => (
        <button
          aria-selected={false}
          className={optionStyles}
          key={option.value}
          onClick={() => {
            request.choose(option.value);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            const siblings: Record<string, Element | null> = {
              ArrowDown: event.currentTarget.nextElementSibling,
              ArrowUp: event.currentTarget.previousElementSibling,
            };
            const sibling = siblings[event.key];
            if (sibling instanceof HTMLElement) {
              event.preventDefault();
              sibling.focus();
            }
          }}
          ref={index === 0 ? focus : undefined}
          role="option"
          type="button"
        >
          <span>{option.value}</span>
          {option.label !== "" && (
            <span className={optionLabelStyles}>{option.label}</span>
          )}
        </button>
      ))}
    </div>
  );
};

// ---- Styles -------------------------------------------------------------

// Over the whole page, so a press outside the picker reaches it.
const layerStyles = css({ inset: 0, position: "absolute" });

// As the library's `Popover`.
const cardStyles = css({
  _starting: { opacity: 0, transform: "translateY({spacing.1})" },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  color: "foreground",
  fontSize: "sm",
  maxInlineSize: "calc(100% - {spacing.2})",
  opacity: 1,
  outlineStyle: "none",
  padding: 3,
  position: "absolute",
  transform: "translateY(0)",
  transition:
    "opacity {durations.fast} {easings.out}, transform {durations.fast} {easings.out}",
});

const columnStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 3,
});

const footerStyles = css({
  display: "flex",
  flexDirection: "row-reverse",
  gap: 2,
  justifyContent: "flex-start",
});

const fieldStyles = css({
  _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: 2 },
  aspectRatio: "4 / 3",
  borderRadius: "sm",
  cursor: "crosshair",
  inlineSize: 56,
  position: "relative",
  touchAction: "none",
});

const thumbStyles = css({
  blockSize: 3.5,
  border: "2px solid white",
  borderRadius: "full",
  boxShadow: "0 0 0 1px rgb(0 0 0 / 0.4)",
  inlineSize: 3.5,
  pointerEvents: "none",
  position: "absolute",
  transform: "translate(-50%, -50%)",
});

const hueStyles = css({
  accentColor: "{colors.accent}",
  appearance: "none",
  background:
    "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
  blockSize: 2.5,
  borderRadius: "full",
  inlineSize: "100%",
});

const swatchesStyles = css({
  display: "grid",
  gap: 1.5,
  gridTemplateColumns: "repeat(8, 1fr)",
});

const swatchStyles = css({
  aspectRatio: "1",
  border: "1px solid {colors.border}",
  borderRadius: "sm",
  cursor: "pointer",
  flexShrink: 0,
  inlineSize: 6,
});

const hexRowStyles = css({
  alignItems: "flex-end",
  display: "flex",
  gap: 2,
});

const monthHeaderStyles = css({
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
});

const monthTitleStyles = css({
  fontSize: "sm",
  fontWeight: "semibold",
  margin: 0,
});

const gridStyles = css({
  borderCollapse: "collapse",
  fontVariantNumeric: "tabular-nums",
});

const weekdayStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "normal",
  paddingBlockEnd: 1,
});

const weekNumberStyles = css({
  color: "muted",
  fontSize: "xs",
  paddingInlineEnd: 1,
  textAlign: "center",
});

const chosenWeekStyles = css({
  "& button": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 16%, transparent)",
  },
});

const dayStyles = cx(
  css({
    _disabled: { cursor: "default", opacity: 0.35 },
    _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: -2 },
    _hover: {
      backgroundColor:
        "color-mix(in oklab, {colors.foreground} 8%, transparent)",
    },
    "&[aria-current=date]": { fontWeight: "semibold" },
    "&[data-chosen]": {
      backgroundColor: "accent",
      color: "background",
    },
    "&[data-outside]": { color: "muted" },
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "sm",
    color: "foreground",
    cursor: "pointer",
    fontSize: "sm",
    minBlockSize: 8,
    minInlineSize: 8,
    paddingInline: 1,
  }),
);

const monthsStyles = css({
  display: "grid",
  gap: 1,
  gridTemplateColumns: "repeat(3, 1fr)",
});

const timeStyles = css({
  display: "flex",
  gap: 2,
  justifyContent: "center",
});

const timeColumnStyles = css({
  display: "flex",
  flexDirection: "column",
  maxBlockSize: 48,
  overflowY: "auto",
  paddingInline: 1,
});

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  marginBlock: -1,
  marginInline: -2,
  maxBlockSize: 72,
  minInlineSize: 48,
  overflowY: "auto",
});

const optionStyles = css({
  _focusVisible: {
    backgroundColor: "color-mix(in oklab, {colors.accent} 16%, transparent)",
    outline: "none",
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  },
  alignItems: "baseline",
  backgroundColor: "transparent",
  border: "none",
  borderRadius: "sm",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  fontSize: "sm",
  gap: 2,
  justifyContent: "space-between",
  paddingBlock: 1.5,
  paddingInline: 2,
  textAlign: "start",
});

const optionLabelStyles = css({ color: "muted", fontSize: "xs" });
