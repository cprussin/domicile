//! Notifications sent through the notification portal
//! (`org.freedesktop.impl.portal.Notification`).
//!
//! They join the `org.freedesktop.Notifications` history in
//! [`crate::notifications`], so the shell draws both the same. This keeps which
//! entries came from the portal, under the application's own ids, so an action
//! goes back to the portal with its target. See
//! `docs/PORTALS.md`.

use crate::notifications::{Hints, Icon, Notifications, Notified, Notify, DEFAULT_ACTION};

/// An `AddNotification` call, parsed. `T` is an action's target.
#[derive(Debug, Clone, PartialEq)]
pub struct PortalNotification<T> {
    pub title: String,
    pub body: String,
    pub icon: Option<Icon>,
    pub priority: Priority,
    /// What a press on the notification itself does.
    pub default_action: Option<Action<T>>,
    pub buttons: Vec<Button<T>>,
    /// `display-hint`'s values.
    pub display_hint: Vec<String>,
}

/// The portal's `priority`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Priority {
    Low,
    #[default]
    Normal,
    High,
    Urgent,
}

/// An action the application named, and its parameter.
#[derive(Debug, Clone, PartialEq)]
pub struct Action<T> {
    pub name: String,
    pub target: Option<T>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Button<T> {
    pub label: String,
    pub action: Action<T>,
}

/// An action the user took, for the portal's `ActionInvoked`.
#[derive(Debug, Clone, PartialEq)]
pub struct Invoked<T> {
    pub app_id: String,
    pub id: String,
    pub action: String,
    pub target: Option<T>,
}

/// The `display-hint` that keeps the toast up until dismissed.
const PERSISTENT: &str = "persistent";

/// The history entries the portal added.
#[derive(Debug)]
pub struct PortalNotifications<T> {
    owned: Vec<Owned<T>>,
}

#[derive(Debug)]
struct Owned<T> {
    /// The id in [`Notifications`].
    shown: u32,
    app_id: String,
    id: String,
    /// Each action under the key the shell presses it by.
    actions: Vec<(String, Action<T>)>,
}

impl<T> Default for PortalNotifications<T> {
    fn default() -> Self {
        PortalNotifications { owned: Vec::new() }
    }
}

impl<T> PortalNotifications<T> {
    /// Add `notification` to `held`, replacing `app_id`'s `id` if held.
    ///
    /// `Notified::evicted` may name a notification from either source; the
    /// caller asks [`Self::forget`] which.
    pub fn add(
        &mut self,
        held: &mut Notifications,
        app_id: String,
        id: String,
        notification: PortalNotification<T>,
        now: u64,
    ) -> Notified {
        let replaces_id = self
            .position(&app_id, &id)
            .map_or(0, |at| self.owned.remove(at).shown);
        // Buttons go by their index, so none collides with the history's
        // `default` or with another button of the same action.
        let mut labels = Vec::new();
        let mut actions = Vec::new();
        if let Some(action) = notification.default_action {
            labels.extend([DEFAULT_ACTION.to_string(), String::new()]);
            actions.push((DEFAULT_ACTION.to_string(), action));
        }
        for (at, button) in notification.buttons.into_iter().enumerate() {
            labels.extend([at.to_string(), button.label]);
            actions.push((at.to_string(), button.action));
        }
        let persistent = notification
            .display_hint
            .iter()
            .any(|hint| hint == PERSISTENT);
        let notified = held.notify(
            Notify {
                app_name: app_id.clone(),
                replaces_id,
                // Desktop file ids usually name the application's icon too.
                app_icon: app_id.clone(),
                summary: notification.title,
                body: notification.body,
                actions: labels,
                hints: Hints {
                    urgency: Some(match notification.priority {
                        Priority::Low => 0,
                        Priority::Normal | Priority::High => 1,
                        Priority::Urgent => 2,
                    }),
                    ..Hints::default()
                },
                expire_timeout: if persistent { 0 } else { -1 },
                icon: notification.icon,
            },
            now,
        );
        self.owned.push(Owned {
            shown: notified.id,
            app_id,
            id,
            actions,
        });
        notified
    }

