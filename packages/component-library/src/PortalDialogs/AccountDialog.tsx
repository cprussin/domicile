import type { AccountBody, PortalAnswer } from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: AccountBody;
  screen: string | undefined;
};

/**
 * Whether an application may have the user's name and picture. Dismissing it
 * keeps them.
 */
export const AccountDialog = ({ answer, asker, body, screen }: Props) => (
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
          Don't share
        </Button>
        <Button
          onClick={() => {
            answer(Answer.Access());
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
    title="Share your name and picture?"
  >
    <p className={askerStyles}>{`${asker} asks`}</p>
    {body.reason !== undefined && <p className={textStyles}>{body.reason}</p>}
  </ModalDialog>
);

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const textStyles = css({ color: "foreground", margin: 0 });
