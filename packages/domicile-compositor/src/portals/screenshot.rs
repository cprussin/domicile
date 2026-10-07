//! `org.freedesktop.impl.portal.Screenshot`: a PNG of the desk, or the color
//! of one pixel of it.
//!
//! Each call takes one frame of the whole desk (see
//! [`crate::casting::Casting::shoot`]). An interactive screenshot and
//! `PickColor` freeze that frame in the shell, which answers with the area or
//! pixel the user picked. See `packages/domicile-compositor/src/portals/README.md`.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use domicile_host::data_url::data_url;
use domicile_host::screenshot::{
    color_at, crop, encode, file_name, save, screenshots_dir, Shot, Taken,
};
use domicile_protocol::{AccessDialog, FrozenDesk, PortalAnswer, PortalKind, ShotRect};
use tracing::warn;
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Queue};
use super::uri::file_uri;
use crate::casting::{Casting, Desk};

/// Takes a frame of the whole desk, or says why it cannot.
pub type Shoot =
    Box<dyn Fn() -> Pin<Box<dyn Future<Output = Result<Desk, String>> + Send>> + Send + Sync>;

/// Saves a screenshot as a PNG and returns its path, or says why it cannot.
pub type Save = Box<dyn Fn(&Shot) -> Result<PathBuf, String> + Send + Sync>;

/// The frontend's permission store, where the user's answers are kept.
const PERMISSION_STORE: &str = "org.freedesktop.impl.portal.PermissionStore";
const PERMISSION_STORE_PATH: &str = "/org/freedesktop/impl/portal/PermissionStore";

/// The store's table and id for screenshots, as the frontend names them.
const TABLE: &str = "screenshot";

/// The `Screenshot` backend object.
pub struct Screenshot {
    pub queue: Arc<Queue>,
    pub shoot: Shoot,
    pub save: Save,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Screenshot")]
impl Screenshot {
    /// Saves a screenshot and answers with its `file://` URI. An interactive
    /// one keeps the area the user picks.
    ///
    /// A frontend that has not checked the `PermissionStore` itself
    /// (`permission_store_checked`) leaves it to the backend: a
    /// non-interactive screenshot then asks the user once per application.
    async fn screenshot(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        #[zbus(connection)] connection: &zbus::Connection,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let interactive = flag(&options, "interactive");
        let checked = flag(&options, "permission_store_checked");
        let taken = async {
            if !interactive && !checked {
                self.permit(server, connection, &handle, &app_id, &parent_window)
                    .await?;
            }
            let desk = self.desk().await?;
            let area = if interactive {
                let frozen = frozen(&desk);
                match ask(
                    &self.queue,
                    server,
                    handle,
                    app_id,
                    &parent_window,
                    PortalKind::Screenshot(frozen),
                )
                .await
                {
                    PortalAnswer::Screenshot { area } => area,
                    answer => return Err(answer.response().max(1)),
                }
            } else {
                whole(&desk.shot)
            };
            let path = (self.save)(&crop(&desk.shot, area)).map_err(|why| -> u32 {
                warn!(%why, "a screenshot could not be saved");
                2
            })?;
            Ok(file_uri(&path.display().to_string()))
        };
        match taken.await {
            Ok(uri) => (
                0,
                HashMap::from([("uri".to_string(), owned(Value::from(uri)))]),
            ),
            Err(response) => (response, HashMap::new()),
        }
    }

    /// Answers with the color of the pixel the user picks, as sRGB `(ddd)`
    /// from 0 to 1.
    async fn pick_color(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        _options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let picked = async {
            let desk = self.desk().await?;
            let kind = PortalKind::PickColor(frozen(&desk));
            match ask(&self.queue, server, handle, app_id, &parent_window, kind).await {
                PortalAnswer::PickColor { x, y } => Ok(color_at(&desk.shot, x, y)),
                answer => Err(answer.response().max(1)),
            }
        };
        match picked.await {
            Ok(color) => (
                0,
                HashMap::from([("color".to_string(), owned(Value::from(color)))]),
            ),
            Err(response) => (response, HashMap::new()),
        }
    }

