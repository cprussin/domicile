//! AT-SPI's `IsEnabled`, on the session bus: whether apps build
//! accessibility trees. Qt, Firefox and others expose nothing until it is
//! on. See [`super::agent::Accessibility`].

use super::agent::Accessibility;

const BUS: &str = "org.a11y.Bus";
const PATH: &str = "/org/a11y/bus";
const STATUS: &str = "org.a11y.Status";
const ENABLED: &str = "IsEnabled";

/// `IsEnabled` on the session bus's accessibility bus. Without one, apps
/// have no trees to build, so it reads as on and is left alone.
pub fn on_the_session_bus() -> Accessibility {
    Accessibility {
        enabled: Box::new(|| {
            status()
                .and_then(|status| zbus::block_on(status.get_property::<bool>(ENABLED)))
                .unwrap_or_else(|why| {
                    tracing::error!(
                        "apps' accessibility can't be read, so it is left alone: {why}"
                    );
                    true
                })
        }),
        enable: Box::new(|on| {
            if let Err(why) = status().and_then(|status| {
                zbus::block_on(status.set_property(ENABLED, on)).map_err(zbus::Error::from)
            }) {
                tracing::error!(on, "apps' accessibility could not be set: {why}");
            }
        }),
    }
}

fn status() -> zbus::Result<zbus::Proxy<'static>> {
    let connection = zbus::block_on(zbus::Connection::session())?;
    zbus::block_on(zbus::Proxy::new_owned(connection, BUS, PATH, STATUS))
}
