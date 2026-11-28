//! `org.freedesktop.impl.portal.Lockdown`: what the config's `lockdown`
//! section asks applications not to do. Applications enforce it themselves.

use std::collections::HashMap;

use domicile_config::LockdownConfig;
use zbus::fdo::Properties;
use zbus::object_server::Interface;
use zbus::Variant;

/// The `Lockdown` backend object. Its properties are read-only: the config
/// file sets them.
pub struct Lockdown {
    pub config: LockdownConfig,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Lockdown")]
impl Lockdown {
    #[zbus(property, name = "disable-printing")]
    fn disable_printing(&self) -> bool {
        self.config.disable_printing
    }

    #[zbus(property, name = "disable-save-to-disk")]
    fn disable_save_to_disk(&self) -> bool {
        self.config.disable_save_to_disk
    }

    #[zbus(property, name = "disable-application-handlers")]
    fn disable_application_handlers(&self) -> bool {
        self.config.disable_application_handlers
    }

    #[zbus(property, name = "disable-location")]
    fn disable_location(&self) -> bool {
        self.config.disable_location
    }

    #[zbus(property, name = "disable-camera")]
    fn disable_camera(&self) -> bool {
        self.config.disable_camera
    }

    #[zbus(property, name = "disable-microphone")]
    fn disable_microphone(&self) -> bool {
        self.config.disable_microphone
    }

    #[zbus(property, name = "disable-sound-output")]
    fn disable_sound_output(&self) -> bool {
        self.config.disable_sound_output
    }
}

/// Stores `next` and signals every property in one `PropertiesChanged`.
pub fn changed(
    served: &zbus::object_server::InterfaceRef<Lockdown>,
    next: LockdownConfig,
) -> zbus::Result<()> {
    // Release the lock before the signal is sent.
    {
        zbus::block_on(served.get_mut()).config = next.clone();
    }
    let switches = HashMap::from([
        ("disable-printing", Variant::from(next.disable_printing)),
        (
            "disable-save-to-disk",
            Variant::from(next.disable_save_to_disk),
        ),
        (
            "disable-application-handlers",
            Variant::from(next.disable_application_handlers),
        ),
        ("disable-location", Variant::from(next.disable_location)),
        ("disable-camera", Variant::from(next.disable_camera)),
        ("disable-microphone", Variant::from(next.disable_microphone)),
        (
            "disable-sound-output",
            Variant::from(next.disable_sound_output),
        ),
    ]);
    zbus::block_on(Properties::properties_changed(
        served.signal_emitter(),
        Lockdown::name(),
        switches,
        Default::default(),
    ))
}
