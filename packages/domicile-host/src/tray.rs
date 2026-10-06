//! StatusNotifierItem state for the system tray.
//!
//! The D-Bus side lives in `domicile-compositor`'s `tray` module. It passes
//! each item's [`Properties`] here and sends shells the resulting
//! [`TrayItem`]s. Icons become `data:` URLs. See
//! `docs/architecture/SYSTEM-TRAY.md`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use domicile_protocol::{TrayAction, TrayItem};

use crate::data_url::data_url;
use crate::png::png;

/// The object path of an item registered by bus name alone.
const ITEM_PATH: &str = "/StatusNotifierItem";

/// The preferred pixmap width: a tray icon's size at a scale of 2. The
/// smallest pixmap at least this wide wins, so the page only scales down.
const WANTED_PIXELS: i32 = 32;

/// Icon theme sizes to search, panel sizes first.
const SIZES: &[&str] = &[
    "22x22", "24x24", "scalable", "32x32", "16x16", "48x48", "64x64", "256x256",
];

/// Icon theme categories to search. Most tray icons are in `status`.
const CATEGORIES: &[&str] = &["status", "apps", "devices", "panel"];

/// An item's `Status` property.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Hidden from the tray.
    Passive,
    Active,
    /// Shown with its attention icon.
    NeedsAttention,
}

impl Status {
    /// Parse a `Status` value. Unknown values are `Active`, so an icon is
    /// never hidden by mistake.
    pub fn from_wire(word: &str) -> Status {
        match word {
            "Passive" => Status::Passive,
            "NeedsAttention" => Status::NeedsAttention,
            _ => Status::Active,
        }
    }
}

/// One `IconPixmap` image: big-endian ARGB, rows top to bottom.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pixmap {
    pub width: i32,
    pub height: i32,
    pub argb: Vec<u8>,
}

/// An item's `org.kde.StatusNotifierItem` properties. Missing ones are empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Properties {
    pub id: String,
    pub title: String,
    /// The title of its `ToolTip`.
    pub tooltip: String,
    pub status: Status,
    pub icon_name: String,
    pub icon_pixmaps: Vec<Pixmap>,
    pub attention_icon_name: String,
    pub attention_pixmaps: Vec<Pixmap>,
    /// The item's own icon directory.
    pub icon_theme_path: String,
}

/// The bus name and object path for a `RegisterStatusNotifierItem(service)`
/// call from `sender`.
///
/// `service` may be a bus name (the spec, and KDE), an object path on the
/// sender's connection (libappindicator), or a bus name followed by a path.
pub fn address(service: &str, sender: &str) -> (String, String) {
    match service.find('/') {
        Some(0) => (sender.to_string(), service.to_string()),
        Some(at) => (service[..at].to_string(), service[at..].to_string()),
        None => (service.to_string(), ITEM_PATH.to_string()),
    }
}

/// The `org.kde.StatusNotifierItem` method a click with `action` calls.
pub fn method(action: TrayAction) -> &'static str {
    match action {
        TrayAction::Primary => "Activate",
        TrayAction::Secondary => "SecondaryActivate",
        TrayAction::Context => "ContextMenu",
    }
}

/// The items registered with the watcher, in registration order.
///
/// Each item has four names:
/// - its id here: bus name and path, concatenated;
/// - its name for shells (see [`Registry::named`]);
/// - the bus name it is called on, possibly well-known;
/// - the unique name of its connection, which its signals and disconnect
///   come from.
#[derive(Debug, Default)]
pub struct Registry {
    entries: Vec<Entry>,
}

#[derive(Debug)]
struct Entry {
    id: String,
    bus: String,
    owner: String,
    path: String,
    /// The name for shells. `None` until its properties have been read.
    name: Option<String>,
    /// `None` until its properties have been read, and while it is passive.
    shown: Option<TrayItem>,
}

impl Registry {
    /// Register the item at `path` on `bus`, owned by connection `owner`.
    /// Returns its id, or `None` if already registered.
    pub fn register(&mut self, bus: &str, owner: &str, path: &str) -> Option<String> {
        let id = format!("{bus}{path}");
        (!self.entries.iter().any(|entry| entry.id == id)).then(|| {
            self.entries.push(Entry {
                id: id.clone(),
                bus: bus.to_string(),
                owner: owner.to_string(),
                path: path.to_string(),
                name: None,
                shown: None,
            });
            id
        })
    }

