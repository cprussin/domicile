import type { System } from "@domicile-desktop/sdk/system";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { useId, useState } from "react";
import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { keepInView, stepOf, steppedTo } from "../list-walk";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import { preselected } from "./app-choices";
import { useDescribedChoices } from "./useDescribedChoices";

const ICON_SIZE = 24;

type Props = {
  /** Desktop file IDs without `.desktop`, in the order offered. */
  choices: readonly string[];
  /** The type opened, whose defaults start picked; none when `undefined`. */
  contentType: string | undefined;
  /** A line under the title, such as who asks. */
  description?: string | undefined;
  /** The application chosen last time, which starts picked. */
  lastChoice?: string | undefined;
  onCancel: () => void;
  /** Called with the ID of the application to open with. */
  onChoose: (id: string) => void;
  screen: string | undefined;
  /** Where the applications' desktop entries are read. */
  system: System;
  title: string;
};

/**
 * Pick an application to open a file or URI with. The last choice, else the
 * type's default, else the first offered, starts picked. Dismissing it
 * cancels.
 */
export const AppChooser = ({
  choices,
  contentType,
  description,
  lastChoice,
  onCancel,
  onChoose,
  screen,
  system,
  title,
}: Props) => {
  const listId = useId();
  const described = useDescribedChoices(system, choices, contentType);
  const [picked, setPicked] = useState<string | undefined>();
  const apps = described?.apps ?? [];
  const first =
    described === undefined
      ? undefined
      : preselected(choices, lastChoice, described.defaults);
  // A pick the caller has since taken away no longer counts.
  const chosen =
    picked !== undefined && choices.includes(picked) ? picked : first;
  const at = apps.findIndex(({ id }) => id === chosen);
  const choose = (id: string | undefined) => {
    if (id !== undefined) {
      onChoose(id);
    }
  };
  return (
    <ModalDialog
      closeButton={false}
      footer={
        <>
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={chosen === undefined}
            onClick={() => {
              choose(chosen);
            }}
          >
            Open
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
      screen={screen}
      title={title}
    >
      {description !== undefined && (
        <p className={descriptionStyles}>{description}</p>
      )}
      <div
        aria-activedescendant={at === -1 ? undefined : optionId(listId, at)}
        aria-label="Applications"
        className={listStyles}
        onKeyDown={(event) => {
          const step = stepOf(event);
          const next = apps[steppedTo(at, step ?? 0, apps.length)];
          if (event.key === "Enter") {
            event.preventDefault();
            choose(chosen);
          } else if (step !== undefined && next !== undefined) {
            event.preventDefault();
            setPicked(next.id);
          }
        }}
        role="listbox"
        tabIndex={0}
      >
        {apps.map((app, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keyboard via `aria-activedescendant`
          <div
            aria-selected={app.id === chosen}
            className={optionStyles}
            id={optionId(listId, index)}
            key={app.id}
            onClick={() => {
              setPicked(app.id);
            }}
            onDoubleClick={() => {
              choose(app.id);
            }}
            ref={app.id === chosen ? keepInView : undefined}
            role="option"
            tabIndex={-1}
          >
            {app.icon === undefined ? (
              <AppWindowIcon size={ICON_SIZE} />
            ) : (
              <img
                alt=""
                className={iconStyles}
                height={ICON_SIZE}
                src={app.icon}
                width={ICON_SIZE}
              />
            )}
            <span className={nameStyles}>{app.name}</span>
          </div>
        ))}
      </div>
    </ModalDialog>
  );
};

const descriptionStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const listStyles = flex({
  direction: "column",
  gap: 0.5,
  marginBlockStart: 3,
  maxBlockSize: 80,
  overflowY: "auto",
});

// As the file picker's rows.
const optionStyles = hstack({
  "&[aria-selected=true]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  },
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  gap: 3,
  paddingBlock: 1.5,
  paddingInline: 2,
  transition: "background-color {durations.fast} {easings.out}",
  userSelect: "none",
});

const iconStyles = css({ flexShrink: 0, objectFit: "contain" });

const nameStyles = css({
  fontSize: "sm",
  fontWeight: "medium",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const optionId = (listId: string, index: number): string =>
  `${listId}-${String(index)}`;
