//! The desktop's `xdg-desktop-portal` backend: one bus name, one object, every
//! interface Domicile implements.
//!
//! Each interface is a file here that registers on [`OBJECT_PATH`] in
//! [`export`]. One that needs the user calls [`queue::ask`], which pushes the
//! dialog to every chrome as
//! [`HostMessage::PortalRequests`](domicile_protocol::HostMessage::PortalRequests)
//! and waits for the shell's answer. See `docs/architecture/PORTALS.md`.
//!
//! `xdg-desktop-portal` routes to this backend by `XDG_CURRENT_DESKTOP`. It is
//! activated by D-Bus or systemd, so it reads that from their activation
//! environment, not from this process's clients. [`say_which_desktop`] sets it
//! there. This does not re-route a frontend that is already running.
//!
//! Failures (no session bus, name taken) are logged once and leave clients
//! unthemed and their dialogs unanswered; they never stop the compositor.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread;

use domicile_host::data_dirs::data_dirs;
use domicile_protocol::{PortalAnswer, PortalRequest, Theme};
use tracing::{debug, warn};
use zbus::blocking::connection::Builder;

mod access;
mod app_chooser;
mod file_chooser;
mod queue;
mod reply;
mod request;
mod session;
mod settings;
#[cfg(test)]
mod socket_pair;

use access::Access;
use app_chooser::AppChooser;
use file_chooser::FileChooser;
use queue::Queue;
use settings::{color_scheme, Settings};

/// The object path the frontend calls backends at.
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";

/// The bus name this backend owns.
///
/// Owns the backend name, not the frontend's `org.freedesktop.portal.Desktop`,
/// so other portal interfaces still reach their own backends.
const BUS_NAME: &str = "org.freedesktop.impl.portal.desktop.domicile";

/// This desktop's `XDG_CURRENT_DESKTOP` value.
///
/// Must match `UseIn=` in the flake's `domicile.portal`. `.desktop` files'
/// `OnlyShowIn`/`NotShowIn` also match on it. [`say_which_desktop`] sets it
/// for activated services and `client_command` for spawned clients.
pub const CURRENT_DESKTOP: &str = "domicile";

/// Handle for the portal thread: theme changes in, the shell's answers in.
///
/// If the service failed to start, theme changes are dropped and every dialog
/// is refused, so callers need no separate path for a desk without a portal.
#[derive(Clone)]
pub struct Portals {
    told: Sender<Theme>,
    queue: Arc<Queue>,
}

impl Portals {
    /// A handle with no service behind it, for unit tests without a session
    /// bus.
    #[cfg(test)]
    pub fn to_nobody() -> Self {
        // Same state as a service thread that has stopped.
        let (told, _) = channel();
        Portals {
            told,
            queue: Arc::default(),
        }
    }

    /// Tells the desk's clients the current theme. Dropped if no service is
    /// running.
    pub fn announce(&self, theme: Theme) {
        // A closed channel means the service stopped and already logged why.
        let _ = self.told.send(theme);
    }

    /// Publish the pending dialogs through `publish` on every change. See
    /// [`Queue::listen`] for `listening` and `parent`.
    pub fn listen(
        &self,
        publish: impl Fn(Vec<PortalRequest>) + Send + Sync + 'static,
        listening: impl Fn() -> bool + Send + Sync + 'static,
        parent: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) {
        self.queue.listen(publish, listening, parent);
    }

    /// The shell's answer to dialog `id`.
    pub fn answer(&self, id: u32, answer: PortalAnswer) {
        self.queue.answer(id, answer);
    }
}

