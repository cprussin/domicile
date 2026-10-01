//! What a StatusNotifierItem is, as the system tray draws it.
//!
//! The D-Bus half — owning `org.kde.StatusNotifierWatcher`, reading each
//! item's properties, following its signals — is `crate::tray` in
//! `domicile-compositor`, because a bus is not something this crate can have.
//! What it reads is handed here as [`Properties`], and what comes back is the
//! [`TrayItem`] a shell is told about: which title, which picture, and whether
//! the icon is in the tray at all.
//!
//! **A picture a page can draw without reading a file.** An item names its
//! icon or sends its pixels; both become a `data:` URL here, the way a
//! launcher's application icons do — see [`crate::app_icons`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use domicile_protocol::{TrayAction, TrayItem};

use crate::app_icons::{read, KINDS};
use crate::data_url::data_url;
use crate::png::png;

/// Where the spec says an item registered by bus name answers.
const ITEM_PATH: &str = "/StatusNotifierItem";

/// The pixels a tray icon is drawn at, at a density of two: a pixmap at least
/// this big is taken over a bigger one, so the page scales down rather than
/// up.
const WANTED_PIXELS: i32 = 32;

/// The sizes an icon theme is looked through at, the ones a panel's icons are
/// drawn for first.
const SIZES: &[&str] = &[
    "22x22", "24x24", "scalable", "32x32", "16x16", "48x48", "64x64", "256x256",
];

/// The directories of a theme a tray icon may be in. `status` is where most
/// are; an application that uses its own icon puts it in `apps`.
const CATEGORIES: &[&str] = &["status", "apps", "devices", "panel"];

/// An item's `Status`: whether it has anything to say right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Nothing to say: every tray hides it.
    Passive,
    Active,
    /// Something to say, which it says with its attention icon.
    NeedsAttention,
}

impl Status {
    /// The spec's three words, read. A word it does not have is `Active`: an
    /// item that misspelled its status still asked to be in a tray, and
    /// hiding it is the one reading that loses an icon.
    pub fn from_wire(word: &str) -> Status {
        match word {
            "Passive" => Status::Passive,
            "NeedsAttention" => Status::NeedsAttention,
            _ => Status::Active,
        }
    }
}

/// One picture of an icon, as `IconPixmap` sends it: ARGB, big-endian, rows
/// top to bottom.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pixmap {
    pub width: i32,
    pub height: i32,
    pub argb: Vec<u8>,
}

/// What an item says about itself: its `org.kde.StatusNotifierItem`
/// properties, with every one it left out read as empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Properties {
    pub id: String,
    pub title: String,
    /// The title of its `ToolTip`, which is the one piece of it a tray label
    /// can say.
    pub tooltip: String,
    pub status: Status,
    pub icon_name: String,
    pub icon_pixmaps: Vec<Pixmap>,
    pub attention_icon_name: String,
    pub attention_pixmaps: Vec<Pixmap>,
    /// A directory of the item's own that its icons may be in.
    pub icon_theme_path: String,
}

/// Where the item a `RegisterStatusNotifierItem(service)` from `sender`
/// registered answers: its bus name and its object path.
///
/// The spec says `service` is a bus name and the item is at
/// `/StatusNotifierItem` on it, which is what KDE sends. libappindicator sends
/// a path of its own instead, on the connection that made the call; and a few
/// send a name with a path after it. All three are answered.
pub fn address(service: &str, sender: &str) -> (String, String) {
    match service.find('/') {
        Some(0) => (sender.to_string(), service.to_string()),
        Some(at) => (service[..at].to_string(), service[at..].to_string()),
        None => (service.to_string(), ITEM_PATH.to_string()),
    }
}

/// The method of `org.kde.StatusNotifierItem` a click with `action` calls.
pub fn method(action: TrayAction) -> &'static str {
    match action {
        TrayAction::Primary => "Activate",
        TrayAction::Secondary => "SecondaryActivate",
        TrayAction::Context => "ContextMenu",
    }
}

/// Every item registered with the watcher, in the order it registered, and
/// what each is shown as.
///
/// An item is known by three names, and this is what keeps them straight: the
/// id a shell is told (its bus name and path, written together), the bus name
/// it is called on — which may be a well-known one — and the unique name of
/// the connection behind it, which is what its signals and its going away
/// arrive under.
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
    /// `None` until its properties have been read, and while it is passive.
    shown: Option<TrayItem>,
}

