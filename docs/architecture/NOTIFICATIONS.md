# Notifications

The compositor is the `org.freedesktop.Notifications` server for both Wayland
applications and web pages. The shell shows each notification as a toast and
keeps a history in a drawer.

## Design

```
application ─────── Notify / CloseNotification ──────▶ compositor
page: new Notification() ─▶ engine (Chrome's Linux bridge) ─Notify─▶ │
            ◀── ActionInvoked, NotificationClosed ──                  │ HostMessage::Notifications { items }
                                                                      ▼
                                                     engine: `notifications` event
                                                                      ▼
                         shell: DomicileClient.on("notifications") → toasts, bell, drawer
shell ─ dismissNotifications(ids) / invokeNotificationAction(id, key) ─▶ engine ─▶ compositor
```

| Piece | Where |
|---|---|
| Wire types: `HostMessage::Notifications`, `ChromeMessage::DismissNotifications`, `InvokeNotificationAction`, `Notification`, `Urgency` | `packages/domicile-protocol` |
| History; mapping a `Notify` call to a notification (images, actions, urgency, page origin) | `packages/domicile-host/src/notifications.rs` |
| D-Bus: the name, `Notify`, the signals | `packages/domicile-compositor/src/notifications.rs` |
| `notifications` event, `dismissNotifications()`, `invokeNotificationAction()` | `control_channel.mojom`, `modules/domicile/domicile_notification*`, patch 0067 |
| Web Notifications allowed without a prompt | patch 0068, `guard-webview-notifications.sh`; for the shell page, `guard-shell-web-apis.sh` |
| SDK: `Notification`, `DomicileClient.dismissNotifications`, `invokeNotificationAction` | `@domicile-desktop/sdk/notification`, `domicile-client` |
| `Toaster` component | `@domicile-desktop/component-library/Toaster` |
| Manganese toasts, bell and drawer | `packages/shell-manganese/src/notifications/` |

## Key decisions

- **One server for apps and pages.** Chrome on Linux sends Web Notifications
  over `org.freedesktop.Notifications`, so both arrive the same way.
- **Pages get notification permission by default.** Chrome's permission prompt
  is a bubble the shell has no place to draw, so the profile allows it.
- **The compositor keeps the history.**
  - It sends the full list on every change and on connect, so a reload keeps
    it and every monitor's page sees the same list.
  - It keeps a notification until the user clears it or its application closes
    it, up to 100.
  - Only toasts expire; notifications do not.
- **The shell decides what to toast.** A new id, or a replaced one (its `time`
  changed), shows a toast. The first list a page receives is history and shows
  no toasts.
- **No `body-markup`.** Bodies are plain text. The server does not advertise
  markup, so senders send none.
- **`x-kde-origin-name` is advertised** so Chrome sends the page's origin as a
  hint. The origin becomes the notification's source, and Chrome's `settings`
  action is dropped.
- **Clicking an action** runs it and closes the notification, unless the
  notification is `resident`.
- **Dismissing a toast** only hides the toast. **Clearing** a notification
  sends `NotificationClosed` (reason 2) to the application.
- **When locked,** the shell shows no toasts and no drawer, and the compositor
  refuses dismiss and action requests.
- **Critical** notifications stay up until dismissed and use the `danger`
  color.

## Open questions

- **Which monitor shows toasts.** The shell page spans all monitors and toasts
  in its top-right corner, which is on the rightmost monitor. Recommendation:
  toast on the focused monitor once a toast can be placed per display.
- **Startup race with Chrome's bridge.** Chrome checks for the server once,
  when its bridge starts. The compositor takes the name long before the engine
  starts, but a slow bus could leave Chrome using its own popups.
  Recommendation: wait until it is seen in practice.
- **Inline reply** (`inline-reply`) is not supported. Recommendation: add it,
  with a text field on the card, when an application needs it.