/// Starts the portal thread with `theme` as the current theme, and sets the
/// activation environment. See [`activation_environment`] for `ours` and
/// `nested_in`.
///
/// Returns without waiting for the bus, so startup never blocks on D-Bus.
pub fn serve(theme: Theme, ours: &str, nested_in: Option<&OsStr>) -> Portals {
    let environment = activation_environment(ours, nested_in);
    let (told, changes) = channel();
    let queue = Arc::<Queue>::default();
    let serving = Arc::clone(&queue);
    thread::spawn(move || {
        // Every failure has the same effect: clients do not follow the theme,
        // and their dialogs go unanswered.
        if let Err(why) = answer(theme, &serving, &environment, &changes) {
            warn!(
                %why,
                "the desktop portal is not being answered; this desktop's \
                 clients will not follow its theme or show its dialogs"
            );
        }
    });
    Portals { told, queue }
}

/// Sets the activation environment, serves the interfaces, and signals each
/// theme change. Returns on failure or when every handle is dropped.
///
/// Sets the environment before taking the name, so it is set even if another
/// desk holds the name.
fn answer(
    theme: Theme,
    queue: &Arc<Queue>,
    environment: &[(&str, String)],
    changes: &Receiver<Theme>,
) -> Result<(), zbus::Error> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data_dirs = data_dirs(
        std::env::var_os("XDG_DATA_HOME"),
        std::env::var_os("XDG_DATA_DIRS"),
        home.as_deref(),
    );
    let home = home.unwrap_or_else(|| "/".into()).display().to_string();
    let connection = export(Builder::session()?, theme, queue, data_dirs, home)?.build()?;
    say_which_desktop(&connection, environment);
    connection.request_name(BUS_NAME)?;
    debug!(
        name = BUS_NAME,
        scheme = color_scheme(theme),
        "this desktop answers the desktop portal, so its clients follow its theme"
    );
    let served = connection
        .object_server()
        .interface::<_, Settings>(OBJECT_PATH)?;
    // Ends when every `Portals` is dropped.
    for next in changes {
        settings::changed(&served, next)?;
    }
    Ok(())
}

