# Gestures

Touchpad and touchscreen gestures reach the window under them, and the shell
binds multi-finger gestures the way it binds keys. Tracks
[#1908](https://github.com/cprussin/domicile/issues/1908).

## Design

```
libinput (engine, tty)  ─┐
host zwp_pointer_gestures ┴▶ engine ──▶ shell page ──▶ <app> ──▶ compositor ──▶ client
(engine, nested)             (ui::GestureEvent       (default    (pointer_pinch,  (zwp_pointer_
                              + NativePinch)          handling)   pointer_axis)    gestures_v1)
                                     │
                                     └─▶ bindGestures (3+ fingers, shell)
```

| Piece | Where | Does |
|---|---|---|
| Acquisition | engine `libinput_event_converter.cc`, `wayland_zwp_pointer_gestures.cc` (patch `0184`) | Turns libinput or host pinch into a `ui::GestureEvent` carrying `NativePinch`: phase, device, time, fingers, absolute scale, rotation, cancellation |
| Page | engine `touchpad_pinch_event_queue.cc`, `mouse_wheel_event_manager.cc` | Keeps native pinches out of coalescing and page zoom. A canceled `wheel` claims the gesture for the shell |
| `<app>` | `html_app_element.cc` | Forwards the pinch to its client as `pointer_pinch` |
| Wire | `domicile_protocol::pinch::Pinch` | `begin`, `update`, `end` |
| Delivery | `domicile-compositor` (`pinch.rs`) | One active pinch, owned by the connection and device that began it. Ends canceled on pointer leave, lock, window close or a dropped connection |

Two-finger scrolling already reaches clients as finger `wl_pointer.axis` with
axis stops (patch `0174`), which is what Chrome's history swipe reads.

## Key decisions

- **Two fingers go to the page, three or more to the shell.** Pinch zoom and
  history swipes belong to the window; workspace and overview gestures belong
  to the shell.
- **Phases, not end-only.** Bindings match on direction once committed, and
  shell animations follow the fingers.
- **Guest pinch is Chrome's visual zoom.** The shell's own scale stays 1.
- **libinput recognizes; the engine keeps its numbers.** No thresholds of our
  own and no new settings.
- **A shortcut inhibitor releases gesture bindings too,** as it does keys.

## Plan

- [x] Touchpad pinch to native windows, on the tty and nested.
- [x] A tty VM test with a uinput touchpad (`touchpad-gestures-on-a-tty`).
- [ ] `bindGestures` in the SDK beside `bindKeys`, sharing its modes;
  Manganese defaults.
- [ ] Touchscreen: always advertise `wl_touch`, acquired through the shared
  libinput path; pointer fallback for clients without touch.
- [ ] Edge swipes, recognized in the engine with withheld touches replayed.
- [ ] Bind the host's swipes when nested, subject to what the host consumes.
