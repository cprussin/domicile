import type {
  AppChooserBody,
  PortalAnswer,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import type { AppsDesktop } from "@domicile-desktop/system-apps/apps-desktop";
import { AppChooser } from "../AppChooser/AppChooser";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: AppChooserBody;
  screen: string | undefined;
  /** Where the applications' desktop entries are read. */
  domicile: AppsDesktop;
};

/** The AppChooser portal's {@link AppChooser}. Dismissing it cancels. */
export const AppChooserDialog = ({
  answer,
  asker,
  body,
  screen,
  domicile,
}: Props) => (
  <AppChooser
    address={body.filename === undefined ? body.uri : undefined}
    asker={asker}
    choices={body.choices}
    contentType={body.contentType}
    domicile={domicile}
    lastChoice={body.lastChoice}
    onCancel={() => {
      answer(Answer.Canceled());
    }}
    onChoose={(id) => {
      answer(Answer.AppChooser(id));
    }}
    opened={openedOf(body)}
    screen={screen}
  />
);

/** What the dialog opens, as a phrase. */
const openedOf = ({ filename, uri }: AppChooserBody): string => {
  if (filename === undefined) {
    return uri === undefined ? "this file" : "this link";
  } else {
    return filename;
  }
};
