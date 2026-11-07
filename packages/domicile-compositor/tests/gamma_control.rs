//! Night-light tools such as gammastep and wl-gammarelay-rs ask for a
//! monitor's gamma through `zwlr_gamma_control_v1`.
//!
//! No engine runs here, so no monitor has gamma: a control fails at once
//! rather than taking ramps that change nothing. Who owns a ramp is unit
//! tested in `src/gamma.rs`; ramps on a lit panel are a hardware check.

mod running;

use std::os::unix::net::UnixStream;

use wayland_client::protocol::{wl_output, wl_registry};
use wayland_client::{Connection, Dispatch, QueueHandle};
use wayland_protocols_wlr::gamma_control::v1::client::{
    zwlr_gamma_control_manager_v1::ZwlrGammaControlManagerV1,
    zwlr_gamma_control_v1::{self, ZwlrGammaControlV1},
};

use crate::running::Compositor;

/// One monitor.
const A_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "only", "size": [320, 240] }] } }
"#;

#[derive(Default)]
struct Client {
    manager: Option<ZwlrGammaControlManagerV1>,
    output: Option<wl_output::WlOutput>,
    sizes: Vec<u32>,
    failed: bool,
}

#[test]
fn a_monitor_with_no_gamma_refuses_a_control() {
    let compositor = Compositor::started_with(A_DISPLAY);
    let socket = UnixStream::connect(compositor.scratch_file(compositor.wayland_display()))
        .expect("the apps' display takes a connection");
    let connection = Connection::from_socket(socket).expect("a Wayland connection");
    let mut queue = connection.new_event_queue();
    connection.display().get_registry(&queue.handle(), ());
    let mut client = Client::default();
    queue.roundtrip(&mut client).expect("globals listed");

    let manager = client
        .manager
        .clone()
        .expect("the compositor advertises zwlr_gamma_control_manager_v1");
    let output = client.output.clone().expect("a wl_output");
    let _control = manager.get_gamma_control(&output, &queue.handle(), ());
    queue.roundtrip(&mut client).expect("the control answered");

    assert!(client.failed, "{}", compositor.complaint());
    assert!(
        client.sizes.is_empty(),
        "no ramp size for a monitor with no gamma"
    );
}

impl Dispatch<wl_registry::WlRegistry, ()> for Client {
    fn event(
        client: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        handle: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name, interface, ..
        } = event
        {
            match interface.as_str() {
                "zwlr_gamma_control_manager_v1" => {
                    client.manager = Some(registry.bind(name, 1, handle, ()));
                }
                "wl_output" => client.output = Some(registry.bind(name, 1, handle, ())),
                _ => {}
            }
        }
    }
}

impl Dispatch<ZwlrGammaControlV1, ()> for Client {
    fn event(
        client: &mut Self,
        _: &ZwlrGammaControlV1,
        event: zwlr_gamma_control_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            zwlr_gamma_control_v1::Event::GammaSize { size } => client.sizes.push(size),
            zwlr_gamma_control_v1::Event::Failed => client.failed = true,
            _ => unreachable!("version 1 has no other events"),
        }
    }
}

wayland_client::delegate_noop!(Client: ignore ZwlrGammaControlManagerV1);
wayland_client::delegate_noop!(Client: ignore wl_output::WlOutput);
