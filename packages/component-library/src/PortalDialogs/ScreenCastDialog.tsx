import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type {
  CastSource,
  PortalAnswer,
  ScreenCastBody,
} from "@domicile-desktop/sdk/portal";
import {
  PortalAnswer as Answer,
  CastSourceKind,
} from "@domicile-desktop/sdk/portal";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: ScreenCastBody;
  screen: string | undefined;
};

/**
 * A source picker: the windows an application may record, by name and icon.
 * Picks one, or several when the application asks for more. Dismissing it
 * cancels.
 */
export const ScreenCastDialog = ({ answer, asker, body, screen }: Props) => {
  const [picked, setPicked] = useState<readonly string[]>([]);
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
            disabled={picked.length === 0}
            onClick={() => {
              answer(
                Answer.ScreenCast(
                  body.sources.filter((source) => picked.includes(source.id)),
                ),
              );
            }}
          >
            Share
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
      title={body.multiple ? "Share windows" : "Share a window"}
    >
      <p className={askerStyles}>{`${asker} wants to record`}</p>
      <ToggleGroup
        className={listStyles}
        multiple={body.multiple}
        onValueChange={setPicked}
        orientation="vertical"
        value={picked}
      >
        {body.sources.map((source) => (
          <Toggle className={rowStyles} key={source.id} value={source.id}>
            <SourceIcon source={source} />
            <span>{sourceName(source)}</span>
          </Toggle>
        ))}
      </ToggleGroup>
    </ModalDialog>
  );
};

/** A source's application icon, or a window outline without one. */
const SourceIcon = ({ source }: { source: CastSource }) =>
  source.icon === undefined ? (
    <AppWindowIcon aria-hidden className={iconStyles} />
  ) : (
    <img alt="" className={iconStyles} src={source.icon} />
  );

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 1,
  marginBlockStart: 3,
  maxBlockSize: 96,
  overflowY: "auto",
});

const rowStyles = css({
  _hover: { backgroundColor: "card" },
  "&[data-pressed]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
    borderColor: "accent",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  border: "1px solid transparent",
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  font: "inherit",
  gap: 3,
  paddingBlock: 2,
  paddingInline: 3,
  textAlign: "start",
});

const iconStyles = css({ blockSize: 6, flexShrink: 0, inlineSize: 6 });

/** How the picker names a source. */
const sourceName = (source: CastSource): string => {
  switch (source.kind) {
    case CastSourceKind.Window: {
      const title = source.title === "" ? "Untitled window" : source.title;
      return source.appName === undefined
        ? title
        : `${source.appName}: ${title}`;
    }
  }
};
