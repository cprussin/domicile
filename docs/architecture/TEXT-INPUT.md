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
| Candidate list | `domicile-compositor` (`text_input.rs`, `Candidates`) | The input method's popup surface is announced to the shell as a popup of the editor's window (`HostMessage::PopupPlaced`) once it draws, under the editor's text cursor rectangle, and moved when the rectangle moves. It closes when it draws nothing, when the editor loses the keyboard and when the input method goes |
| Keys | `seat.rs` `inject_key` | A key the engine passes to a native window goes through the seat. An input method that grabbed the keyboard hears it in place of the window |
| The browser's editor | `domicile-compositor` (`chrome_editor.rs`) | A stand-in Wayland client inside the compositor, connected on the first field the browser sends. Its surface has no role and is never drawn; it holds the seat's keyboard while the browser does, so Smithay's relay activates and deactivates it as it does any editor. Its `text-input-v3` carries the browser's field, and what the input method sends it goes back to the browser |
| Over the control channel | `ChromeMessage::TextInput`, `KeyForInputMethod`; `HostMessage::InputMethod`, `Composition`, `KeyPassed` | The browser's alone, never relayed to the page. The browser sends its focused field and, while the input method composes, each key. The compositor says whether it composes, and sends what it composed and the keys it passed back, each with a serial |
| The engine's editor | `ui/base/ime/domicile/desk_input_method.h`, `ui/ozone/platform/drm/domicile/drm_input_method.h` | The DRM platform builds Chromium's `InputMethodAuraLinux`, with a context per window from the Ozone context factory. The focused context sends its field. While composing, a key is held and sent to the input method; one passed back is dispatched again, past it. A composition becomes Chromium's preedit and commit |

## Key decisions

- **Smithay's relay over our own.** It already ties text-input focus to
  `wl_keyboard` focus and routes the grab. Domicile wraps its dispatch only
  where its behavior is wrong for us: Smithay tells the *first* input method
  it is `unavailable` and drops the second, which leaves neither working.
- **The engine is an editor, not an input method client.** Chromium on a tty
  has no input method of its own. Joining the relay as an editor means pages,
  the shell and native windows share one input method and one candidate list,
  and the person configures fcitx5 or IBus once.
- **The candidate list is a popup of the editor's window.** Shells already
  draw a window's popups (`windows.list` with `parent`), so they show it with
  no SDK change. It goes under the cursor rectangle, or above it when under
  would leave the screen, and is kept from the screen's sides, as sway does.
  It is not kept on screen by the shell, which does not know the cursor.
- **The compositor joins the relay for the browser through a stand-in
  client.** Smithay keeps the input method's resource to itself, so a
  compositor-side editor would mean rewriting its relay. A real client on a
  socket pair gets activate, deactivate, `done` and serials from Smithay as
  foot does, and the socket tests drive it through the test chrome.
- **Keys go to the input method only while it composes, and come back over
  the channel.** On a tty the engine reads the keyboard itself, so the
  compositor never sees a page's keys. While an input method holds the
  keyboard, the engine sends it each key and holds it; a key it does not take
  arrives on the stand-in's `wl_keyboard` and goes back as `key_passed`. A
  desk with no input method, or a locked one, costs a page's typing nothing.
- **Every page's channel hears it, and the first serial wins.** The shell and
  each app page have a control channel, and all of them hear every
  `HostMessage`. The engine keeps one desk input method per process, sends on
  its first channel, and drops a serial it already applied.
- **The lock drops text rather than moving focus.** A native window keeps the
  seat's focus while the lock page takes keys, as before. Releases from a
  virtual keyboard still pass, so a key pressed before the lock comes up.

## Plan

- [x] Serve `text-input-v3`, `input-method-v2` and `virtual-keyboard-v1`, the
  last two privileged; one input method per seat; nothing reaches an editor
  while locked; socket tests
  ([#1987](https://github.com/cprussin/domicile/issues/1987))
- [x] Show the input method's candidate list under the focused editor's text
  cursor, as a popup of its window; socket tests
  ([#1988](https://github.com/cprussin/domicile/issues/1988))
- [x] Join the engine as the editor for pages and the shell: the focused
  field's enable, surrounding text, content type and cursor rectangle go to
  the compositor over the control channel, and preedit, commit and
  delete-surrounding come back to the engine's input method context; socket
  tests and engine unit tests
  ([#1989](https://github.com/cprussin/domicile/issues/1989))
- [ ] Show the candidate list for a page or the shell. The stand-in's surface
  is no window, so the list has nothing to be a popup of yet
