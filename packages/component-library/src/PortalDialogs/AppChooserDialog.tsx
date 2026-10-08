import type {
  AppChooserBody,
  PortalAnswer,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import type { System } from "@domicile-desktop/sdk/system";
import { AppChooser } from "../AppChooser/AppChooser";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: AppChooserBody;
  screen: string | undefined;
  /** Where the applications' desktop entries are read. */
  system: System;
};

/** The AppChooser portal's {@link AppChooser}. Dismissing it cancels. */
export const AppChooserDialog = ({
  answer,
  asker,
  body,
  screen,
  system,
}: Props) => (
  <AppChooser
    choices={body.choices}
    contentType={body.contentType}
    description={`${asker} asks`}
    lastChoice={body.lastChoice}
    onCancel={() => {
      answer(Answer.Canceled());
    }}
    onChoose={(id) => {
      answer(Answer.AppChooser(id));
    }}
    screen={screen}
    system={system}
    title={titleOf(body)}
  />
);

/** What the dialog opens, as its title names it. */
const titleOf = ({ filename, uri }: AppChooserBody): string => {
  const opened = filename ?? uri;
  return opened === undefined ? "Open with" : `Open ${opened} with`;
};