    /// Remove `app_id`'s `id`. Returns whether it was held.
    pub fn remove(&mut self, held: &mut Notifications, app_id: &str, id: &str) -> bool {
        self.position(app_id, id)
            .map(|at| held.close(self.owned.remove(at).shown))
            .is_some()
    }

    /// Whether `shown` came from the portal.
    pub fn owns(&self, shown: u32) -> bool {
        self.owned.iter().any(|owned| owned.shown == shown)
    }

    /// The user pressed `key` on `shown`, a portal notification, which then
    /// leaves the history. `None` if it does not offer that key.
    pub fn invoke(
        &mut self,
        held: &mut Notifications,
        shown: u32,
        key: &str,
    ) -> Option<Invoked<T>> {
        let at = self.owned.iter().position(|owned| owned.shown == shown)?;
        held.invoke(shown, key)?;
        let owned = self.owned.remove(at);
        let (_, action) = owned
            .actions
            .into_iter()
            .find(|(offered, _)| offered == key)
            .expect("the history offers only the keys added with it");
        Some(Invoked {
            app_id: owned.app_id,
            id: owned.id,
            action: action.name,
            target: action.target,
        })
    }

    /// `shown` left the history. Returns whether it came from the portal.
    pub fn forget(&mut self, shown: u32) -> bool {
        let before = self.owned.len();
        self.owned.retain(|owned| owned.shown != shown);
        self.owned.len() != before
    }

    fn position(&self, app_id: &str, id: &str) -> Option<usize> {
        self.owned
            .iter()
            .position(|owned| owned.app_id == app_id && owned.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tray::TrayIcons;
    use domicile_protocol::{Notification, Urgency};

    fn held() -> Notifications {
        Notifications::new(TrayIcons::new(Vec::new(), None))
    }

    fn sent(title: &str) -> PortalNotification<&'static str> {
        PortalNotification {
            title: title.into(),
            body: "Ready to install".into(),
            icon: None,
            priority: Priority::Normal,
            default_action: None,
            buttons: Vec::new(),
            display_hint: Vec::new(),
        }
    }

    fn action(name: &str, target: Option<&'static str>) -> Action<&'static str> {
        Action {
            name: name.into(),
            target,
        }
    }

    /// Add `notification` as `org.example.App`'s `id`.
    fn add(
        portal: &mut PortalNotifications<&'static str>,
        notifications: &mut Notifications,
        id: &str,
        notification: PortalNotification<&'static str>,
    ) -> u32 {
        portal
            .add(
                notifications,
                "org.example.App".into(),
                id.into(),
                notification,
                10,
            )
            .id
    }

    #[test]
    fn it_joins_the_history_under_the_applications_name() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());

        let shown = add(&mut portal, &mut notifications, "update", sent("Update"));

        assert_eq!(
            notifications.items(),
            [Notification {
                id: shown,
                app_name: "org.example.App".into(),
                summary: "Update".into(),
                body: "Ready to install".into(),
                icon: None,
                urgency: Urgency::Normal,
                actions: Vec::new(),
                clickable: false,
                timeout_ms: None,
                time: 10,
            }]
        );
        assert!(portal.owns(shown));
    }

    #[test]
    fn the_same_id_replaces_and_another_applications_does_not() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        let first = add(&mut portal, &mut notifications, "update", sent("Update"));

        let again = add(
            &mut portal,
            &mut notifications,
            "update",
            sent("Downloaded"),
        );
        let other = portal
            .add(
                &mut notifications,
                "org.example.Other".into(),
                "update".into(),
                sent("Other"),
                20,
            )
            .id;

        assert_eq!(again, first);
        assert_ne!(other, first);
        assert_eq!(notifications.items().len(), 2);
    }

