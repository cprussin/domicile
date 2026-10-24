//! `wp_security_context_v1`: a client that connects through a sandbox's
//! listener sees no privileged globals, and its windows name the sandbox.

mod running;

use std::io::PipeWriter;
use std::os::fd::AsFd as _;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};

use domicile_protocol::{HostMessage, Sandbox};
use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry::{self, WlRegistry};
use wayland_client::{Connection, Dispatch, QueueHandle};
use wayland_protocols::wp::security_context::v1::client::{
    wp_security_context_manager_v1::WpSecurityContextManagerV1,
    wp_security_context_v1::WpSecurityContextV1,
};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The globals only an unsandboxed client sees.
const PRIVILEGED: [&str; 8] = [
    "ext_data_control_manager_v1",
    "zwlr_data_control_manager_v1",
    "ext_image_copy_capture_manager_v1",
    "ext_output_image_capture_source_manager_v1",
    "ext_foreign_toplevel_image_capture_source_manager_v1",
    "ext_foreign_toplevel_list_v1",
    "zwlr_screencopy_manager_v1",
    "wp_security_context_manager_v1",
];

#[test]
fn a_sandboxed_client_sees_no_privileged_globals() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let sandbox = Listener::opened(&compositor.wayland_socket());

    let outside = globals_on(&compositor.wayland_socket());
    let inside = globals_on(&sandbox.path);

    for privileged in PRIVILEGED {
        assert!(
            outside.iter().any(|global| global == privileged),
            "an unsandboxed client should see {privileged}: {outside:?}"
        );
        assert!(
            !inside.iter().any(|global| global == privileged),
            "a sandboxed client should not see {privileged}"
        );
    }
    assert!(
        inside.iter().any(|global| global == "wl_compositor"),
        "a sandboxed client still draws: {inside:?}"
    );
}

#[test]
fn a_sandboxed_window_names_its_sandbox() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let sandbox = Listener::opened(&compositor.wayland_socket());
    let mut chrome = compositor.chrome();
    let client = compositor.client_on(
        sandbox.path.to_str().expect("a temporary path is UTF-8"),
        "a sandboxed window",
    );

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .unwrap_or_else(|_| {
            panic!(
                "the sandboxed client's window was never announced; it traced:\n{}",
                client.trace()
            )
        });
    let HostMessage::AppAppeared { owner, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    assert_eq!(owner.pid, client.pid() as i32);
    assert_eq!(
        owner.sandbox,
        Some(Sandbox {
            engine: Some("org.example.sandbox".to_string()),
            app_id: Some("org.example.App".to_string()),
            instance_id: Some("1".to_string()),
        })
    );
}

/// A security context's listener, open while this lives.
struct Listener {
    path: PathBuf,
    _directory: tempfile::TempDir,
    /// Closing it closes the listener.
    _close: PipeWriter,
    _creator: Connection,
}

impl Listener {
    /// Asks the compositor at `socket` for a listener in a sandbox.
    fn opened(socket: &Path) -> Listener {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let path = directory.path().join("sandbox");
        let listening = UnixListener::bind(&path).expect("the listener binds");
        let (closed, close) = std::io::pipe().expect("a pipe");

        let creator = Connection::from_socket(UnixStream::connect(socket).expect("it connects"))
            .expect("a Wayland connection");
        let (globals, mut queue) =
            registry_queue_init::<Globals>(&creator).expect("the registry lists");
        let manager: WpSecurityContextManagerV1 = globals
            .bind(&queue.handle(), 1..=1, ())
            .expect("the compositor offers wp_security_context_manager_v1");
        let context =
            manager.create_listener(listening.as_fd(), closed.as_fd(), &queue.handle(), ());
        context.set_sandbox_engine("org.example.sandbox".to_string());
        context.set_app_id("org.example.App".to_string());
        context.set_instance_id("1".to_string());
        context.commit();
        queue
            .roundtrip(&mut Globals)
            .expect("the compositor took the context");

        Listener {
            path,
            _directory: directory,
            _close: close,
            _creator: creator,
        }
    }
}

/// The interfaces a client connected to `socket` is offered.
fn globals_on(socket: &Path) -> Vec<String> {
    let connection = Connection::from_socket(UnixStream::connect(socket).expect("it connects"))
        .expect("a Wayland connection");
    let (globals, _queue) =
        registry_queue_init::<Globals>(&connection).expect("the registry lists");
    globals
        .contents()
        .clone_list()
        .into_iter()
        .map(|global| global.interface)
        .collect()
}

/// A client that only reads the registry.
struct Globals;

impl Dispatch<WlRegistry, GlobalListContents> for Globals {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WpSecurityContextManagerV1, ()> for Globals {
    fn event(
        _: &mut Self,
        _: &WpSecurityContextManagerV1,
        _: <WpSecurityContextManagerV1 as wayland_client::Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WpSecurityContextV1, ()> for Globals {
    fn event(
        _: &mut Self,
        _: &WpSecurityContextV1,
        _: <WpSecurityContextV1 as wayland_client::Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
