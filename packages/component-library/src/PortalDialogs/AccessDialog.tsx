import type { AccessBody, PortalAnswer } from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: AccessBody;
  screen: string | undefined;
};

/** A yes/no question from an application. Dismissing it denies. */
export const AccessDialog = ({ answer, asker, body, screen }: Props) => (
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
          {body.denyLabel ?? "Deny"}
        </Button>
        <Button
          onClick={() => {
            answer(Answer.Access());
          }}
        >
          {body.grantLabel ?? "Allow"}
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
    title={body.title}
  >
    <p className={askerStyles}>{`${asker} asks`}</p>
    {body.subtitle !== "" && <p className={textStyles}>{body.subtitle}</p>}
    {body.body !== "" && <p className={textStyles}>{body.body}</p>}
  </ModalDialog>
);

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const textStyles = css({ color: "foreground", margin: 0 });
