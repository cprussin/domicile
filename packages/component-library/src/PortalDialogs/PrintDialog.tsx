import type {
  PortalAnswer,
  PrintBody,
  Printer,
  PrintOptions,
} from "@domicile-desktop/sdk/portal";
import {
  PortalAnswer as Answer,
  ColorMode,
  Orientation,
  PrintQuality,
  Sides,
} from "@domicile-desktop/sdk/portal";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { grid } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import { Select } from "../Select/Select";
import { pageRanges } from "./page-ranges";

const SIDES = {
  [Sides.OneSided]: "One-sided",
  [Sides.TwoSidedLongEdge]: "Two-sided, long edge",
  [Sides.TwoSidedShortEdge]: "Two-sided, short edge",
} as const;

const COLOR_MODES = {
  [ColorMode.Color]: "Color",
  [ColorMode.Monochrome]: "Black and white",
} as const;

const ORIENTATIONS = {
  [Orientation.Portrait]: "Portrait",
  [Orientation.Landscape]: "Landscape",
  [Orientation.ReverseLandscape]: "Reverse landscape",
  [Orientation.ReversePortrait]: "Reverse portrait",
} as const;

const QUALITIES = {
  [PrintQuality.Draft]: "Draft",
  [PrintQuality.Normal]: "Normal",
  [PrintQuality.High]: "High",
} as const;

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: PrintBody;
  screen: string | undefined;
};

/**
 * A print dialog: a printer and the options it supports, or word that there
 * are no printers. Dismissing it cancels. No preview: the document arrives
 * only after it closes.
 */
export const PrintDialog = ({ answer, asker, body, screen }: Props) => {
  const [chosen, setChosen] = useState(() => startingPrinter(body));
  return (
    <ModalDialog
      closeButton={false}
      footer={
        chosen === undefined ? (
          <Button
            onClick={() => {
              answer(Answer.Canceled());
            }}
          >
            Close
          </Button>
        ) : (
          <PrinterFooter
            acceptLabel={body.acceptLabel ?? "Print"}
            answer={answer}
            chosen={chosen}
          />
        )
      }
      onOpenChange={(open) => {
        if (!open) {
          answer(Answer.Canceled());
        }
      }}
      open
      screen={screen}
      title="Print"
    >
      <p className={askerStyles}>{`${asker} prints “${body.title}”`}</p>
      {chosen === undefined ? (
        <p className={textStyles}>No printers are set up.</p>
      ) : (
        <Options
          chosen={chosen}
          onChange={setChosen}
          printers={body.printers}
        />
      )}
    </ModalDialog>
  );
};

/** A printer and the options as the user has set them so far. */
type Chosen = {
  /** As typed. */
  copies: string;
  /** As typed. */
  pages: string;
  options: PrintOptions;
  printer: Printer;
};

const PrinterFooter = ({
  acceptLabel,
  answer,
  chosen,
}: {
  acceptLabel: string;
  answer: (answer: PortalAnswer) => void;
  chosen: Chosen;
}) => {
  const options = readOptions(chosen);
  return (
    <>
      <Button
        onClick={() => {
          answer(Answer.Canceled());
        }}
        variant="outline"
      >
        Cancel
      </Button>
      <Button
        disabled={options === undefined}
        onClick={() => {
          if (options !== undefined) {
            answer(Answer.Print(chosen.printer.name, options));
          }
        }}
      >
        {acceptLabel}
      </Button>
    </>
  );
};

const Options = ({
  chosen,
  onChange,
  printers,
}: {
  chosen: Chosen;
  onChange: (chosen: Chosen) => void;
  printers: readonly Printer[];
}) => {
  const { options, printer } = chosen;
  const set = (changed: Partial<PrintOptions>) => {
    onChange({ ...chosen, options: { ...options, ...changed } });
  };
  return (
    <div className={optionsStyles}>
      <Select
        aria-label="Printer"
        onValueChange={(name) => {
          const picked = printers.find((listed) => listed.name === name);
          if (picked !== undefined) {
            onChange(startOf(picked));
          }
        }}
        options={printers.map((listed) => ({
          label: listed.description ?? listed.name,
          value: listed.name,
        }))}
        value={printer.name}
      />
      {printer.media.length > 0 && (
        <Select
          aria-label="Paper"
          onValueChange={(media) => {
            set({ media: media ?? undefined });
          }}
          options={printer.media.map((media) => ({
            label: media.label,
            value: media.name,
          }))}
          placeholder="Printer default"
          value={options.media ?? null}
        />
      )}
      <Input
        aria-label="Copies"
        max={printer.copiesMax}
        min={1}
        onChange={(event) => {
          onChange({ ...chosen, copies: event.target.value });
        }}
        type="number"
        value={chosen.copies}
      />
      {printer.pageRanges && (
        <Input
          aria-label="Pages"
          onChange={(event) => {
            onChange({ ...chosen, pages: event.target.value });
          }}
          placeholder="All, or 1-3, 5"
          value={chosen.pages}
        />
      )}
      <Choice
        label="Sides"
        labels={SIDES}
        offered={printer.sides}
        onChange={(sides) => {
          set({ sides });
        }}
        value={options.sides}
      />
      <Choice
        label="Color"
        labels={COLOR_MODES}
        offered={printer.colorModes}
        onChange={(colorMode) => {
          set({ colorMode });
        }}
        value={options.colorMode}
      />
      <Choice
        label="Orientation"
        labels={ORIENTATIONS}
        offered={printer.orientations}
        onChange={(orientation) => {
          set({ orientation });
        }}
        value={options.orientation}
      />
      <Choice
        label="Quality"
        labels={QUALITIES}
        offered={printer.qualities}
        onChange={(quality) => {
          set({ quality });
        }}
        value={options.quality}
      />
    </div>
  );
};

/** A select of the values a printer offers for one option; none if it offers none. */
const Choice = <V extends number>({
  label,
  labels,
  offered,
  onChange,
  value,
}: {
  label: string;
  labels: Readonly<Record<V, string>>;
  offered: readonly V[];
  onChange: (value: V | undefined) => void;
  value: V | undefined;
}) =>
  offered.length > 0 && (
    <Select
      aria-label={label}
      onValueChange={(picked) => {
        onChange(picked ?? undefined);
      }}
      options={offered.map((offer) => ({ label: labels[offer], value: offer }))}
      placeholder="Printer default"
      value={value ?? null}
    />
  );

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const textStyles = css({ color: "foreground", margin: 0 });

const optionsStyles = grid({ columns: 2, gap: 2, marginBlockStart: 3 });

/** The printer the dialog starts on, if there is any. */
const startingPrinter = (body: PrintBody): Chosen | undefined => {
  const printer =
    body.printers.find((listed) => listed.name === body.printer) ??
    body.printers[0];
  return printer === undefined ? undefined : startOf(printer);
};

/** `printer` with its initial options. */
const startOf = (printer: Printer): Chosen => ({
  copies: String(printer.initial.copies),
  options: printer.initial,
  pages: "",
  printer,
});

/** The options to print with, or `undefined` while copies or pages do not read. */
const readOptions = (chosen: Chosen): PrintOptions | undefined => {
  const copies = Number(chosen.copies);
  const pages = pageRanges(chosen.pages);
  const copiesRead =
    Number.isInteger(copies) &&
    copies >= 1 &&
    copies <= chosen.printer.copiesMax;
  return copiesRead && pages !== undefined
    ? { ...chosen.options, copies, pages }
    : undefined;
};
