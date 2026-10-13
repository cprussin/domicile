import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { deskInbox } from "./desk-inbox";
import { Gmail as Account } from "./Gmail";

type Props = {
  /** The Google account, such as `me@gmail.com`. */
  email: string;
  /** The account's name on the bar, such as `Work`. */
  nickname: string;
};

/**
 * One Gmail account's inbox count, read with the browser's Google sign-in.
 * Not in the default bar.
 */
export const Gmail = ({ email, nickname }: Props) => {
  const domicile = useDomicile();
  return (
    <Account
      email={email}
      inbox={deskInbox(domicile)(email)}
      nickname={nickname}
      onOpen={(url) => {
        domicile.openBrowserWindow(url);
      }}
    />
  );
};