    #[zbus(property(emits_changed_signal = "const"), name = "version")]
    fn version(&self) -> u32 {
        2
    }
}

impl Screenshot {
    /// A frame of the desk, or response `2`.
    async fn desk(&self) -> Result<Desk, u32> {
        (self.shoot)().await.map_err(|why| {
            warn!(%why, "the desk could not be shot for a screenshot");
            2
        })
    }

    /// Whether `app_id` may take a screenshot without picking it: the
    /// user's answer in the permission store on `connection`, else theirs
    /// now, which is kept there. `Err(2)` when not.
    async fn permit(
        &self,
        server: &ObjectServer,
        connection: &zbus::Connection,
        handle: &OwnedObjectPath,
        app_id: &str,
        parent_window: &str,
    ) -> Result<(), u32> {
        let allowed = match kept(connection, app_id).await {
            Some(allowed) => allowed,
            None => {
                let answer = ask(
                    &self.queue,
                    server,
                    handle.clone(),
                    app_id.to_string(),
                    parent_window,
                    PortalKind::Access(AccessDialog {
                        title: "Allow screenshots?".into(),
                        subtitle: "It will see everything on your screens, without asking again."
                            .into(),
                        body: String::new(),
                        grant_label: Some("Allow".into()),
                        deny_label: None,
                    }),
                )
                .await;
                match answer {
                    PortalAnswer::Access => {
                        keep(connection, app_id, true).await;
                        true
                    }
                    PortalAnswer::Canceled => {
                        keep(connection, app_id, false).await;
                        false
                    }
                    // No shell answered: ask again next time.
                    _ => false,
                }
            }
        };
        if allowed {
            Ok(())
        } else {
            Err(2)
        }
    }
}

/// The answer the permission store keeps for `app_id`, or `None` if the user
/// was never asked. A store that cannot be read is logged, and the user is
/// asked.
async fn kept(connection: &zbus::Connection, app_id: &str) -> Option<bool> {
    let looked_up = connection
        .call_method(
            Some(PERMISSION_STORE),
            PERMISSION_STORE_PATH,
            Some(PERMISSION_STORE),
            "Lookup",
            &(TABLE, TABLE),
        )
        .await
        .and_then(|reply| {
            Ok(reply
                .body()
                .deserialize::<(HashMap<String, Vec<String>>, OwnedValue)>()?
                .0)
        });
    match looked_up {
        Ok(permissions) => permissions
            .get(app_id)
            .and_then(|kept| kept.first())
            .map(|kept| kept == "yes"),
        // No application was ever asked.
        Err(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.freedesktop.portal.Error.NotFound" =>
        {
            None
        }
        Err(why) => {
            warn!(%why, "the permission store could not be read; asking about screenshots again");
            None
        }
    }
}

/// Keeps the user's answer for `app_id` in the permission store. One that
/// cannot be kept is logged, and asked again next time.
async fn keep(connection: &zbus::Connection, app_id: &str, allowed: bool) {
    let answer = if allowed { "yes" } else { "no" };
    let kept = connection
        .call_method(
            Some(PERMISSION_STORE),
            PERMISSION_STORE_PATH,
            Some(PERMISSION_STORE),
            "SetPermission",
            &(TABLE, true, TABLE, app_id, vec![answer]),
        )
        .await;
    if let Err(why) = kept {
        warn!(%why, "the permission store did not keep a screenshot answer; it will be asked again");
    }
}

/// A [`Shoot`] that takes its frames through `casting`.
pub fn shooting(casting: Casting) -> Shoot {
    Box::new(move || {
        let (replier, developed) = crate::reply::reply();
        casting.shoot(Box::new(move |desk| replier.send(desk)));
        Box::pin(async move {
            developed
                .await
                .unwrap_or_else(|| Err("the compositor dropped the shot".into()))
        })
    })
}

/// A [`Save`] into `Screenshots` in the user's pictures folder, found again
/// on each screenshot.
pub fn in_pictures() -> Save {
    saving_into(|| {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/".into()));
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        let user_dirs = std::fs::read_to_string(config.join("user-dirs.dirs")).ok();
        screenshots_dir(user_dirs.as_deref(), &home)
    })
}

/// A [`Save`] into the folder `dir` names, named for the local time.
fn saving_into(dir: impl Fn() -> PathBuf + Send + Sync + 'static) -> Save {
    Box::new(move |shot| {
        save(&dir(), &file_name(now()), &encode(shot)).map_err(|why| why.to_string())
    })
}

/// The local time now.
fn now() -> Taken {
    // SAFETY: `time` with a null argument only returns the time.
    let seconds = unsafe { libc::time(std::ptr::null_mut()) };
    // SAFETY: all-zero is a valid `tm`, filled below.
    let mut local: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: both pointers are to live locals.
    unsafe { libc::localtime_r(&seconds, &mut local) };
    Taken {
        year: local.tm_year + 1900,
        month: (local.tm_mon + 1) as u32,
        day: local.tm_mday as u32,
        hour: local.tm_hour as u32,
        minute: local.tm_min as u32,
        second: local.tm_sec as u32,
    }
}

/// `desk` as the shell's picker shows it.
fn frozen(desk: &Desk) -> FrozenDesk {
    FrozenDesk {
        frame: data_url("image/png", &encode(&desk.shot)),
        width: desk.shot.width,
        height: desk.shot.height,
        monitors: desk.monitors.clone(),
        windows: desk.windows.clone(),
    }
}

/// All of `shot`.
fn whole(shot: &Shot) -> ShotRect {
    ShotRect {
        x: 0,
        y: 0,
        width: shot.width,
        height: shot.height,
    }
}

/// Whether boolean option `name` is set. Absent, or of another type, is
/// unset.
fn flag(options: &HashMap<String, OwnedValue>, name: &str) -> bool {
    options
        .get(name)
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false)
}

fn owned(value: Value) -> OwnedValue {
    OwnedValue::try_from(value).expect("a string or a tuple of doubles holds no fd")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as Map;
    use std::sync::mpsc::{channel, Receiver};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    use domicile_protocol::{
        AccessDialog, FrozenDesk, PortalAnswer, PortalKind, PortalRequest, ShotArea, ShotRect,
    };
    use zbus::blocking::Connection;
    use zbus::zvariant::{ObjectPath, Value};

    use crate::portals::socket_pair::connected;
    use crate::portals::OBJECT_PATH;

    const INTERFACE: &str = "org.freedesktop.impl.portal.Screenshot";
    const HANDLE: &str = "/org/freedesktop/portal/desktop/request/1_7/s";
    const APP: &str = "org.example.Shooter";

    /// The frontend's permission store, holding the screenshot table: empty
    /// until an answer is kept, as the frontend's is.
    #[derive(Clone, Default)]
    struct Store(Arc<Mutex<Option<Table>>>);

    /// Each application's permissions.
    type Table = Map<String, Vec<String>>;

    #[zbus::interface(name = "org.freedesktop.impl.portal.PermissionStore")]
    impl Store {
        fn lookup(&self, table: String, id: String) -> Result<(Table, OwnedValue), NotFound> {
            assert_eq!((table.as_str(), id.as_str()), (TABLE, TABLE));
            let kept = self
                .0
                .lock()
                .unwrap()
                .clone()
                .ok_or(NotFound::NotFound("no screenshot table".into()))?;
            Ok((kept, owned(Value::from(0u8))))
        }

        fn set_permission(
            &self,
            table: String,
            create: bool,
            id: String,
            app: String,
            permissions: Vec<String>,
        ) {
            assert_eq!((table.as_str(), create, id.as_str()), (TABLE, true, TABLE));
            self.0
                .lock()
                .unwrap()
                .get_or_insert_default()
                .insert(app, permissions);
        }
    }

    /// The store's error for a table it does not have.
    #[derive(Debug, zbus::DBusError)]
    #[zbus(prefix = "org.freedesktop.portal.Error")]
    enum NotFound {
        NotFound(String),
    }

    /// A 2x1 desk: an orange pixel on monitor `left`, then a half-transparent
    /// blue one on `right`, with a window over the second.
    fn desk() -> Desk {
        Desk {
            shot: Shot {
                width: 2,
                height: 1,
                bgra: [[0, 51, 255, 255], [128, 0, 0, 128]].concat(),
            },
            monitors: vec![area("left", 0), area("right", 1)],
            windows: vec![area("Terminal", 1)],
        }
    }

    fn area(name: &str, x: u32) -> ShotArea {
        ShotArea {
            name: name.into(),
            area: ShotRect {
                x,
                y: 0,
                width: 1,
                height: 1,
            },
        }
    }

    struct Served {
        client: Connection,
        queue: Arc<Queue>,
        published: Receiver<Vec<PortalRequest>>,
        store: Store,
        album: tempfile::TempDir,
        _server: Connection,
    }

    /// The backend over a socket pair, shooting `shot` and saving into a
    /// temporary folder.
    fn served(shot: Result<Desk, String>) -> Served {
        let queue = Arc::<Queue>::default();
        let (publish, published) = channel();
        queue.listen(
            move |items, _| {
                let _ = publish.send(items);
            },
            || true,
            |_| None,
        );
        let store = Store::default();
        let album = tempfile::tempdir().expect("a temporary folder");
        let backend = Screenshot {
            queue: Arc::clone(&queue),
            shoot: Box::new(move || {
                let shot = shot.clone();
                Box::pin(async move { shot })
            }),
            save: {
                let dir = album.path().join("Screenshots");
                saving_into(move || dir.clone())
            },
        };
        let (server, client) =
            connected(|builder| builder.serve_at(OBJECT_PATH, backend).expect("served"));
        // The frontend serves its store on the bus; here, the client's end.
        client
            .object_server()
            .at(PERMISSION_STORE_PATH, store.clone())
            .expect("the store served");
        Served {
            client,
            queue,
            published,
            store,
            album,
            _server: server,
        }
    }

    /// Calls `method` with `options` on another thread, returning its reply.
    fn calling(
        served: &Served,
        method: &'static str,
        options: Vec<(&'static str, bool)>,
    ) -> thread::JoinHandle<(u32, Map<String, OwnedValue>)> {
        let client = served.client.clone();
        thread::spawn(move || {
            let options: Map<String, OwnedValue> = options
                .into_iter()
                .map(|(name, on)| {
                    (
                        name.to_string(),
                        OwnedValue::try_from(Value::from(on)).expect("ownable"),
                    )
                })
                .collect();
            client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some(INTERFACE),
                    method,
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        APP,
                        "",
                        options,
                    ),
                )
                .expect("answered")
                .body()
                .deserialize()
                .expect("a response")
        })
    }

