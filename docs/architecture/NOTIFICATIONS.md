# Notifications

Applications' and sites' notifications on a desk: the compositor is the
`org.freedesktop.Notifications` server, and the shell toasts them and keeps
them in a drawer.

## Design

```
application ──Notify / CloseNotification──▶ compositor (org.freedesktop.Notifications)
page in a <webview> ─ new Notification() ─▶ engine (Chrome's Linux bridge) ─Notify─▶ │
            ◀──ActionInvoked, NotificationClosed────                                 │  HostMessage::Notifications { items }
                                                                                     ▼
                                                        engine: `notifications` attribute
                                                                                     ▼
                                         shell: domicile.notifications, notificationschanged → toasts, bell, drawer
shell ─ dismissNotifications(ids) / invokeNotificationAction(id, key) ─▶ engine ─▶ compositor
```

| Piece | Where |
|---|---|
| Wire: `HostMessage::Notifications`, `ChromeMessage::DismissNotifications`, `InvokeNotificationAction`, `Notification`, `Urgency` | `packages/domicile-protocol` |
| The history; what a `Notify` is shown as (pictures, actions, urgency, a page's origin) | `packages/domicile-host/src/notifications.rs` |
| The bus: the name, `Notify`, the signals | `packages/domicile-compositor/src/notifications.rs` |
| `notifications` attribute, `dismissNotifications()`, `invokeNotificationAction()` | `control_channel.mojom`, `modules/domicile/domicile_notification*`, patch 0067 |
| Web Notifications allowed without a prompt | patch 0068, `guard-webview-notifications.sh`; the shell's own page, `guard-shell-web-apis.sh` |
| `DomicileNotification`, `notifications`, `dismissNotifications`, `invokeNotificationAction`; `Notification` | `@domicile-desktop/sdk/domicile-host`, `@domicile-desktop/sdk/notification` |
| `Toaster`: the deck of toasts | `@domicile-desktop/component-library/Toaster` |
| Toasts, the bell, the drawer | `packages/shell-manganese/src/notifications/` |

## Key decisions

- **One server for both kinds.** Chrome on Linux shows a Web Notification by
  calling `org.freedesktop.Notifications`, so a site's and a Wayland client's
  arrive the same way. The engine only grants the permission: Chrome's prompt
  is a bubble a desk has nowhere to draw, so the profile defaults to allow.
- **The history is the compositor's.** Pushed whole on every change and on
  connect, like the tray, so a reload keeps it and every monitor's page has the
  same one. Kept until cleared or closed by its application, capped at 100;
  expiring is the toast's, not the notification's.
- **News is the shell's to tell.** A new id, or a replaced one (its `time`
  moved), is a toast; the first list a page hears is history and toasts nothing.
- **No `body-markup`.** Bodies are text; senders told so send none.
- **`x-kde-origin-name`.** Advertised so Chrome sends a page's origin as a hint;
  it becomes the notification's source, and Chrome's own `settings` button on
  it is dropped.
- **A press takes the action and closes the notification**, unless it is
  `resident`. Dismissing a toast only hides it; clearing tells the application
  (`NotificationClosed`, reason 2).
- **Locked: no toasts, no drawer**, and both requests are refused as commands.
- **Critical** stays up until dismissed and is drawn in `danger`.

## Open questions

- **Which monitor toasts.** One page over the desk toasts in its top-right
  corner, which is the rightmost screen's. Recommendation: the focused screen's,
  once a toast can be placed by display.
- **The bridge's start-up race.** Chrome looks for the server once, when its
  bridge starts; the compositor takes the name long before the engine starts,
  but a desk whose bus is slow could leave Chrome on its own popups.
  Recommendation: watch for it before acting.
- **Inline reply** (`inline-reply`) is not offered. Recommendation: add it with
  a text field on the card when an application wants it.
