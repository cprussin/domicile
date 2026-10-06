import type {
  AppChooserBody,
  PortalAnswer,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
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
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: AppChooserBody;
  screen: string | undefined;
  /** Where the applications' desktop entries are read. */
  system: System;
};

/**
 * Pick an application to open a file or URI with. The last choice, else the
 * type's default, starts picked. Dismissing it cancels.
 */
export const AppChooserDialog = ({
  answer,
  asker,
  body,
  screen,
  system,
}: Props) => {
  const listId = useId();
  const described = useDescribedChoices(system, body.choices, body.contentType);
  const [picked, setPicked] = useState<string | undefined>();
  const apps = described?.apps ?? [];
  const first =
    described === undefined
      ? undefined
      : preselected(body.choices, body.lastChoice, described.defaults);
  // A pick the application has since taken away no longer counts.
  const chosen =
    picked !== undefined && body.choices.includes(picked) ? picked : first;
  const at = apps.findIndex(({ id }) => id === chosen);
  const choose = (id: string | undefined) => {
    if (id !== undefined) {
      answer(Answer.AppChooser(id));
    }
  };
  return (
    <ModalDialog
      closeButton={false}
      footer={
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
          answer(Answer.Canceled());
        }
      }}
      open
      screen={screen}
      title={titleOf(body)}
    >
      <p className={askerStyles}>{`${asker} asks`}</p>
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

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

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

/** What the dialog opens, as its title names it. */
const titleOf = ({ filename, uri }: AppChooserBody): string => {
  const opened = filename ?? uri;
  return opened === undefined ? "Open with" : `Open ${opened} with`;
};

const optionId = (listId: string, index: number): string =>
  `${listId}-${String(index)}`;