    #[track_caller]
    fn next(served: &Served) -> Vec<PortalRequest> {
        served
            .published
            .recv_timeout(Duration::from_secs(10))
            .expect("the queue published")
    }

    /// The PNG `uri` names: its size and straight RGBA pixels.
    fn png_at(uri: &OwnedValue) -> ((u32, u32), Vec<u8>) {
        let uri = String::try_from(uri.try_clone().expect("cloned")).expect("a string");
        // The file names have spaces; the temporary folder's path has no
        // other encoded byte.
        let path = uri
            .strip_prefix("file://")
            .expect("a file URI")
            .replace("%20", " ");
        let decoder = png::Decoder::new(std::io::BufReader::new(
            std::fs::File::open(path).expect("saved"),
        ));
        let mut reader = decoder.read_info().expect("a PNG");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
        let info = reader.next_frame(&mut pixels).expect("a frame");
        ((info.width, info.height), pixels)
    }

    #[test]
    fn a_screenshot_the_frontend_allowed_saves_the_whole_desk() {
        let served = served(Ok(desk()));

        let (response, results) = calling(
            &served,
            "Screenshot",
            vec![("interactive", false), ("permission_store_checked", true)],
        )
        .join()
        .expect("returned");

        assert_eq!(response, 0);
        let (size, pixels) = png_at(&results["uri"]);
        assert_eq!(size, (2, 1));
        assert_eq!(pixels, [[255, 51, 0, 255], [0, 0, 255, 128]].concat());
        let saved: Vec<_> = std::fs::read_dir(served.album.path().join("Screenshots"))
            .expect("the folder was made")
            .collect();
        assert_eq!(saved.len(), 1);
    }

