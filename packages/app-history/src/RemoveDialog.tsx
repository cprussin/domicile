import { Button } from "@domicile-desktop/component-library/Button";
import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";

import { css } from "../styled-system/css";

type Props = {
  count: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** Asks before checked rows are removed from the history. */
export const RemoveDialog = ({
  count,
  onConfirm,
  onOpenChange,
  open,
}: Props) => (
  <ModalDialog
    footer={
      <>
        <ModalDialog.CloseButton variant="ghost">
          Cancel
        </ModalDialog.CloseButton>
        <Button onClick={onConfirm} variant="danger">
          Remove
        </Button>
      </>
    }
    onOpenChange={onOpenChange}
    open={open}
    title="Remove selected items?"
  >
    <p className={textStyles}>
      {count === 1
        ? "The page you checked will be removed from your history for that day."
        : `The ${count} pages you checked will be removed from your history for their days.`}
    </p>
  </ModalDialog>
);

const textStyles = css({ color: "muted", fontSize: "sm", margin: 0 });
