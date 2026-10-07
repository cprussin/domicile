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
- `idlechanged` fires as the screens go dark; there is no warning
  ([ROADMAP.md](/ROADMAP.md)).
- Undo idle changes when `idle` is `false`. The repaint finishes before the screens
  relight.
- Input still reaches clients while blanked. To block it, configure `lock`.
- With no timeout configured, `idle` stays `null`.

## Locking

The compositor locks the desktop at the idle timeout, or when the shell calls
`lock()`, if the config sets `lock.pam_service` or `lock.passphrase`.

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
- `searchFiles` and `previewFile` never settle. Retry once `locked` is
  `false`.
- `setTheme` still works.
- System calls fail with `locked`, except reads under `/sys` and the calls
  `system-battery`, `system-backlight` and `system-audio` make for the
  battery, brightness and output volume ([LOCK.md](LOCK.md#lock-screen-readouts)).

Reloading the page, restarting the engine, loading another shell or editing
the page in devtools does not unlock the desktop.

### Drawing the lock screen

- Your page still receives keys, so it can take a passphrase in a field.
- `unlock` sends it to the compositor. On success, `locked` becomes `false` on
  every shell. Clear the lock screen then, not on your own submit.
- A wrong passphrase, or a check that failed to run, fires `lockedchanged`
  with `locked` still `true`. Treat that while a passphrase is pending as a
  rejection: clear the field.
- A check takes as long as PAM does. PAM delays a wrong password by a few
  seconds. Input stays blocked until `locked` is `false`, and an `unlock` sent
  during a check is dropped.
- There is no attempt limit yet ([ROADMAP.md](/ROADMAP.md)).
- A newly loaded page reads the current state. A reloaded shell must check it
  before drawing an unlocked desktop.
- The shell cannot tell whether the config uses PAM or a passphrase.
- With no `lock` configured, `locked` stays `null` and the desktop cannot
  lock.

Manganese's lock screen:
[`lock/Lock.tsx`](/packages/shell-manganese/src/lock/Lock.tsx),
[`lock/LockReadouts.tsx`](/packages/shell-manganese/src/lock/LockReadouts.tsx) and
[`lock/useLocked.ts`](/packages/shell-manganese/src/lock/useLocked.ts).