/// Registers every interface at [`OBJECT_PATH`].
///
/// On the builder, so the interfaces are there before the first call can
/// arrive.
///
/// `data_dirs` are where `FileChooser` finds MIME types, and `home` is the
/// user's home directory.
fn export<'a>(
    builder: Builder<'a>,
    theme: Theme,
    queue: &Arc<Queue>,
    data_dirs: Vec<PathBuf>,
    home: String,
) -> zbus::Result<Builder<'a>> {
    builder
        .serve_at(OBJECT_PATH, Settings { theme })?
        .serve_at(
            OBJECT_PATH,
            Access {
                queue: Arc::clone(queue),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            AppChooser {
                queue: Arc::clone(queue),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            FileChooser {
                queue: Arc::clone(queue),
                data_dirs,
                home,
            },
        )
}

/// The variables [`say_which_desktop`] sets for activated services.
///
/// Sets `XDG_CURRENT_DESKTOP` and `WAYLAND_DISPLAY` (`ours`) only when this
/// desk is the session. When nested in another session (`nested_in` is the
/// compositor's own non-empty `WAYLAND_DISPLAY`), sets nothing: that session
/// owns its activated apps and portal routing. The activation environment is
/// per user, so the last session to start wins, as with
/// `dbus-update-activation-environment`. The supervisor sets the same values
/// in `domicile_launch::graphical_session`.
fn activation_environment(ours: &str, nested_in: Option<&OsStr>) -> Vec<(&'static str, String)> {
    match nested_in.filter(|display| !display.is_empty()) {
        Some(_) => Vec::new(),
        None => vec![
            ("XDG_CURRENT_DESKTOP", CURRENT_DESKTOP.to_string()),
            ("WAYLAND_DISPLAY", ours.to_string()),
        ],
    }
}

/// Sets [`activation_environment`] in the D-Bus and systemd user activation
/// environments, like `dbus-update-activation-environment --systemd`.
///
/// Without this `xdg-desktop-portal` never routes to this backend. Both calls
/// are best effort and log at `debug`: a desk without a systemd user manager
/// is normal.
fn say_which_desktop(connection: &zbus::blocking::Connection, environment: &[(&str, String)]) {
    // For services D-Bus starts directly.
    let bus = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
    );
    let told_the_bus = bus.and_then(|bus| {
        bus.call::<_, _, ()>(
            "UpdateActivationEnvironment",
            &(environment
                .iter()
                .map(|(key, value)| (*key, value.as_str()))
                .collect::<HashMap<_, _>>(),),
        )
    });
    if let Err(why) = told_the_bus {
        tracing::debug!(%why, "the session bus would not take this desktop's name");
    }

    // For services started as systemd user units, which is how most
    // distributions start the portal frontend.
    let systemd = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
    );
    let told_systemd = systemd.and_then(|systemd| {
        systemd.call::<_, _, ()>(
            "SetEnvironment",
            &(environment
                .iter()
                .map(|(key, value)| format!("{key}={value}"))
                .collect::<Vec<_>>(),),
        )
    });
    if let Err(why) = told_systemd {
        tracing::debug!(%why, "no systemd user manager to tell this desktop's name to");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use domicile_protocol::{AccessDialog, AppChooserDialog, FileChooserAnswer, PortalKind};
    use zbus::zvariant::{ObjectPath, OwnedValue, Value};

    /// The frontend's handle for the dialog these tests open.
    const HANDLE: &str = "/org/freedesktop/portal/desktop/request/1_7/t";

    /// The interfaces served to a client, and what the queue publishes.
    struct Served {
        client: zbus::blocking::Connection,
        queue: Arc<Queue>,
        published: Receiver<Vec<PortalRequest>>,
        // Held so the client's peer stays up.
        _server: zbus::blocking::Connection,
    }

    fn served(listening: bool) -> Served {
        let queue = Arc::<Queue>::default();
        let (publish, published) = channel();
        queue.listen(
            move |items| {
                let _ = publish.send(items);
            },
            move || listening,
            |parent_window| (parent_window == "wayland:abc").then(|| "app-3".to_string()),
        );
        let (server, client) = socket_pair::connected(|builder| {
            export(builder, Theme::Dark, &queue, Vec::new(), "/home/me".into())
                .expect("the interfaces registered")
        });
        Served {
            client,
            queue,
            published,
            _server: server,
        }
    }

    /// Call `AccessDialog` from another thread, returning its response.
    fn ask_for_access(client: &zbus::blocking::Connection) -> thread::JoinHandle<u32> {
        let client = client.clone();
        thread::spawn(move || {
            let options = HashMap::from([(
                "grant_label".to_string(),
                OwnedValue::try_from(Value::from("Allow")).expect("ownable"),
            )]);
            let reply = client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.Access"),
                    "AccessDialog",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.App",
                        "wayland:abc",
                        "Use the camera?",
                        "",
                        "",
                        options,
                    ),
                )
                .expect("AccessDialog answered");
            let (response, results): (u32, HashMap<String, OwnedValue>) =
                reply.body().deserialize().expect("its reply");
            assert!(results.is_empty());
            response
        })
    }

    #[track_caller]
    fn next(published: &Receiver<Vec<PortalRequest>>) -> Vec<PortalRequest> {
        published
            .recv_timeout(Duration::from_secs(10))
            .expect("the queue published")
    }

    #[test]
    fn an_access_dialog_waits_for_the_shell_over_its_parent_and_takes_its_answer() {
        let served = served(true);
        let asking = ask_for_access(&served.client);

        assert_eq!(
            next(&served.published),
            [PortalRequest {
                id: 1,
                app_id: "org.example.App".into(),
                parent_app_id: Some("app-3".into()),
                kind: PortalKind::Access(AccessDialog {
                    title: "Use the camera?".into(),
                    subtitle: String::new(),
                    body: String::new(),
                    grant_label: Some("Allow".into()),
                    deny_label: None,
                }),
            }]
        );
        served.queue.answer(1, PortalAnswer::Access);

        assert_eq!(asking.join().expect("the call returned"), 0);
        assert_eq!(next(&served.published), []);
    }

    #[test]
    fn a_dismissed_dialog_answers_one() {
        let served = served(true);
        let asking = ask_for_access(&served.client);
        next(&served.published);
        served.queue.answer(1, PortalAnswer::Canceled);

        assert_eq!(asking.join().expect("the call returned"), 1);
    }

    #[test]
    fn an_application_that_closes_its_request_takes_the_dialog_down() {
        let served = served(true);
        let asking = ask_for_access(&served.client);
        next(&served.published);

        served
            .client
            .call_method(
                None::<&str>,
                HANDLE,
                Some("org.freedesktop.impl.portal.Request"),
                "Close",
                &(),
            )
            .expect("Close answered");

        assert_eq!(next(&served.published), []);
        assert_eq!(asking.join().expect("the call returned"), 2);
    }

    #[test]
    fn a_dialog_nobody_listens_for_is_refused_at_once() {
        let served = served(false);

        assert_eq!(
            ask_for_access(&served.client)
                .join()
                .expect("the call returned"),
            2
        );
        assert!(
            served.published.try_iter().all(|items| items.is_empty()),
            "nothing reached the shell"
        );
    }

    /// Call `ChooseApplication` over `wayland:abc` from another thread,
    /// returning its reply. `modal` is the option, if sent.
    fn choose_application(
        client: &zbus::blocking::Connection,
        modal: Option<bool>,
    ) -> thread::JoinHandle<(u32, HashMap<String, OwnedValue>)> {
        let client = client.clone();
        thread::spawn(move || {
            let mut options = HashMap::from([
                (
                    "content_type".to_string(),
                    OwnedValue::try_from(Value::from("application/pdf")).expect("ownable"),
                ),
                (
                    "activation_token".to_string(),
                    OwnedValue::try_from(Value::from("token-1")).expect("ownable"),
                ),
            ]);
            if let Some(modal) = modal {
                options.insert(
                    "modal".to_string(),
                    OwnedValue::try_from(Value::from(modal)).expect("ownable"),
                );
            }
            client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.AppChooser"),
                    "ChooseApplication",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.App",
                        "wayland:abc",
                        vec!["org.gnome.Evince"],
                        options,
                    ),
                )
                .expect("ChooseApplication answered")
                .body()
                .deserialize()
                .expect("its reply")
        })
    }

    /// The dialog [`choose_application`] asks for, modal over `app-3`.
    fn pdf_dialog(choices: &[&str]) -> PortalRequest {
        PortalRequest {
            id: 1,
            app_id: "org.example.App".into(),
            parent_app_id: Some("app-3".into()),
            kind: PortalKind::AppChooser(AppChooserDialog {
                choices: choices.iter().map(|choice| choice.to_string()).collect(),
                last_choice: None,
                content_type: Some("application/pdf".into()),
                uri: None,
                filename: None,
            }),
        }
    }

    #[test]
    fn an_application_chosen_after_the_choices_change_is_answered() {
        let served = served(true);
        let choosing = choose_application(&served.client, None);
        assert_eq!(next(&served.published), [pdf_dialog(&["org.gnome.Evince"])]);

        served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.impl.portal.AppChooser"),
                "UpdateChoices",
                &(
                    ObjectPath::try_from(HANDLE).expect("a path"),
                    vec!["org.gnome.Evince", "org.gnome.Papers"],
                ),
            )
            .expect("UpdateChoices answered");
        assert_eq!(
            next(&served.published),
            [pdf_dialog(&["org.gnome.Evince", "org.gnome.Papers"])]
        );
        served.queue.answer(
            1,
            PortalAnswer::AppChooser {
                choice: "org.gnome.Papers".into(),
            },
        );

        let (response, results) = choosing.join().expect("the call returned");
        assert_eq!(response, 0);
        assert_eq!(
            results,
            HashMap::from([
                (
                    "choice".to_string(),
                    OwnedValue::try_from(Value::from("org.gnome.Papers")).expect("ownable"),
                ),
                (
                    "activation_token".to_string(),
                    OwnedValue::try_from(Value::from("token-1")).expect("ownable"),
                ),
            ])
        );
    }

    #[test]
    fn a_dialog_that_need_not_be_modal_goes_over_the_focused_screen() {
        let served = served(true);
        let choosing = choose_application(&served.client, Some(false));

        assert_eq!(
            next(&served.published),
            [PortalRequest {
                parent_app_id: None,
                ..pdf_dialog(&["org.gnome.Evince"])
            }]
        );
        served.queue.answer(1, PortalAnswer::Canceled);
        choosing.join().expect("the call returned");
    }

    #[test]
    fn a_choice_that_was_not_offered_is_not_taken() {
        let served = served(true);
        let choosing = choose_application(&served.client, None);
        next(&served.published);

        served.queue.answer(
            1,
            PortalAnswer::AppChooser {
                choice: "org.example.Evil".into(),
            },
        );
        assert_eq!(next(&served.published).len(), 1, "still waiting");
        served.queue.answer(1, PortalAnswer::Canceled);

        let (response, results) = choosing.join().expect("the call returned");
        assert_eq!((response, results.len()), (1, 0));
    }

    #[test]
    fn a_file_chooser_waits_for_the_shell_and_answers_with_file_uris() {
        let served = served(true);
        let client = served.client.clone();
        let asking = thread::spawn(move || {
            let options = HashMap::from([(
                "multiple".to_string(),
                OwnedValue::try_from(Value::from(true)).expect("ownable"),
            )]);
            let reply = client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.FileChooser"),
                    "OpenFile",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.Editor",
                        "",
                        "Open Notes",
                        options,
                    ),
                )
                .expect("OpenFile answered");
            let (response, results): (u32, HashMap<String, OwnedValue>) =
                reply.body().deserialize().expect("its reply");
            (
                response,
                Vec::<String>::try_from(results["uris"].try_clone().expect("cloned"))
                    .expect("uris"),
            )
        });

        let [request] = &next(&served.published)[..] else {
            panic!("one request");
        };
        let PortalKind::FileChooser(dialog) = &request.kind else {
            panic!("a file chooser: {request:?}");
        };
        assert_eq!(
            (dialog.title.as_str(), dialog.multiple),
            ("Open Notes", true)
        );
        served.queue.answer(
            request.id,
            PortalAnswer::FileChooser(FileChooserAnswer {
                paths: vec!["/home/me/a.txt".into(), "/home/me/b.txt".into()],
                choices: Default::default(),
                current_filter: None,
            }),
        );

        assert_eq!(
            asking.join().expect("the call returned"),
            (
                0,
                vec![
                    "file:///home/me/a.txt".to_string(),
                    "file:///home/me/b.txt".to_string()
                ]
            )
        );
    }

    #[test]
    fn a_desk_that_is_the_session_is_where_activated_apps_open() {
        // Activated apps open on the `WAYLAND_DISPLAY` in the activation
        // environment, which another session may have set.
        assert_eq!(
            activation_environment("wayland-1", None),
            [
                ("XDG_CURRENT_DESKTOP", CURRENT_DESKTOP.to_string()),
                ("WAYLAND_DISPLAY", "wayland-1".to_string()),
            ]
        );
    }

    #[test]
    fn a_desk_in_a_window_leaves_its_sessions_activation_environment_alone() {
        // The outer session owns its activated apps and portal routing.
        assert_eq!(
            activation_environment("wayland-1", Some(OsStr::new("wayland-0"))),
            []
        );
    }

    #[test]
    fn an_empty_display_is_no_session() {
        // As in `domicile_launch::platform`, an empty `WAYLAND_DISPLAY` means
        // the drm platform, so this desk is the session.
        assert_eq!(
            activation_environment("wayland-1", Some(OsStr::new(""))),
            activation_environment("wayland-1", None)
        );
    }
}