impl Registry {
    /// Hold the item at `path` on `bus`, whose connection is `owner`, and
    /// hand back its id — or `None` where it was already held.
    pub fn register(&mut self, bus: &str, owner: &str, path: &str) -> Option<String> {
        let id = format!("{bus}{path}");
        (!self.entries.iter().any(|entry| entry.id == id)).then(|| {
            self.entries.push(Entry {
                id: id.clone(),
                bus: bus.to_string(),
                owner: owner.to_string(),
                path: path.to_string(),
                shown: None,
            });
            id
        })
    }

    /// Say what the item `id` is shown as now: `None` for an item that is not
    /// to be shown. An id no longer held is an item that went while it was
    /// being read, and there is nothing to say about it.
    pub fn show(&mut self, id: &str, shown: Option<TrayItem>) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) {
            entry.shown = shown;
        }
    }

    /// Where the item `id` is called: its bus name and its path.
    pub fn address(&self, id: &str) -> Option<(String, String)> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| (entry.bus.clone(), entry.path.clone()))
    }

    /// The items a signal from `sender` about `path` is about.
    pub fn sent_by(&self, sender: &str, path: &str) -> Vec<String> {
        self.entries
            .iter()
            .filter(|entry| entry.owner == sender && entry.path == path)
            .map(|entry| entry.id.clone())
            .collect()
    }

    /// Let go of every item `name` — a connection or a well-known name — was
    /// behind, and hand back their ids.
    pub fn vanished(&mut self, name: &str) -> Vec<String> {
        let (gone, kept) = std::mem::take(&mut self.entries)
            .into_iter()
            .partition(|entry| entry.owner == name || entry.bus == name);
        self.entries = kept;
        gone.into_iter().map(|entry: Entry| entry.id).collect()
    }

    /// Follow the well-known name `name` to the connection that holds it now,
    /// `owner`: an item's signals arrive from there.
    pub fn moved(&mut self, name: &str, owner: &str) {
        for entry in self.entries.iter_mut().filter(|entry| entry.bus == name) {
            entry.owner = owner.to_string();
        }
    }

    /// Every item held, by id, which is what the watcher lists.
    pub fn ids(&self) -> Vec<String> {
        self.entries.iter().map(|entry| entry.id.clone()).collect()
    }

    /// What the tray shows.
    pub fn items(&self) -> Vec<TrayItem> {
        self.entries
            .iter()
            .filter_map(|entry| entry.shown.clone())
            .collect()
    }
}

/// The icon an item with `properties` is in the tray as, called `id` — or
/// `None` for an item that has asked not to be shown. Titled by `id` where it
/// says nothing about itself, so a title is never empty.
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

/// The picture `properties` asks to be drawn with: its attention icon while
/// it needs attention and it has one, and its own otherwise. A name is looked
/// for before pixels are drawn, which is the order the spec prefers them in.
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
/// [`WANTED_PIXELS`] across, or the biggest where none is. One whose bytes do
/// not add up to its size is not a picture and is passed over.
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

/// Tray icons by name, out of the data directories they were looked for in.
///
/// [`crate::app_icons::AppIcons`]'s shape, for a different question: a
/// launcher's icons are `apps`, a tray's are mostly `status`, and an item may
/// name a directory of its own. Cached for the life of the compositor, a miss
/// included — an item that changes its icon names another one.
pub struct TrayIcons {
    data_dirs: Vec<PathBuf>,
    found: HashMap<(String, String), Option<String>>,
}

impl TrayIcons {
    /// Icons under `data_dirs`, the one that wins first.
    pub fn new(data_dirs: Vec<PathBuf>) -> Self {
        TrayIcons {
            data_dirs,
            found: HashMap::new(),
        }
    }

    /// The icon `name` is, looked for in `theme_path` before anywhere else, as
    /// a `data:` URL — or nothing a page could draw. An empty name is none.
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
        // The item's own directory is a theme root and a pixmap directory at
        // once: applications put their icons in either shape.
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

/// Every directory of the theme at `root` a tray icon may be in, the sizes a
/// panel draws at first.
fn themed(root: PathBuf) -> impl Iterator<Item = PathBuf> {
    SIZES.iter().flat_map(move |size| {
        let root = root.clone();
        CATEGORIES
            .iter()
            .map(move |category| root.join(size).join(category))
    })
}