    #[test]
    fn an_unchecked_screenshot_asks_once_and_keeps_the_answer() {
        let served = served(Ok(desk()));
        let first = calling(&served, "Screenshot", Vec::new());

        assert_eq!(
            next(&served),
            [PortalRequest {
                id: 1,
                app_id: APP.into(),
                parent_app_id: None,
                kind: PortalKind::Access(AccessDialog {
                    title: "Allow screenshots?".into(),
                    subtitle: "It will see everything on your screens, without asking again."
                        .into(),
                    body: String::new(),
                    grant_label: Some("Allow".into()),
                    deny_label: None,
                }),
            }]
        );
        served.queue.answer(1, PortalAnswer::Access);
        assert_eq!(first.join().expect("returned").0, 0);
        let second = calling(&served, "Screenshot", Vec::new());

        assert_eq!(second.join().expect("returned").0, 0);
        assert!(
            served.published.try_iter().all(|items| items.is_empty()),
            "asked once"
        );
        assert_eq!(
            served.store.0.lock().unwrap().as_ref().expect("a table")[APP],
            ["yes"]
        );
    }

    #[test]
    fn a_denied_screenshot_saves_nothing_and_is_not_asked_again() {
        let served = served(Ok(desk()));
        let first = calling(&served, "Screenshot", Vec::new());
        next(&served);
        served.queue.answer(1, PortalAnswer::Canceled);

        assert_eq!(first.join().expect("returned").0, 2);
        assert_eq!(
            calling(&served, "Screenshot", Vec::new())
                .join()
                .expect("returned")
                .0,
            2
        );
        assert!(!served.album.path().join("Screenshots").exists());
    }

