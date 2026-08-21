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
 * `fail` is injected, and is one function rather than a report and an exit,
 * because saying why and stopping is one action: the caller holding the socket
 * is the renderer, which can do neither half itself and asks the main process
 * for both over one channel.
 *
 * Its own module rather than a helper alongside the socket, so a test can reach
 * it without Electron, which does not load outside Electron.
 */
export const socketFailed = (
  fail: (line: string, code: number) => void,
  path: string,
) => {
  return (failure: Error): void => {
    fail(
      `domicile: the compositor socket at ${path} failed: ${failure.message}\n`,
      1,
    );
  };
};
