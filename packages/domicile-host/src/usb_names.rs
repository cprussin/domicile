//! Names for the USB devices an application asks to open, as udev knows them.
//!
//! The portal frontend passes each device's udev properties. When they lack
//! the names, they are read from udev's database, `/run/udev/data/c<major>:<minor>`.
//! See `docs/PORTALS.md`.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;

/// A device's vendor and product, from udev `properties`. `None` for a name
/// udev does not have.
pub fn names(properties: &HashMap<String, String>) -> (Option<String>, Option<String>) {
    let named = |database: &str, own: &str| {
        properties
            .get(database)
            .cloned()
            // udev writes the device's own name with `_` for spaces.
            .or_else(|| properties.get(own).map(|name| name.replace('_', " ")))
    };
    (
        named("ID_VENDOR_FROM_DATABASE", "ID_VENDOR"),
        named("ID_MODEL_FROM_DATABASE", "ID_MODEL"),
    )
}

/// The properties udev's database under `data_dir` holds for the character
/// device `major:minor`.
pub fn database_properties(
    data_dir: &Path,
    major: u32,
    minor: u32,
) -> io::Result<HashMap<String, String>> {
    let entry = fs::read_to_string(data_dir.join(format!("c{major}:{minor}")))?;
    Ok(entry
        .lines()
        .filter_map(|line| line.strip_prefix("E:"))
        .filter_map(|property| property.split_once('='))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn properties(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn the_hardware_database_names_win() {
        assert_eq!(
            names(&properties(&[
                ("ID_VENDOR", "Yubico"),
                ("ID_VENDOR_FROM_DATABASE", "Yubico.com"),
                ("ID_MODEL", "YubiKey_OTP+FIDO+CCID"),
                ("ID_MODEL_FROM_DATABASE", "Yubikey 4/5 OTP+U2F+CCID"),
            ])),
            (
                Some("Yubico.com".into()),
                Some("Yubikey 4/5 OTP+U2F+CCID".into())
            )
        );
    }

    #[test]
    fn the_device_s_own_names_are_read_with_spaces() {
        assert_eq!(
            names(&properties(&[("ID_MODEL", "Pro_Controller")])),
            (None, Some("Pro Controller".into()))
        );
    }

    #[test]
    fn the_database_holds_a_device_s_properties() {
        let data = tempfile::tempdir().expect("a directory");
        fs::write(
            data.path().join("c189:3"),
            "S:bus/usb/001/004\nE:ID_VENDOR_FROM_DATABASE=Nintendo Co., Ltd\nE:ID_MODEL=Pro_Controller\nG:uaccess\n",
        )
        .expect("the entry is written");

        let read = database_properties(data.path(), 189, 3).expect("it reads");

        assert_eq!(
            read,
            properties(&[
                ("ID_VENDOR_FROM_DATABASE", "Nintendo Co., Ltd"),
                ("ID_MODEL", "Pro_Controller"),
            ])
        );
    }
}
