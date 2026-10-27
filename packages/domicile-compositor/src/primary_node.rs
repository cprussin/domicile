//! Finds the primary node (`/dev/dri/card<N>`) of the device behind a render
//! node, for [`crate::gbm`]'s fallback.
//!
//! On a device Mesa has no GBM driver for, such as vgem under WSL2, libgbm
//! falls back to `kms_swrast`, which allocates dumb buffers. The kernel takes
//! the dumb-buffer ioctls only on a primary node, so on the render node every
//! allocation fails. The primary node of the same device allocates, and both
//! nodes are one device's memory.
//!
//! Found by device number, not by name: on a desktop with two cards the match
//! can be `card1`.

use std::fs;
use std::io;
use std::os::unix::fs::{FileTypeExt as _, MetadataExt as _};
use std::path::{Path, PathBuf};

use thiserror::Error;

/// A character device's number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceNumber {
    pub major: u32,
    pub minor: u32,
}

impl DeviceNumber {
    /// The number of the character device at `path`, or `None` if it is
    /// not one.
    pub fn of(path: &Path) -> Option<DeviceNumber> {
        let metadata = fs::metadata(path).ok()?;
        metadata.file_type().is_char_device().then(|| {
            let rdev = metadata.rdev();
            DeviceNumber {
                major: libc::major(rdev),
                minor: libc::minor(rdev),
            }
        })
    }

    /// Reads sysfs's `<major>:<minor>`.
    fn parse(text: &str) -> Option<DeviceNumber> {
        let (major, minor) = text.trim().split_once(':')?;
        Some(DeviceNumber {
            major: major.parse().ok()?,
            minor: minor.parse().ok()?,
        })
    }
}

/// Why no primary node stands beside a render node. Each says which step
/// failed.
#[derive(Debug, Error)]
pub enum NoPrimaryNode {
    #[error("the render node is not a character device")]
    NotADevice,
    #[error("sysfs lists no DRM nodes beside the render node at {dir}: {source}")]
    Unlisted {
        dir: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("sysfs lists no card node beside the render node in {dir}")]
    NoCard { dir: PathBuf },
    #[error("sysfs lists several card nodes beside the render node in {dir}")]
    SeveralCards { dir: PathBuf },
    #[error("sysfs gives no device number for {card} at {dev}")]
    NoNumber { card: String, dev: PathBuf },
    #[error("{node} is not the character device sysfs numbers {card}")]
    Mismatched { node: PathBuf, card: String },
}

/// The primary node in `dri` (`/dev/dri`) of the device whose render node is
/// numbered `render`, found through `sys` (`/sys`). `number_of` reads a
/// node's device number; [`DeviceNumber::of`] outside tests.
pub fn primary_node_of(
    render: DeviceNumber,
    sys: &Path,
    dri: &Path,
    number_of: impl Fn(&Path) -> Option<DeviceNumber>,
) -> Result<PathBuf, NoPrimaryNode> {
    let dir = sys
        .join("dev/char")
        .join(format!("{}:{}", render.major, render.minor))
        .join("device/drm");
    let listed = fs::read_dir(&dir).map_err(|source| NoPrimaryNode::Unlisted {
        dir: dir.clone(),
        source,
    })?;
    let mut cards = listed
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| is_a_card(name));
    let card = cards
        .next()
        .ok_or_else(|| NoPrimaryNode::NoCard { dir: dir.clone() })?;
    if cards.next().is_some() {
        return Err(NoPrimaryNode::SeveralCards { dir });
    }
    let dev = dir.join(&card).join("dev");
    let wanted = fs::read_to_string(&dev)
        .ok()
        .as_deref()
        .and_then(DeviceNumber::parse)
        .ok_or_else(|| NoPrimaryNode::NoNumber {
            card: card.clone(),
            dev,
        })?;
    let node = dri.join(&card);
    if number_of(&node) == Some(wanted) {
        Ok(node)
    } else {
        Err(NoPrimaryNode::Mismatched { node, card })
    }
}

