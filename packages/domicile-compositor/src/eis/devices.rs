//! Which devices an EIS client gets.
//!
//! A session is granted some input. The seat offers only that, and a client
//! that binds more gets devices for the granted part alone. The client cannot
//! send events of a kind it has no device for: `reis` refuses an interface the
//! seat never offered. So the grant is enforced here, once.

use reis::enumflags2::BitFlags;
use reis::request::DeviceCapability;

/// The input a session was granted.
///
/// The RemoteDesktop and InputCapture backends fill this from what the user
/// allowed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Capabilities {
    /// A pointer that moves by deltas, with buttons and a wheel.
    pub pointer: bool,
    /// A pointer that jumps to points on the displays, with buttons and a
    /// wheel.
    pub pointer_absolute: bool,
    pub keyboard: bool,
    /// One finger, emulated as the pointer's left button. See
    /// [`crate::eis::translation`].
    pub touch: bool,
}

/// One kind of device a client can be given.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Keyboard,
    Pointer,
    PointerAbsolute,
    Touch,
}

/// Every kind, in the order devices are announced.
const KINDS: [Kind; 4] = [
    Kind::Keyboard,
    Kind::Pointer,
    Kind::PointerAbsolute,
    Kind::Touch,
];

impl Capabilities {
    /// What the seat offers: the grant, with buttons and scrolling for either
    /// pointer.
    pub fn offered(self) -> BitFlags<DeviceCapability> {
        KINDS
            .into_iter()
            .filter(|kind| self.grants(*kind))
            .map(Kind::capabilities)
            .fold(BitFlags::empty(), |all, more| all | more)
    }

    fn grants(self, kind: Kind) -> bool {
        match kind {
            Kind::Keyboard => self.keyboard,
            Kind::Pointer => self.pointer,
            Kind::PointerAbsolute => self.pointer_absolute,
            Kind::Touch => self.touch,
        }
    }
}

/// The devices for what a client bound: each granted kind it asked for.
pub fn devices(granted: Capabilities, bound: BitFlags<DeviceCapability>) -> Vec<Kind> {
    KINDS
        .into_iter()
        .filter(|kind| granted.grants(*kind) && bound.contains(kind.main()))
        .collect()
}

impl Kind {
    /// The device's name, as the client sees it.
    pub fn name(self) -> &'static str {
        match self {
            Kind::Keyboard => "keyboard",
            Kind::Pointer => "pointer",
            Kind::PointerAbsolute => "absolute pointer",
            Kind::Touch => "touchscreen",
        }
    }

    /// Every interface the device carries.
    pub fn capabilities(self) -> BitFlags<DeviceCapability> {
        match self {
            Kind::Pointer | Kind::PointerAbsolute => {
                self.main() | DeviceCapability::Button | DeviceCapability::Scroll
            }
            Kind::Keyboard | Kind::Touch => self.main().into(),
        }
    }

    /// Whether the device addresses points on the displays, and so carries
    /// their regions.
    pub fn has_regions(self) -> bool {
        match self {
            Kind::PointerAbsolute | Kind::Touch => true,
            Kind::Pointer | Kind::Keyboard => false,
        }
    }

    /// The capability a client binds to get this device.
    fn main(self) -> DeviceCapability {
        match self {
            Kind::Keyboard => DeviceCapability::Keyboard,
            Kind::Pointer => DeviceCapability::Pointer,
            Kind::PointerAbsolute => DeviceCapability::PointerAbsolute,
            Kind::Touch => DeviceCapability::Touch,
        }
    }
}

#[cfg(test)]
mod tests {
    use reis::enumflags2::BitFlags;
    use reis::request::DeviceCapability;

    use super::{devices, Capabilities, Kind};

    const EVERYTHING: Capabilities = Capabilities {
        pointer: true,
        pointer_absolute: true,
        keyboard: true,
        touch: true,
    };

    #[test]
    fn the_seat_offers_only_the_grant() {
        let keyboard = Capabilities {
            keyboard: true,
            ..Capabilities::default()
        };
        assert_eq!(keyboard.offered(), DeviceCapability::Keyboard);
    }

    #[test]
    fn a_granted_pointer_comes_with_buttons_and_a_wheel() {
        let pointer = Capabilities {
            pointer_absolute: true,
            ..Capabilities::default()
        };
        assert_eq!(
            pointer.offered(),
            DeviceCapability::PointerAbsolute | DeviceCapability::Button | DeviceCapability::Scroll
        );
    }

    #[test]
    fn a_client_gets_a_device_for_each_granted_kind_it_bound() {
        assert_eq!(
            devices(EVERYTHING, BitFlags::all()),
            [
                Kind::Keyboard,
                Kind::Pointer,
                Kind::PointerAbsolute,
                Kind::Touch
            ]
        );
        assert_eq!(
            devices(EVERYTHING, DeviceCapability::Keyboard.into()),
            [Kind::Keyboard],
            "and none it did not bind"
        );
    }

    #[test]
    fn binding_what_was_not_granted_gets_nothing() {
        let keyboard = Capabilities {
            keyboard: true,
            ..Capabilities::default()
        };
        assert_eq!(
            devices(
                keyboard,
                DeviceCapability::Keyboard | DeviceCapability::Pointer | DeviceCapability::Touch
            ),
            [Kind::Keyboard]
        );
    }

    #[test]
    fn only_devices_that_point_at_the_displays_carry_regions() {
        assert!(Kind::PointerAbsolute.has_regions());
        assert!(Kind::Touch.has_regions());
        assert!(!Kind::Pointer.has_regions());
        assert!(!Kind::Keyboard.has_regions());
    }
}
