//! Resolves desktop-entry icon names to `data:` URLs for the launcher, along
//! with the image an entry's `X-Domicile-Preview` names.
//!
//! Follows the icon theme spec: `icons/hicolor/<size>/apps/<name>.<ext>` under
//! each data directory, then `pixmaps/<name>.<ext>`. Only `hicolor` is
//! searched, since every application installs into it and every theme
//! inherits it.
//!
//! Each name is resolved once, misses included, and cached for the life of the
//! compositor. A lookup probes every size in every directory, and a search
//! asks for every matched application's icon.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::data_url::data_url;

/// Icon sizes to try, most preferred first. The first few are large enough
/// for the preview and small enough to send on each keystroke.
const SIZES: &[&str] = &[
    "48x48", "64x64", "32x32", "96x96", "128x128", "scalable", "256x256", "24x24", "22x22",
    "16x16", "512x512",
];

/// Supported extensions and their MIME types.
pub(crate) const KINDS: &[(&str, &str)] = &[("png", "image/png"), ("svg", "image/svg+xml")];

/// Largest icon file sent. Matched icons are sent on each keystroke, so a
/// larger file is dropped to keep the launcher responsive.
const LARGEST: u64 = 128 * 1024;

/// Cached icon lookup over a list of data directories.
pub struct AppIcons {
    data_dirs: Vec<PathBuf>,
    found: HashMap<String, Option<String>>,
}

impl AppIcons {
    /// Searches `data_dirs` in priority order, highest first.
    pub fn new(data_dirs: Vec<PathBuf>) -> Self {
        AppIcons {
            data_dirs,
            found: HashMap::new(),
        }
    }

    /// Returns the icon `name` as a `data:` URL, or `None` if none is usable.
    ///
    /// An absolute `name` is read as a file path, as the spec allows.
    pub fn icon(&mut self, name: &str) -> Option<String> {
        if let Some(found) = self.found.get(name) {
            return found.clone();
        }
        let found = self.look_for(name);
        self.found.insert(name.to_string(), found.clone());
        found
    }

    fn look_for(&self, name: &str) -> Option<String> {
        if Path::new(name).is_absolute() {
            return read(Path::new(name));
        }
        let themed = self.data_dirs.iter().flat_map(|dir| {
            SIZES
                .iter()
                .map(move |size| dir.join("icons/hicolor").join(size).join("apps"))
        });
        let pixmaps = self.data_dirs.iter().map(|dir| dir.join("pixmaps"));
        themed.chain(pixmaps).find_map(|dir| {
            KINDS
                .iter()
                .find_map(|(ext, _)| read(&dir.join(format!("{name}.{ext}"))))
        })
    }
}

/// Reads `path` as a `data:` URL. Returns `None` for a missing, oversized or
/// unsupported file.
pub(crate) fn read(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    let (_, mime) = KINDS.iter().find(|(kind, _)| *kind == ext)?;
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > LARGEST {
        return None;
    }
    Some(data_url(mime, &fs::read(path).ok()?))
}