    #[test]
    fn priority_is_urgency_and_urgent_is_critical() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        for (priority, id) in [
            (Priority::Low, "low"),
            (Priority::Normal, "normal"),
            (Priority::High, "high"),
            (Priority::Urgent, "urgent"),
        ] {
            add(
                &mut portal,
                &mut notifications,
                id,
                PortalNotification {
                    priority,
                    ..sent(id)
                },
            );
        }

        assert_eq!(
            notifications
                .items()
                .iter()
                .map(|shown| shown.urgency)
                .collect::<Vec<_>>(),
            [
                Urgency::Low,
                Urgency::Normal,
                Urgency::Normal,
                Urgency::Critical
            ]
        );
    }

    #[test]
    fn a_persistent_one_toasts_until_dismissed() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());

        add(
            &mut portal,
            &mut notifications,
            "call",
            PortalNotification {
                display_hint: vec!["persistent".into(), "show-as-new".into()],
                ..sent("Call")
            },
        );

        assert_eq!(notifications.items()[0].timeout_ms, Some(0));
    }

    #[test]
    fn buttons_and_the_default_action_go_back_with_their_targets() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        let with_actions = || PortalNotification {
            default_action: Some(action("app.open", Some("inbox"))),
            buttons: vec![
                Button {
                    label: "Reply".into(),
                    action: action("app.reply", Some("message-7")),
                },
                // Named `default`, which the history reserves for a press on
                // the whole notification.
                Button {
                    label: "Later".into(),
                    action: action("default", None),
                },
            ],
            ..sent("Message")
        };
        let shown = add(&mut portal, &mut notifications, "message", with_actions());
        let shown_actions = notifications.items()[0].actions.clone();
        let clickable = notifications.items()[0].clickable;
        let replied_to = shown_actions[0].key.clone();

        let invoked = portal.invoke(&mut notifications, shown, &replied_to);
        let again = add(&mut portal, &mut notifications, "message", with_actions());
        let opened = portal.invoke(&mut notifications, again, DEFAULT_ACTION);

        assert!(clickable);
        assert_eq!(
            shown_actions
                .iter()
                .map(|offered| offered.label.as_str())
                .collect::<Vec<_>>(),
            ["Reply", "Later"]
        );
        assert_ne!(shown_actions[1].key, DEFAULT_ACTION);
        assert_eq!(
            invoked,
            Some(Invoked {
                app_id: "org.example.App".into(),
                id: "message".into(),
                action: "app.reply".into(),
                target: Some("message-7"),
            })
        );
        assert_eq!(
            opened.map(|opened| (opened.action, opened.target)),
            Some(("app.open".to_string(), Some("inbox")))
        );
        assert_eq!(notifications.items(), []);
        assert!(!portal.owns(again));
    }

    #[test]
    fn a_key_it_never_offered_does_nothing() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        let shown = add(&mut portal, &mut notifications, "update", sent("Update"));

        assert_eq!(
            portal.invoke(&mut notifications, shown, DEFAULT_ACTION),
            None
        );
        assert_eq!(notifications.items().len(), 1);
        assert!(portal.owns(shown));
    }

    #[test]
    fn removing_takes_it_out_of_the_history() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        let shown = add(&mut portal, &mut notifications, "update", sent("Update"));

        assert!(!portal.remove(&mut notifications, "org.example.Other", "update"));
        assert!(portal.remove(&mut notifications, "org.example.App", "update"));
        assert!(!portal.remove(&mut notifications, "org.example.App", "update"));
        assert_eq!(notifications.items(), []);
        assert!(!portal.owns(shown));
    }

    #[test]
    fn one_cleared_from_the_history_is_forgotten() {
        let (mut portal, mut notifications) = (PortalNotifications::default(), held());
        let shown = add(&mut portal, &mut notifications, "update", sent("Update"));
        notifications.dismiss(&[shown]);

        assert!(portal.forget(shown));
        assert!(!portal.forget(shown));
        assert_eq!(
            add(&mut portal, &mut notifications, "update", sent("Again")),
            shown + 1
        );
    }
}
