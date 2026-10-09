import { Accordion } from "@domicile-desktop/component-library/Accordion";
import { Button } from "@domicile-desktop/component-library/Button";
import { Field } from "@domicile-desktop/component-library/Field";
import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";
import { Select } from "@domicile-desktop/component-library/Select";
import { Switch } from "@domicile-desktop/component-library/Switch";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { CookieIcon } from "@phosphor-icons/react/dist/ssr/Cookie";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { ImagesIcon } from "@phosphor-icons/react/dist/ssr/Images";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { TextboxIcon } from "@phosphor-icons/react/dist/ssr/Textbox";
import type { ReactNode } from "react";
import { useState } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import type { Browser } from "./browser";
import { DataKind, dataToRemove, since, TimeRange } from "./clear-data";

const TIME_RANGES = [
  { label: "Last hour", value: TimeRange.LastHour },
  { label: "Last 24 hours", value: TimeRange.LastDay },
  { label: "Last 7 days", value: TimeRange.LastWeek },
  { label: "Last 4 weeks", value: TimeRange.LastFourWeeks },
  { label: "All time", value: TimeRange.AllTime },
] as const;

type Choice = {
  description: string;
  icon: ReactNode;
  kind: DataKind;
  label: string;
};

const BASIC: readonly Choice[] = [
  {
    description: "Pages you visited, and their entries in this list",
    icon: <ClockCounterClockwiseIcon />,
    kind: DataKind.History,
    label: "Browsing history",
  },
  {
    description: "Signs you out of most sites",
    icon: <CookieIcon />,
    kind: DataKind.Cookies,
    label: "Cookies and other site data",
  },
  {
    description: "Frees up space; some sites load slower on the next visit",
    icon: <ImagesIcon />,
    kind: DataKind.Cache,
    label: "Cached images and files",
  },
];

const ADVANCED: readonly Choice[] = [
  {
    description: "The list of files you downloaded, not the files",
    icon: <DownloadSimpleIcon />,
    kind: DataKind.Downloads,
    label: "Download history",
  },
  {
    description: "Addresses and other text saved for forms",
    icon: <TextboxIcon />,
    kind: DataKind.FormData,
    label: "Autofill form data",
  },
  {
    description: "Saved sign-ins for sites",
    icon: <KeyIcon />,
    kind: DataKind.Passwords,
    label: "Passwords",
  },
];

type Props = {
  now: () => number;
  /** After the data is gone; the dialog closes itself. */
  onCleared: () => void;
  onFailed: (error: unknown) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  removeBrowsingData: Browser["removeBrowsingData"];
};

/** Chrome's "Clear browsing data" dialog: what to clear, and how far back. */
export const ClearDataDialog = ({
  now,
  onCleared,
  onFailed,
  onOpenChange,
  open,
  removeBrowsingData,
}: Props) => {
  const [range, setRange] = useState(TimeRange.LastHour);
  const [kinds, setKinds] = useState<ReadonlySet<DataKind>>(
    new Set([DataKind.History, DataKind.Cookies, DataKind.Cache]),
  );
  const [clearing, setClearing] = useState(false);

  const clear = () => {
    setClearing(true);
    removeBrowsingData(since(range, now()), dataToRemove(kinds))
      .then(
        () => {
          onOpenChange(false);
          onCleared();
        },
        (error: unknown) => {
          onFailed(error);
        },
      )
      .finally(() => {
        setClearing(false);
      });
  };

  const choices = (list: readonly Choice[]) => (
    <ul className={choicesStyles}>
      {list.map((choice) => (
        <li className={choiceStyles} key={choice.kind}>
          <span aria-hidden className={choiceIconStyles}>
            {choice.icon}
          </span>
          <span className={choiceTextStyles}>
            <Switch
              checked={kinds.has(choice.kind)}
              label={choice.label}
              onCheckedChange={(checked) => {
                setKinds((current) =>
                  checked
                    ? current.union(new Set([choice.kind]))
                    : current.difference(new Set([choice.kind])),
                );
              }}
            />
            <span className={descriptionStyles}>{choice.description}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <ModalDialog
      footer={
        <>
          <ModalDialog.CloseButton variant="ghost">
            Cancel
          </ModalDialog.CloseButton>
          <Button
            disabled={kinds.size === 0}
            loading={clearing}
            onClick={clear}
            variant="accent"
          >
            Clear data
          </Button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="Clear browsing data"
    >
      <Field label="Time range">
        <Select
          onValueChange={(value) => {
            if (value !== null) {
              setRange(value);
            }
          }}
          options={TIME_RANGES}
          value={range}
        />
      </Field>
      {choices(BASIC)}
      <Accordion
        items={[
          { content: choices(ADVANCED), label: "Advanced", value: "advanced" },
        ]}
        size="sm"
      />
    </ModalDialog>
  );
};

const choicesStyles = flex({
  direction: "column",
  gap: 1,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const choiceStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  },
  alignItems: "flex-start",
  borderRadius: "lg",
  gap: 3,
  paddingBlock: 2,
  paddingInline: 2.5,
  transition: "background-color {durations.fast} {easings.out}",
});

const choiceIconStyles = css({
  alignItems: "center",
  backgroundColor: "color-mix(in oklab, {colors.accent} 14%, transparent)",
  blockSize: 8,
  borderRadius: "md",
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
  fontSize: "lg",
  inlineSize: 8,
  justifyContent: "center",
});

const choiceTextStyles = flex({
  direction: "column",
  flexGrow: 1,
  gap: 0.5,
  minInlineSize: 0,
});

const descriptionStyles = css({
  color: "muted",
  fontSize: "xs",
  paddingInlineStart: 11,
});