    /// Set how item `id` is shown, or `None` to hide it. Ignores an id that
    /// vanished while its properties were being read.
    pub fn show(&mut self, id: &str, shown: Option<TrayItem>) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) {
            entry.shown = shown;
        }
    }

    /// The bus name and path of item `id`.
    pub fn address(&self, id: &str) -> Option<(String, String)> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| (entry.bus.clone(), entry.path.clone()))
    }

    /// The name shells know item `id` by, set from its `Id` property
    /// (`calls_itself`) on the first call.
    ///
    /// Shells keep an icon's position by this name, so it comes from `Id`,
    /// which is stable across runs, rather than the bus name. Duplicates get a
    /// `#n` suffix, and an empty `Id` falls back to `id`.
    pub fn named(&mut self, id: &str, calls_itself: &str) -> String {
        let taken: Vec<String> = self
            .entries
            .iter()
            .filter_map(|entry| entry.name.clone())
            .collect();
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .expect("only an item held is named");
        entry
            .name
            .get_or_insert_with(|| {
                let base = if calls_itself.is_empty() {
                    id
                } else {
                    calls_itself
                };
                (1..)
                    .map(|n| match n {
                        1 => base.to_string(),
                        n => format!("{base}#{n}"),
                    })
                    .find(|name| !taken.contains(name))
                    .expect("a name nobody holds")
            })
            .clone()
    }

    /// The bus name and path of the item shells know as `name`.
    pub fn clicked(&self, name: &str) -> Option<(String, String)> {
        self.entries
            .iter()
            .find(|entry| entry.name.as_deref() == Some(name))
            .map(|entry| (entry.bus.clone(), entry.path.clone()))
    }

    /// The ids of items a signal from `sender` on `path` refers to.
    pub fn sent_by(&self, sender: &str, path: &str) -> Vec<String> {
        self.entries
            .iter()
            .filter(|entry| entry.owner == sender && entry.path == path)
            .map(|entry| entry.id.clone())
            .collect()
    }

    /// Remove every item owned by `name`, a unique or well-known bus name.
    /// Returns their ids.
    pub fn vanished(&mut self, name: &str) -> Vec<String> {
        let (gone, kept) = std::mem::take(&mut self.entries)
            .into_iter()
            .partition(|entry| entry.owner == name || entry.bus == name);
        self.entries = kept;
        gone.into_iter().map(|entry: Entry| entry.id).collect()
    }

    /// Record that well-known name `name` moved to connection `owner`, which
    /// its items' signals now come from.
    pub fn moved(&mut self, name: &str, owner: &str) {
        for entry in self.entries.iter_mut().filter(|entry| entry.bus == name) {
            entry.owner = owner.to_string();
        }
    }

    /// Every registered item's id, for the watcher's item list.
    pub fn ids(&self) -> Vec<String> {
        self.entries.iter().map(|entry| entry.id.clone()).collect()
    }

    /// The items to show in the tray.
    pub fn items(&self) -> Vec<TrayItem> {
        self.entries
            .iter()
            .filter_map(|entry| entry.shown.clone())
            .collect()
    }
}

/// The tray entry for an item, or `None` if it is passive. The title falls
/// back to `id`, so it is never empty.
pub fn item(id: &str, properties: Properties, icons: &mut TrayIcons) -> Option<TrayItem> {
    (properties.status != Status::Passive).then(|| TrayItem {
        id: id.to_string(),
        icon: picture(&properties, icons),
        title: [properties.tooltip, properties.title, properties.id]
            .into_iter()
            .find(|said| !said.is_empty())
            .unwrap_or_else(|| id.to_string()),
    })
}

/// The item's picture: the attention icon if it needs attention and has one,
/// else its icon. Names come before pixmaps, as the spec prefers.
fn picture(properties: &Properties, icons: &mut TrayIcons) -> Option<String> {
    let path = &properties.icon_theme_path;
    let attention = (properties.status == Status::NeedsAttention)
        .then(|| {
            icons
                .icon(&properties.attention_icon_name, path)
                .or_else(|| pixmap(&properties.attention_pixmaps))
        })
        .flatten();
    attention
        .or_else(|| icons.icon(&properties.icon_name, path))
        .or_else(|| pixmap(&properties.icon_pixmaps))
}

