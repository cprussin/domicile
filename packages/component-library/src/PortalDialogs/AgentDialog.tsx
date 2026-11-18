import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import type {
  AgentBody,
  AgentWindow,
  PortalAnswer,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { CheckboxRow, ChoiceList, RadioRow } from "../ChoiceRow/ChoiceRow";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import { WindowIcon } from "./WindowIcon";

type Props = {
  answer: (answer: PortalAnswer) => void;
  apps: (appId: string) => App;
  body: AgentBody;
  screen: string | undefined;
};

/** What the user lets the agent reach. */
type Reach = "desk" | "windows";

/**
 * Whether an agent, such as Claude Code, may see and use the desk: all of
 * it, or only the windows the user checks, which none are at first. Allow
 * stays off until one is. Dismissing it denies.
 */
export const AgentDialog = ({ answer, apps, body, screen }: Props) => {
  const [reach, setReach] = useState<Reach>("desk");
  const [checked, setChecked] = useState<readonly string[]>([]);
  const picked = body.windows.filter((window) => checked.includes(window.id));
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
            disabled={reach === "windows" && picked.length === 0}
            onClick={() => {
              answer(
                Answer.Agent(
                  reach === "desk"
                    ? { kind: "desk" }
                    : { kind: "windows", windows: picked },
                ),
              );
            }}
          >
            Allow
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
      title={`Let ${body.agent} use your desktop?`}
    >
      <p className={textStyles}>
        It will see what you pick and click and type there. Stop it any time
        from the bar.
      </p>
      <div className={choicesStyles}>
        <ChoiceList<Reach>
          aria-label="What it can use"
          onValueChange={(value) => {
            setReach(value);
          }}
          value={reach}
        >
          <RadioRow
            detail="Every window, plus your pointer and keyboard."
            icon={<SquaresFourIcon aria-hidden />}
            name="Entire desktop"
            value="desk"
          />
          <RadioRow
            detail="Your pointer and keyboard stay yours."
            icon={<AppWindowIcon aria-hidden />}
            name="Only these windows"
            value="windows"
          />
        </ChoiceList>
      </div>
      {reach === "windows" && (
        <CheckboxGroup
          aria-label="Windows it can use"
          className={windowsStyles}
          onValueChange={(value) => {
            setChecked(value);
          }}
          value={[...checked]}
        >
          {body.windows.map((window) => (
            <CheckboxRow
              detail={kindOf(apps, window)}
              icon={<Icon apps={apps} window={window} />}
              key={window.id}
              name={window.title === "" ? "Untitled window" : window.title}
              value={window.id}
            />
          ))}
          <p className={noteStyles}>
            {body.windows.length === 0
              ? "No windows are open. Private windows are never shared."
              : "Private windows are never shared."}
          </p>
        </CheckboxGroup>
      )}
    </ModalDialog>
  );
};

/** A browser window's globe, or a native window's application icon. */
const Icon = ({
  apps,
  window,
}: {
  apps: (appId: string) => App;
  window: AgentWindow;
}) =>
  window.browser ? (
    <GlobeIcon aria-hidden />
  ) : (
    <WindowIcon app={window.app === undefined ? undefined : apps(window.app)} />
  );

/** What a window is, under its title: a browser, or its application. */
const kindOf = (apps: (appId: string) => App, window: AgentWindow): string => {
  if (window.browser) {
    return "Browser";
  } else {
    return window.app === undefined ? "Window" : apps(window.app).name;
  }
};

const textStyles = css({ color: "foreground", margin: 0 });

const choicesStyles = css({ marginBlockStart: 3 });

// Nested under "Only these windows", in line with its text.
const windowsStyles = flex({
  direction: "column",
  gap: 1,
  marginBlockStart: 1,
  marginInlineStart: 8,
});

const noteStyles = css({
  color: "muted",
  fontSize: "xs",
  margin: 0,
  paddingBlockStart: 1,
  paddingInline: 2.5,
});