/// Whether `name` is `card<digits>`: a primary node, not a connector such as
/// `card1-HDMI-A-1`.
fn is_a_card(name: &str) -> bool {
    name.strip_prefix("card")
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RENDER: DeviceNumber = DeviceNumber {
        major: 226,
        minor: 128,
    };
    const CARD1: DeviceNumber = DeviceNumber {
        major: 226,
        minor: 1,
    };

    /// A sysfs with the render node's DRM directory holding `nodes`, each
    /// with its `dev`.
    fn sysfs(nodes: &[(&str, &str)]) -> tempfile::TempDir {
        let sys = tempfile::tempdir().expect("a temporary directory");
        let drm = sys.path().join("dev/char/226:128/device/drm");
        fs::create_dir_all(&drm).unwrap();
        for (name, dev) in nodes {
            fs::create_dir(drm.join(name)).unwrap();
            fs::write(drm.join(name).join("dev"), format!("{dev}\n")).unwrap();
        }
        sys
    }

    /// A `/dev/dri` where only `card1` is a device, numbered `CARD1`.
    fn card1_is(number: DeviceNumber) -> impl Fn(&Path) -> Option<DeviceNumber> {
        move |node| (node == Path::new("/dev/dri/card1")).then_some(number)
    }

    #[test]
    fn the_one_card_beside_the_render_node_is_its_primary_node() {
        // A connector directory is no node, and the render node is not one.
        let sys = sysfs(&[
            ("renderD128", "226:128"),
            ("card1", "226:1"),
            ("card1-Virtual-1", "0:0"),
        ]);

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(CARD1));

        assert_eq!(found.unwrap(), PathBuf::from("/dev/dri/card1"));
    }

    #[test]
    fn a_render_node_with_no_card_has_no_primary_node() {
        let sys = sysfs(&[("renderD128", "226:128")]);

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(CARD1));

        assert!(
            matches!(found, Err(NoPrimaryNode::NoCard { .. })),
            "{found:?}"
        );
    }

    #[test]
    fn two_cards_are_too_many_to_pick_from() {
        let sys = sysfs(&[("card0", "226:0"), ("card1", "226:1")]);

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(CARD1));

        assert!(
            matches!(found, Err(NoPrimaryNode::SeveralCards { .. })),
            "{found:?}"
        );
    }

    #[test]
    fn a_node_numbered_unlike_its_card_is_not_it() {
        // `/dev/dri/card1` is another device than sysfs's `card1`, as a
        // container with its own `/dev` can make it.
        let sys = sysfs(&[("card1", "226:1")]);
        let another = DeviceNumber {
            major: 226,
            minor: 0,
        };

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(another));

        assert!(
            matches!(found, Err(NoPrimaryNode::Mismatched { .. })),
            "{found:?}"
        );
    }

    #[test]
    fn a_card_with_no_number_is_not_trusted() {
        let sys = sysfs(&[("card1", "garbled")]);

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(CARD1));

        assert!(
            matches!(found, Err(NoPrimaryNode::NoNumber { .. })),
            "{found:?}"
        );
    }

    #[test]
    fn a_device_sysfs_does_not_know_has_no_primary_node() {
        let sys = tempfile::tempdir().expect("a temporary directory");

        let found = primary_node_of(RENDER, sys.path(), Path::new("/dev/dri"), card1_is(CARD1));

        assert!(
            matches!(found, Err(NoPrimaryNode::Unlisted { .. })),
            "{found:?}"
        );
    }

    #[test]
    fn a_file_is_no_device() {
        let file = tempfile::NamedTempFile::new().expect("a temporary file");

        assert_eq!(DeviceNumber::of(file.path()), None);
        assert_eq!(
            DeviceNumber::of(Path::new("/dev/null")),
            Some(DeviceNumber { major: 1, minor: 3 })
        );
    }
}
