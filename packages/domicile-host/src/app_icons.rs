//! The picture a launcher draws beside an application, as a `data:` URL — and
//! the one its `X-Domicile-Preview` names for the preview, found the same way.
//!
//! A desktop entry names its icon, and the icon theme spec says where a name
//! is: `icons/<theme>/<size>/apps/<name>.<ext>` under each data directory, then
//! `pixmaps/<name>.<ext>`. Only `hicolor` is looked in — it is the theme every
//! application installs into and every other theme inherits, and this desktop
//! has no notion of another one yet.
//!
//! **Cached, and never forgotten.** A search answers for every application it
//! matched, and a name resolves by trying every size in every directory, so
//! each is looked up once for the life of the compositor — a miss included.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::data_url::data_url;

/// The sizes looked through, the one wanted first: big enough for a row on a
/// dense screen and for the preview, and small enough to send on a keystroke.
const SIZES: &[&str] = &[
    "48x48", "64x64", "32x32", "96x96", "128x128", "scalable", "256x256", "24x24", "22x22",
    "16x16", "512x512",
];

/// What a page can draw, and the type it is sent as.
pub(crate) const KINDS: &[(&str, &str)] = &[("png", "image/png"), ("svg", "image/svg+xml")];

/// The biggest file sent. Every icon a search matched crosses on every
/// keystroke, so an icon past this is none rather than a stalled launcher.
const LARGEST: u64 = 128 * 1024;

/// Icons by name, out of the data directories they were looked for in.
pub struct AppIcons {
    data_dirs: Vec<PathBuf>,
    found: HashMap<String, Option<String>>,
}

impl AppIcons {
    /// Icons under `data_dirs`, the one that wins first.
    pub fn new(data_dirs: Vec<PathBuf>) -> Self {
        AppIcons {
            data_dirs,
            found: HashMap::new(),
        }
    }

    /// The icon `name` is, as a `data:` URL, or nothing a page could draw.
    ///
    /// An absolute `name` is that file, which the spec allows an entry to say.
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

/// `path` as a `data:` URL, if it is a kind a page draws and small enough to
/// send. A file that is not there is the ordinary answer to most of the paths
/// a lookup tries.
pub(crate) fn read(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    let (_, mime) = KINDS.iter().find(|(kind, _)| *kind == ext)?;
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > LARGEST {
        return None;
    }
    Some(data_url(mime, &fs::read(path).ok()?))
}
