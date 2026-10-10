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
                                       engine: `notifications` attribute
                                                                      ▼
            shell: domicile.notifications, notificationschanged → toasts, bell, drawer
shell ─ dismissNotifications(ids) / invokeNotificationAction(id, key) ─▶ engine ─▶ compositor
```

| Piece | Where |
|---|---|
| Wire types: `HostMessage::Notifications`, `ChromeMessage::DismissNotifications`, `InvokeNotificationAction`, `Notification`, `Urgency` | `packages/domicile-protocol` |
| History; mapping a `Notify` call to a notification (images, actions, urgency, page origin) | `packages/domicile-host/src/notifications.rs` |
| D-Bus: the name, `Notify`, the signals | `packages/domicile-compositor/src/notifications.rs` |
| `notifications` attribute, `dismissNotifications()`, `invokeNotificationAction()` | `control_channel.mojom`, `modules/domicile/domicile_notification*`, patch 0067 |
| Sites ask before they notify; the shell page is allowed; a notification that stays up is not marked critical | patch 0105, `guard-webview-notifications.sh`; for the shell page, `guard-shell-web-apis.sh` |
| SDK: `DomicileNotification`, `notifications`, `dismissNotifications`, `invokeNotificationAction`; `Notification` | `@domicile-desktop/sdk/domicile-host`, `@domicile-desktop/sdk/notification` |
| `Toaster` component | `@domicile-desktop/component-library/Toaster` |
| Manganese toasts, bell and drawer | `packages/shell-manganese/src/notifications/` |

## Key decisions

- **One server for apps and pages.** Chrome on Linux sends Web Notifications
  over `org.freedesktop.Notifications`, so both arrive the same way.
- **The notification portal joins the same history.** Its notifications
  (`portals/notification.rs`) get history ids; a press goes back to the portal
  as `ActionInvoked` with the action's target, not over the bus. Mapping:
  `priority` `urgent` is critical and the rest normal; `display-hint`
  `persistent` keeps the toast up; buttons and `default-action` become actions
  and a click. `transient` and the lock-screen hints change nothing: the drawer
  keeps every notification, and the shell shows none while locked.
- **Sites ask before they notify.** The profile's default is ask, reset at
  every start, and the shell answers the prompt. An allow-all default would
  let any site a browser window opened push notifications from the
  background. A site's setting can be changed in its site permissions
  ([SHELL-BROWSER-WINDOWS.md](/docs/SHELL-BROWSER-WINDOWS.md#permissions)).
- **The shell page may always notify.** `domicile://shell` has no prompt to
  ask through, and Chrome stores no content settings for its scheme.
- **Urgency is the sender's.** Chrome marks a notification that does not time
  out as critical unless the server is one it knows keeps such notifications
  up. Patch 0105 adds `Domicile` to that list, so `requireInteraction` alone
  does not draw a notification as critical.
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
- **A site raises its own window.** Its `client.focus()` or `window.focus()`
  fires `domicile-focus-request` on the `<webview>`
  (`WebViewGuest::ActivateContents`), and the shell raises it.
- **Dismissing a toast** only hides the toast. **Clearing** a notification
  sends `NotificationClosed` (reason 2) to the application.
- **When locked,** the shell shows no toasts and no drawer, and the compositor
  refuses dismiss and action requests.
- **Critical** notifications stay up until dismissed and use the `danger`
  color.
- **Toasts show on the focused monitor,** the one with the keyboard, in its
  top-right corner under its bar.

## Open questions

- **Startup race with Chrome's bridge.** Chrome checks for the server once,
  when its bridge starts. The compositor takes the name long before the engine
  starts, but a slow bus could leave Chrome using its own popups.
  Recommendation: wait until it is seen in practice.
- **Inline reply** (`inline-reply`) is not supported. Recommendation: add it,
  with a text field on the card, when an application needs it.
