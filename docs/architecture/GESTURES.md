# Gestures

Touchpad gestures reach the window under them, and the shell binds
multi-finger gestures the way it binds keys. Tracks
[#1908](https://github.com/cprussin/domicile/issues/1908).

## Design

```
libinput (engine, tty)  ─┐
host zwp_pointer_gestures ┴▶ engine ──▶ shell page ──▶ <app> ──▶ compositor ──▶ client
(engine, nested)             (ui::GestureEvent       (default    (pointer_pinch,  (zwp_pointer_
                              + NativePinch)          handling)   pointer_axis)    gestures_v1)
                                     │
                                     └─▶ DomicileHost `gesture` ──▶ bindKeys
                                         (3+ fingers, grabbed)
```

| Piece | Where | Does |
|---|---|---|
| Acquisition | engine `libinput_event_converter.cc`, `wayland_zwp_pointer_gestures.cc` (patch `0184`) | Turns libinput or host pinch into a `ui::GestureEvent` carrying `NativePinch`: phase, device, time, fingers, absolute scale, rotation, cancellation |
| Page | engine `touchpad_pinch_event_queue.cc`, `mouse_wheel_event_manager.cc` | Keeps native pinches out of coalescing and page zoom. A canceled `wheel` claims the gesture for the shell |
| `<app>` | `html_app_element.cc` | Forwards the pinch to its client as `pointer_pinch` |
| Wire | `domicile_protocol::pinch::Pinch` | `begin`, `update`, `end` |
| Delivery | `domicile-compositor` (`pinch.rs`) | One active pinch, owned by the connection and device that began it. Ends canceled on pointer leave, lock, window close or a dropped connection |
| Shell grab | engine `native_gesture_sink.*` (patch `0185`), `desk_gestures.*`, `DomicileHost.grabGesture` | libinput (or the host, nested) offers each gesture of three fingers or more to the sink before the pinch path. `DeskGestures` takes it when a page grabbed its kind and count, and sends every phase to the first such page as a `gesture` event. A swipe or hold nobody grabbed goes nowhere; a pinch goes on to the page |
| Bindings | `@domicile-desktop/sdk/gesture-binding`, `bind-keys` | Parses sway's grammar, grabs each kind and count, follows the phases, and runs the binding the finished gesture fits in the current mode |

Two-finger scrolling already reaches clients as finger `wl_pointer.axis` with
axis stops (patch `0174`), which is what Chrome's history swipe reads.

## Bindings

`<kind>[:<fingers>][:<direction>[+<direction>…]]`, as sway's `bindgesture`:

- `kind`: `swipe`, `pinch` or `hold`.
- `fingers`: three or more. Left out, any count of three or more.
- Directions: a swipe goes `up`, `down`, `left` or `right`; a pinch goes
  `inward` or `outward`, and `clockwise` or `counterclockwise`. A hold has
  none. Left out, any way.

A binding runs once its gesture ends without being canceled. A swipe went its
larger axis's way, and also its smaller one's when that moved at least half as
far, so `swipe:3:up+left` is a diagonal. A pinch went by its last scale and its
summed rotation. Of the bindings a gesture fits, one with a count wins over
one without, then more directions over fewer.

Manganese binds `swipe:3:left` and `swipe:3:right` to `workspace
next_on_output` and `prev_on_output`.

## Key decisions

- **Two fingers go to the page, three or more to the shell.** Pinch zoom and
  history swipes belong to the window; workspace and overview gestures belong
  to the shell.
- **Phases, not end-only.** Bindings match on direction once committed, and
  shell animations follow the fingers.
- **Guest pinch is Chrome's visual zoom.** The shell's own scale stays 1.
- **libinput recognizes; the engine keeps its numbers.** No thresholds of our
  own and no new settings.
- **Grabs name a kind and count, not a direction.** The engine has to take a
  gesture at its begin, before it has gone anywhere.
- **The first page to grab a gesture gets all of it,** begin to end, as
  `DeskGestures` decides at the begin.
- **A shortcut inhibitor silences gesture bindings,** as it does keys, but the
  window holding it does not get them yet: the engine takes the gesture before
  it knows. See [KNOWN-GAPS.md](/docs/KNOWN-GAPS.md).

## Plan

- [x] Touchpad pinch to native windows, on the tty and nested.
- [x] A tty VM test with a uinput touchpad (`touchpad-gestures-on-a-tty`).
- [x] Gesture bindings in `bindKeys`, sharing its modes; Manganese
  defaults.
- [ ] Touchscreen: always advertise `wl_touch`, acquired through the shared
  libinput path; pointer fallback for clients without touch.
- [ ] Edge swipes, recognized in the engine with withheld touches replayed.
- [x] Bind the host's swipes when nested, subject to what the host consumes.
