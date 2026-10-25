import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import type { GoogleClient } from "./consent";
import { deskInbox } from "./desk-inbox";
import { Gmail as Account } from "./Gmail";

type Props = {
  /** The Google account, such as `me@gmail.com`. */
  email: string;
  /** The account's name on the bar, such as `Work`. */
  nickname: string;
  /** The Google Cloud OAuth client (Desktop app) it signs in with. */
  client: GoogleClient;
};

/**
 * One Gmail account's inbox count, read with the Gmail API. Not in the
 * default bar.
 */
export const Gmail = ({ client, email, nickname }: Props) => {
  const domicile = useDomicile();
  const account = deskInbox(domicile)(email, client);
  return (
    <Account
      email={email}
      inbox={account.inbox}
      nickname={nickname}
      onOpen={(url) => {
        domicile.browser.open(url);
      }}
      onSignIn={account.signIn}
    />
  );
};
