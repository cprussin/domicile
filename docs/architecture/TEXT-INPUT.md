# Text input

An input method (fcitx5, IBus) composes text for every editor on the desk:
native windows, browser pages and the shell. There is one composition path
per seat. The compositor relays `text-input-v3` and `input-method-v2`. Native
windows are editors directly, and the engine joins as the editor for pages and
the shell over the control channel. Tracks
[#1986](https://github.com/cprussin/domicile/issues/1986).

## Design

```
                       ┌──────────── compositor (one seat) ───────────┐
input method ──────────┤ input-method-v2  ◀──relay──▶  text-input-v3   ├──▶ native window
(fcitx5, IBus)         │ keyboard grab                 (focus follows  │
  │                    │ ◀── keys the engine passes     the keyboard)  │
  │                    │     to a native window                        │
  │                    │                               control channel ├──▶ engine: page or
  │                    │                               editor (#1989)  │    shell field
  └─ virtual-keyboard-v1 ───▶ keys to the focused native window ───────┘
```

| Piece | Where | Does |
|---|---|---|
| Relay | Smithay `text_input`, `input_method`, `virtual_keyboard` | Text-input focus follows keyboard focus. Preedit, commit and delete-surrounding go to the focused, enabled text input, then `done` |
| Domicile's rules | `domicile-compositor` (`text_input.rs`) | One input method per seat: a second hears `unavailable` and nothing else. While locked, an input method's text and a virtual keyboard's presses reach no editor. The input method and virtual keyboard managers are privileged globals; any client may be an editor |
| Keys | `seat.rs` `inject_key` | A key the engine passes to a native window goes through the seat. An input method that grabbed the keyboard hears it in place of the window |

## Key decisions

- **Smithay's relay over our own.** It already ties text-input focus to
  `wl_keyboard` focus and routes the grab. Domicile wraps its dispatch only
  where its behavior is wrong for us: Smithay tells the *first* input method
  it is `unavailable` and drops the second, which leaves neither working.
- **The engine is an editor, not an input method client.** Chromium on a tty
  has no input method of its own. Joining the relay as an editor means pages,
  the shell and native windows share one input method and one candidate list,
  and the person configures fcitx5 or IBus once.
- **The lock drops text rather than moving focus.** A native window keeps the
  seat's focus while the lock page takes keys, as before. Releases from a
  virtual keyboard still pass, so a key pressed before the lock comes up.

## Plan

- [x] Serve `text-input-v3`, `input-method-v2` and `virtual-keyboard-v1`, the
  last two privileged; one input method per seat; nothing reaches an editor
  while locked; socket tests
  ([#1987](https://github.com/cprussin/domicile/issues/1987))
- [ ] Show the input method's candidate popup beside the focused field: the
  compositor announces the popup surface to the shell with the text cursor
  rectangle, in the window's coordinates, and the shell places it as it places
  a window's popup
  ([#1988](https://github.com/cprussin/domicile/issues/1988))
- [ ] Join the engine as the editor for pages and the shell: the focused
  field's enable, surrounding text, content type and cursor rectangle go to
  the compositor over the control channel, and preedit, commit and
  delete-surrounding come back to the engine's input method context
  ([#1989](https://github.com/cprussin/domicile/issues/1989))
