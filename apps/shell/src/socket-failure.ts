/**
 * What a dead compositor socket costs the shell.
 *
 * Node turns an unhandled `'error'` event into an uncaught exception, so
 * without this the shell hard-crashes whenever it is started without the
 * compositor — the ordinary way to get this wrong — with a stack trace about
 * `PipeConnectWrap` rather than a sentence about the socket.
 *
 * There is nothing to recover to, at connect time or later: the chrome is the
 * compositor's client and has no desktop to draw without it. So it says which
 * socket failed and stops, which is what a program that cannot do its job
 * should do. The message does not claim the socket was unreachable — this same
 * listener catches an `ECONNRESET` from a compositor that died after a good
 * connect, and naming a path that was reached would send the reader looking
 * for a missing file.
 *
 * Its own module rather than a helper in `main.ts`, so a test can reach it:
 * importing `main.ts` pulls in Electron, which does not load outside Electron.
 * `exit` and `report` are injected for the same reason.
 */
export const socketFailed = (
  {
    exit,
    report,
  }: { exit: (code: number) => void; report: (line: string) => void },
  path: string,
) => {
  return (failure: Error): void => {
    report(
      `domicile: the compositor socket at ${path} failed: ${failure.message}\n`,
    );
    exit(1);
  };
};