/// The best of `pixmaps` as a PNG `data:` URL: the smallest at least
/// [`WANTED_PIXELS`] wide, else the biggest. Skips pixmaps whose data does not
/// match their size.
fn pixmap(pixmaps: &[Pixmap]) -> Option<String> {
    let whole = pixmaps.iter().filter(|pixmap| {
        pixmap.width > 0
            && pixmap.height > 0
            && pixmap.argb.len() == pixmap.width as usize * pixmap.height as usize * 4
    });
    let big_enough = whole
        .clone()
        .filter(|pixmap| pixmap.width >= WANTED_PIXELS)
        .min_by_key(|pixmap| pixmap.width);
    big_enough
        .or_else(|| whole.max_by_key(|pixmap| pixmap.width))
        .map(|pixmap| {
            data_url(
                "image/png",
                &png(pixmap.width as u32, pixmap.height as u32, &pixmap.argb),
            )
        })
}

/// Tray icon lookup by name in the XDG data directories.
///
/// Searches `hicolor`, then `pixmaps`, after an item's own directory.
/// Results, including misses, are cached for the compositor's
/// lifetime: an item that changes its icon uses a new name.
pub struct TrayIcons {
    data_dirs: Vec<PathBuf>,
    found: HashMap<(String, String), Option<String>>,
}

impl TrayIcons {
    /// Look up icons under `data_dirs`, highest priority first.
    pub fn new(data_dirs: Vec<PathBuf>) -> Self {
        TrayIcons {
            data_dirs,
            found: HashMap::new(),
        }
    }

    /// Icon `name` as a `data:` URL, searching `theme_path` first. `None` for
    /// an empty name or no drawable icon.
    pub fn icon(&mut self, name: &str, theme_path: &str) -> Option<String> {
        if name.is_empty() {
            return None;
        }
        let key = (name.to_string(), theme_path.to_string());
        if let Some(found) = self.found.get(&key) {
            return found.clone();
        }
        let found = self.look_for(name, theme_path);
        self.found.insert(key, found.clone());
        found
    }

    fn look_for(&self, name: &str, theme_path: &str) -> Option<String> {
        if Path::new(name).is_absolute() {
            return read(Path::new(name));
        }
        // Applications use their own directory as either a theme root or a
        // flat pixmap directory, so search it as both.
        let own: Vec<PathBuf> = (!theme_path.is_empty())
            .then(|| PathBuf::from(theme_path))
            .into_iter()
            .collect();
        let own_themed = own.iter().flat_map(|root| themed(root.join("hicolor")));
        let system_themed = self
            .data_dirs
            .iter()
            .flat_map(|dir| themed(dir.join("icons/hicolor")));
        let pixmaps = self.data_dirs.iter().map(|dir| dir.join("pixmaps"));
        own.iter()
            .cloned()
            .chain(own_themed)
            .chain(system_themed)
            .chain(pixmaps)
            .find_map(|dir| {
                KINDS
                    .iter()
                    .find_map(|(ext, _)| read(&dir.join(format!("{name}.{ext}"))))
            })
    }
}

/// The directories of the theme at `root` to search, panel sizes first.
fn themed(root: PathBuf) -> impl Iterator<Item = PathBuf> {
    SIZES.iter().flat_map(move |size| {
        let root = root.clone();
        CATEGORIES
            .iter()
            .map(move |category| root.join(size).join(category))
    })
}

/// Supported extensions and their MIME types.
const KINDS: &[(&str, &str)] = &[("png", "image/png"), ("svg", "image/svg+xml")];

/// Largest icon file sent.
const LARGEST: u64 = 128 * 1024;

/// Reads `path` as a `data:` URL. Returns `None` for a missing, oversized or
/// unsupported file.
fn read(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    let (_, mime) = KINDS.iter().find(|(kind, _)| *kind == ext)?;
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > LARGEST {
        return None;
    }
    Some(data_url(mime, &fs::read(path).ok()?))
}
