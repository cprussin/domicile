# Idle and lock in a shell

What a shell does when the screens blank and when the desktop locks. Part of
[WRITING-A-SHELL.md](WRITING-A-SHELL.md). Config:
[SHELL-CONFIG.md](SHELL-CONFIG.md#idle) and
[SHELL-CONFIG.md](SHELL-CONFIG.md#lock). Implementation:
[IDLE.md](IDLE.md), [LOCK.md](LOCK.md).

## Idle

After `idle.blank_after_seconds` without input, the screens turn off and
`domicile.session.idle` becomes `true`:

<!-- tab: React -->

```tsx
import { useIdle } from "@domicile-desktop/react/session";

const Desktop = () => {
  // true: the screens are off. false: input turned them back on.
  const idle = useIdle() === true;
  return <main className={idle ? "idle" : undefined}>…</main>;
};
```

<!-- tab: JavaScript -->

```js
const idle = () => {
  // true: the screens are off. false: input turned them back on.
  document.body.classList.toggle("idle", domicile.session.idle === true);
};
idle();
domicile.session.on("idlechange", idle);
```

<!-- /tabs -->

- Use this attribute to detect idle. Only the compositor sees all input. The
  page stays visible while the screens are off, so `visibilityState` and idle
  detectors are wrong.
- A newly loaded page reads the current state.
- `idlechange` fires as the screens go dark. To act before that, listen for
  the [warning](#warning-before-blanking).
- Undo idle changes when `idle` is `false`. The repaint finishes before the screens
  relight.
- Input still reaches clients while blanked. Blanking does not lock; see
  [Locking](#locking).
- With no timeout configured, `idle` stays `undefined`.

### Warning before blanking

With `idle.warn_before_seconds` set, the compositor warns the shell before the
screens go dark:

<!-- tab: React -->

```tsx
const useDimmed = () => {
  const { session } = useDomicile();
  const [dimmed, setDimmed] = useState(false);
  useEffect(() => {
    let stop = () => {};
    session.idleWarnings().then((warnings) =>
      warnings.match({
        Err: (error) => console.error("no idle warnings", error),
        Ok: async ({ items }) => {
          const reader = items.getReader();
          stop = () => reader.cancel();
          for (;;) {
            const { done, value: blanksInMs } = await reader.read();
            if (done) return;
            // A number: the screens go dark in that many milliseconds.
            // `undefined`: input called it off, or the screens went dark.
            setDimmed(blanksInMs !== undefined);
          }
        },
      }),
    );
    return () => stop();
  }, [session]);
  return dimmed;
};
```

<!-- tab: JavaScript -->

```js
// Awaited: both arms return a promise.
await (await domicile.session.idleWarnings()).match({
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

<!-- /tabs -->

- Any input during the warning keeps the screens on, so a dim that wakes on a
  key needs no code of its own.
- A page that listens during a warning hears it at once.
- Allowed while locked, so a lock screen can dim too.
- Without `idle.warn_before_seconds`, nothing is heard.

## Locking

Every desktop has a lock; no config turns it on. The compositor locks it:

- when the shell calls `session.lock()`,
- before the machine sleeps, and when logind locks the session
  (`loginctl lock-session`),
- after `idle.lock_after_seconds` without input, if that is set. This clock is
  separate from blanking.

PAM is the only way to unlock it. The compositor checks the passphrase through
the PAM service `lock.pam_service`, or `domicile` when that is unset
([The config file](SHELL-CONFIG.md#lock)).

<!-- tab: React -->

```tsx
import { useLocked } from "@domicile-desktop/react/session";

const Desktop = () => {
  const { session } = useDomicile();
  return useLocked() === true ? (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        session.unlock(String(new FormData(event.currentTarget).get("passphrase")));
      }}
    >
      <input name="passphrase" type="password" />
    </form>
  ) : (
    // lock now; the lock screen goes up when `locked` is true
    <button onClick={() => session.lock()}>Lock</button>
  );
};
```

<!-- tab: JavaScript -->

```js
domicile.session.on("lockchange", () => {
  setLocked(domicile.session.locked === true);
});

domicile.session.unlock(typed); // submit a passphrase
domicile.session.lock();        // lock now; the lock screen goes up when `locked` is true
```

<!-- /tabs -->

The compositor enforces the lock. While `locked` is `true`:

- No client receives any key, click, scroll or pointer motion.
- `windows.close`, `processes.launch` and `clipboard.copy` do nothing and log a warning.
- `files.search` never settles. Retry once `locked` is `false`.
- `browser.fetch` rejects. The engine refuses it, from the compositor's
  `locked` message.
- `theme.set` still works.
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
- A passphrase that did not unlock fires `lockchange` with `locked` still
  `true`. Treat that while a passphrase is pending as a rejection: clear the
  field.
- To say why, listen with `session.unlockRefusals()`. Each refusal arrives
  before its `lockchange`:

  <!-- tab: React -->

  ```tsx
  useEffect(() => {
    let stop = () => {};
    session.unlockRefusals().then((refusals) =>
      refusals.match({
        Err: (error) => console.error(error),
        Ok: async ({ items }) => {
          const reader = items.getReader();
          stop = () => reader.cancel();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            // value.refusal: WrongPassphrase, Unverifiable (the check could not
            // run) or TooSoon (sent during the wait, so not checked).
            setRefused(value);
          }
        },
      }),
    );
    return () => stop();
  }, [session]);
  ```

  <!-- tab: JavaScript -->

  ```js
  const hear = async (items) => {
    for await (const { refusal, failures, retryInMs } of items) {
      // refusal: WrongPassphrase, Unverifiable (the check could not run) or
      // TooSoon (sent during the wait, so not checked).
    }
  };

  (await domicile.session.unlockRefusals()).match({
    Err: (error) => console.error(error),
    Ok: ({ items }) => {
      hear(items).catch((error) => console.error(error));
    },
  });
  ```

  <!-- /tabs -->

- After 3 refused passphrases the compositor waits before checking another,
  starting at 5 seconds and doubling up to 5 minutes. `retryInMs` is the wait
  left. See [LOCK.md](LOCK.md#refusals-and-the-wait).
- A check takes as long as PAM does. PAM delays a wrong password by a few
  seconds. Input stays blocked until `locked` is `false`, and an `unlock` sent
  during a check is dropped.
- A newly loaded page reads the current state. A reloaded shell must check it
  before drawing an unlocked desktop.
- `locked` is `undefined` only until the compositor's first message. After
  that it is `true` or `false`.
- Without the PAM service's file (`/etc/pam.d/domicile` by default), the
  desktop still locks and every passphrase is refused `Unverifiable`. Say so
  on the lock screen instead of "wrong password". Adding the file fixes the
  next attempt, with no restart ([LOCK.md](LOCK.md#failures-fail-closed)).

Manganese's lock screen:
[`lock/Lock.tsx`](/packages/manganese-lock/src/Lock.tsx),
[`lock/LockBar.tsx`](/packages/manganese-lock/src/LockBar.tsx) and
[`lock/useLocked.ts`](/packages/manganese-lock/src/useLocked.ts).