    #[test]
    fn an_interactive_screenshot_keeps_the_area_the_shell_picked() {
        let served = served(Ok(desk()));
        let picking = calling(&served, "Screenshot", vec![("interactive", true)]);

        let asked = next(&served);
        let PortalKind::Screenshot(FrozenDesk {
            frame,
            width,
            height,
            monitors,
            windows,
        }) = &asked[0].kind
        else {
            panic!("a picker, not {:?}", asked[0].kind);
        };
        assert!(frame.starts_with("data:image/png;base64,"));
        assert_eq!((*width, *height), (2, 1));
        assert_eq!((monitors.len(), windows.len()), (2, 1));
        served.queue.answer(
            asked[0].id,
            PortalAnswer::Screenshot {
                area: windows[0].area,
            },
        );

        let (response, results) = picking.join().expect("returned");
        assert_eq!(response, 0);
        assert_eq!(png_at(&results["uri"]), ((1, 1), vec![0, 0, 255, 128]));
    }

    #[test]
    fn a_dismissed_picker_answers_one() {
        let served = served(Ok(desk()));
        let picking = calling(&served, "Screenshot", vec![("interactive", true)]);
        next(&served);
        served.queue.answer(1, PortalAnswer::Canceled);

        assert_eq!(picking.join().expect("returned").0, 1);
    }

    #[test]
    fn a_picked_color_is_srgb_from_zero_to_one() {
        let served = served(Ok(desk()));
        let picking = calling(&served, "PickColor", Vec::new());

        let asked = next(&served);
        assert!(matches!(asked[0].kind, PortalKind::PickColor(_)));
        served
            .queue
            .answer(asked[0].id, PortalAnswer::PickColor { x: 0, y: 0 });

        let (response, results) = picking.join().expect("returned");
        assert_eq!(response, 0);
        assert_eq!(
            <(f64, f64, f64)>::try_from(results["color"].try_clone().expect("cloned"))
                .expect("(ddd)"),
            (1.0, 0.2, 0.0)
        );
    }

    #[test]
    fn a_desk_that_cannot_be_shot_answers_two() {
        let served = served(Err("no engine".into()));

        let (response, results) = calling(
            &served,
            "Screenshot",
            vec![("permission_store_checked", true)],
        )
        .join()
        .expect("returned");

        assert_eq!(response, 2);
        assert!(results.is_empty());
    }

    #[test]
    fn it_is_version_two() {
        let served = served(Ok(desk()));

        let version: OwnedValue = served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.DBus.Properties"),
                "Get",
                &(INTERFACE, "version"),
            )
            .expect("answered")
            .body()
            .deserialize()
            .expect("a variant");
        let version = u32::try_from(version).expect("a u32");

        assert_eq!(version, 2);
    }
}
