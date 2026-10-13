# Idle and lock in a shell

What a shell does when the screens blank and when the desktop locks. Part of
[WRITING-A-SHELL.md](WRITING-A-SHELL.md). Config:
[SHELL-CONFIG.md](SHELL-CONFIG.md#idle) and
[SHELL-CONFIG.md](SHELL-CONFIG.md#lock). Implementation:
[IDLE.md](IDLE.md), [LOCK.md](LOCK.md).

## Idle

After `idle.blank_after_seconds` without input, the screens turn off and
`domicile.idle` becomes `true`:

```ts
const idle = () => {
  // true: the screens are off. false: input turned them back on.
  document.body.classList.toggle("idle", domicile.idle === true);
};
idle();
domicile.addEventListener("idlechanged", idle);
```

- Use this attribute to detect idle. Only the compositor sees all input. The
  page stays visible while the screens are off, so `visibilityState` and idle
  detectors are wrong.
- A newly loaded page reads the current state.
- `idlechanged` fires as the screens go dark. To act before that, listen for
  the [warning](#warning-before-blanking).
- Undo idle changes when `idle` is `false`. The repaint finishes before the screens
  relight.
- Input still reaches clients while blanked. To block it, configure `lock`.
- With no timeout configured, `idle` stays `null`.

### Warning before blanking

With `idle.warn_before_seconds` set, the compositor warns the shell before the
screens go dark:

```ts
import { system } from "@domicile-desktop/sdk/system";

// Awaited: both arms return a promise.
await (await system(domicile).idleWarnings()).match({
  Err: async (error) => {
    console.error("no idle warnings", error);
  },
  Ok: async ({ items }) => {
    for await (const blanksInMs of items) {
      // A number: the screens go dark in that many milliseconds.
      // `undefined`: input called it off, or the screens went dark.
      document.body.classList.toggle("dimmed", blanksInMs !== undefined);
    }
  },
});
```

- Any input during the warning keeps the screens on, so a dim that wakes on a
  key needs no code of its own.
- A page that listens during a warning hears it at once.
- Allowed while locked, so a lock screen can dim too.
- Without `idle.warn_before_seconds`, nothing is heard.

## Locking

The compositor locks the desktop at the idle timeout, or when the shell calls
`lock()`, if the config sets `lock.pam_service` or `lock.passphrase_hash`.

```ts
domicile.addEventListener("lockedchanged", () => {
  setLocked(domicile.locked === true);
});

domicile.unlock(typed); // submit a passphrase
domicile.lock();        // lock now; the lock screen goes up when `locked` is true
```

The compositor enforces the lock. While `locked` is `true`:

- No client receives any key, click, scroll or pointer motion.
- `closeApp`, `spawn` and `copyClipboardEntry` do nothing and log a warning.
- `searchFiles` never settles. Retry once `locked` is `false`.
- `setTheme` still works.
- System calls fail with `locked`, except reads under `/sys`, the calls
  `system-battery`, `system-backlight` and `system-audio` make for the
  battery, brightness and output volume, and `system-bluetooth`'s watch
  ([LOCK.md](LOCK.md#lock-screen-readouts)).

Reloading the page, restarting the engine, loading another shell or editing
the page in devtools does not unlock the desktop.

### Drawing the lock screen

- Your page still receives keys, so it can take a passphrase in a field.
- `unlock` sends it to the compositor. On success, `locked` becomes `false` on
  every shell. Clear the lock screen then, not on your own submit.
- A passphrase that did not unlock fires `lockedchanged` with `locked` still
  `true`. Treat that while a passphrase is pending as a rejection: clear the
  field.
- To say why, listen with `unlockRefusals()` from
  `@domicile-desktop/sdk/system`. Each refusal arrives before its
  `lockedchanged`:

  ```ts
  const hear = async (items: ReadableStream<UnlockRefused>) => {
    for await (const { refusal, failures, retryInMs } of items) {
      // refusal: WrongPassphrase, Unverifiable (the check could not run) or
      // TooSoon (sent during the wait, so not checked).
    }
  };

  (await system(domicile).unlockRefusals()).match({
    Err: (error) => console.error(error),
    Ok: ({ items }) => {
      hear(items).catch((error: unknown) => console.error(error));
    },
  });
  ```

- After 3 refused passphrases the compositor waits before checking another,
  starting at 5 seconds and doubling up to 5 minutes. `retryInMs` is the wait
  left. See [LOCK.md](LOCK.md#refusals-and-the-wait).
- A check takes as long as PAM does. PAM delays a wrong password by a few
  seconds. Input stays blocked until `locked` is `false`, and an `unlock` sent
  during a check is dropped.
- A newly loaded page reads the current state. A reloaded shell must check it
  before drawing an unlocked desktop.
- The shell cannot tell whether the config uses PAM or a passphrase.
- With no `lock` configured, `locked` stays `null` and the desktop cannot
  lock.

Manganese's lock screen:
[`lock/Lock.tsx`](/packages/manganese-lock/src/Lock.tsx),
[`lock/LockBar.tsx`](/packages/manganese-lock/src/LockBar.tsx) and
[`lock/useLocked.ts`](/packages/manganese-lock/src/useLocked.ts).
