//! The thread that builds the file index and then keeps it.
//!
//! Glue rather than policy. What an index holds is
//! [`domicile_host::file_index`], what goes into it is
//! [`domicile_host::home_walk`], what a filesystem event does to it is
//! [`domicile_host::file_changes`], and each of those is a function over
//! values with tests of its own. This is the loop that runs them, and the only
//! decisions in it are about *when*: when a half-built index is worth telling
//! the chromes about, and how long a burst of writes is gathered for.
//!
//! # The index is not shared, and the answer is
//!
//! [`FileIndex`] lives on this thread and nothing else touches it. What
//! crosses to the chrome connections is [`Offered`] — the list as it stood at
//! the last announcement — which is a value rather than a thing to lock
//! against. A connection answering `list_files` clones it and never waits for
//! a walk; nothing on the Wayland thread waits for a disk.
//!
//! # Why it is a thread and not the event loop
//!
//! Walking a home directory takes seconds and blocks on a disk. The Wayland
//! thread is what every window on the desk is drawn behind, so nothing that
//! waits for a stranger's I/O may run on it — the same rule the clipboard's
//! read follows.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use domicile_host::file_changes::{changes, Change};
use domicile_host::file_index::FileIndex;
use domicile_host::home_walk::{walk, RealDirectory};
use domicile_host::home_watch::{watch_home, HomeWatcher};
use domicile_host::index_file::{read, write, IndexFileError};
use domicile_host::index_location::index_file;
use tracing::{error, info, warn};

/// How many paths are taken off the walk before the index is told.
///
/// Small enough that a launcher opened early fills in visibly rather than in
/// one jump, big enough that a home of a hundred thousand files is not a
/// hundred thousand turns of the loop below.
const BATCH: usize = 2_000;

/// How often a walk that is still running is worth announcing.
///
/// The message carries the whole list, so this is the rate at which a home's
/// worth of paths crosses into every connected page. Twice a second is a
/// launcher that visibly fills in; ten times a second is the same list ten
/// times over for one more directory.
const WHILE_BUILDING: Duration = Duration::from_millis(500);

/// How long a burst of filesystem events is gathered before it is applied.
///
/// A `git checkout` is thousands of events over a second or two, and a save is
/// a handful over a millisecond. Neither is worth an announcement each, and
/// the index lands in the same place either way.
const SETTLE: Duration = Duration::from_millis(250);

/// How long the index on disk may be behind the one in memory.
///
/// The cache is written when the boot walk ends and again when the home has
/// moved on, but not on every change: the file is the whole list, so a home
/// that gains one file a minute would rewrite megabytes a minute for a cache
/// only the *next* session reads. Five minutes of drift costs that session the
/// few seconds its own walk takes to notice, which is what the cache is for in
/// the first place.
const KEPT_FRESH: Duration = Duration::from_secs(300);

/// What a launcher is offered, as the last announcement left it.
///
/// The whole list rather than what changed, for the reason the clipboard sends
/// the whole history: a page reconciling deltas is wrong forever after missing
/// one, and this is a message a shell can also *ask* for — so it has to be
/// able to stand on its own.
#[derive(Debug, Clone)]
pub struct Offered {
    pub files: Vec<String>,
    /// Whether the walk behind this list is still running, which is what a
    /// shell draws its "still building" line from. See
    /// `domicile_protocol::HostMessage::Files`.
    pub indexing: bool,
}

/// Build the index, write it down, and then keep it current, forever.
///
/// Meant to be handed a thread of its own. `tell` is how the rest of the
/// desktop hears about it, called only when something a page would draw has
/// moved: the compositor publishes the [`Offered`] for `list_files` to answer
/// from and broadcasts it to the chromes that are already connected.
///
/// **Nothing below the home is fatal.** A cache file that will not read, a
/// directory that will not open, a watch that cannot be established: each
/// costs a launcher that is a little less good, and each is logged and carried
/// on from. The one thing this returns for is a home directory that cannot be
/// read at all, which is a broken desktop — and a launcher on one is left with
/// no list rather than with an empty one, because "you have no files" said on
/// a full home is the worse answer. The panel still opens and still takes a
/// path, a URL or a query.
pub fn keep_the_index(home: PathBuf, kept_at: Option<PathBuf>, tell: impl Fn(Offered)) {
    if kept_at.is_none() {
        info!("nowhere to keep a file index, so every start walks the home");
    }
    let mut index = FileIndex::building(remembered(kept_at.as_deref()));

    loop {
        if !walk_the_home(&home, &mut index, &tell) {
            return;
        }
        write_it_down(kept_at.as_deref(), &index);

        // A watch that will not start leaves an index that was right at
        // startup and goes on being what it was — which is no worse than the
        // launcher had before any of this existed, and is worth a loud line
        // rather than a thread that spins trying again. The usual cause is
        // `fs.inotify.max_user_watches`, which the line names.
        let watcher = match watch_home(&home) {
            Ok(watcher) => watcher,
            Err(err) => {
                error!(
                    %err, home = %home.display(),
                    "the home directory cannot be watched -- check \
                     fs.inotify.max_user_watches -- so what a launcher is \
                     offered is what was there at startup"
                );
                return;
            }
        };

        if !hold_it_current(&watcher, &home, kept_at.as_deref(), &mut index, &tell) {
            return;
        }
        info!("the kernel dropped filesystem events, so the home is being walked again");
        index.rebuilding();
    }
}

/// Fill the index from a walk of the home, and say when it is whole.
///
/// `false` when there is no home to walk, which is the one failure that ends
/// the indexing. Everything the walk meets *below* the home — a directory it
/// may not read, a name that is not text — is the walk's own business and is
/// not reported here; see [`domicile_host::home_walk`].
fn walk_the_home(home: &Path, index: &mut FileIndex, tell: &impl Fn(Offered)) -> bool {
    let mut walking = match walk(home, &RealDirectory) {
        Ok(walking) => walking,
        Err(err) => {
            error!(
                %err, home = %home.display(),
                "the home directory could not be read, so a launcher has \
                 nothing to be offered"
            );
            return false;
        }
    };

    // AFTER THE HOME HAS BEEN OPENED AND NOT BEFORE. This is what publishes
    // last session's list, and it must not go out on a desktop whose home
    // turns out to be unreadable — that would be a launcher holding a list of
    // a home it cannot see, under a notice saying it is still looking, for as
    // long as the session lasts.
    announce(index, tell);

    let started = Instant::now();
    let mut last_told = Instant::now();
    loop {
        let batch: Vec<String> = walking.by_ref().take(BATCH).collect();
        if batch.is_empty() {
            break;
        }
        index.found(batch);
        // On a clock rather than per batch, because what a batch costs the
        // chromes is the whole list over again: see `WHILE_BUILDING`.
        if last_told.elapsed() >= WHILE_BUILDING {
            announce(index, tell);
            last_told = Instant::now();
        }
    }

    index.built();
    announce(index, tell);
    info!(
        files = index.files().len(),
        took_ms = started.elapsed().as_millis(),
        "the home directory is indexed"
    );
    true
}

/// What the last run wrote down, and nothing when there is no usable file.
///
/// **None of these is a failure worth stopping for.** The file is a cache, in
/// a directory anything running as this user can write; all it buys is a
/// launcher with a list in the first seconds of a session, and all that losing
/// it costs is those seconds. They are told apart because they mean different
/// things — a first boot is not a corrupted one — and none of them is an
/// `error!`.
fn remembered(kept_at: Option<&Path>) -> Vec<String> {
    let Some(path) = kept_at else {
        return Vec::new();
    };
    match read(path) {
        Ok(files) => {
            info!(
                files = files.len(),
                "a launcher has last session's list while the home is walked"
            );
            files
        }
        Err(IndexFileError::Missing) => {
            info!(
                index = %path.display(),
                "nothing written down yet, so a launcher fills in as the home is walked"
            );
            Vec::new()
        }
        Err(err) => {
            warn!(
                %err, index = %path.display(),
                "the file index on disk was not usable, so the home is walked from nothing"
            );
            Vec::new()
        }
    }
}

/// Write the index down for the next run to start from.
fn write_it_down(kept_at: Option<&Path>, index: &FileIndex) {
    let Some(path) = kept_at else {
        return;
    };
    if let Err(err) = write(path, &index.files()) {
        // Costs the next session its first few seconds of launcher, and costs
        // this one nothing at all.
        warn!(
            %err, index = %path.display(),
            "the file index could not be written down for the next run"
        );
    }
}

/// Apply what the watch reports until the kernel says it lost some.
///
/// `true` to walk the home again — a dropped event is an index wrong in a way
/// nothing can work out from here — and `false` when the watch has ended,
/// which is the desktop going away.
fn hold_it_current(
    watcher: &HomeWatcher,
    home: &Path,
    kept_at: Option<&Path>,
    index: &mut FileIndex,
    tell: &impl Fn(Offered),
) -> bool {
    let mut written = Instant::now();
    while let Ok(first) = watcher.rx.recv() {
        // A `git checkout` is thousands of events over a second or two. Taken
        // one at a time they would be one announcement of the whole home per
        // file, so the burst is gathered until it stops.
        let gathered = std::iter::once(first)
            .chain(std::iter::from_fn(|| watcher.rx.recv_timeout(SETTLE).ok()));

        let mut rescan = false;
        for event in gathered {
            match event {
                Ok(event) => {
                    rescan |= event.need_rescan();
                    for change in changes(&event, home) {
                        match change {
                            Change::Appeared(path) => appeared(index, home, path),
                            Change::Vanished(path) => index.vanished(&path),
                        }
                    }
                }
                // A directory that went away mid-read, a permission that
                // moved. The watch survives it, and whatever it cost the index
                // is what the next walk reconciles.
                Err(err) => warn!(%err, "a filesystem watch reported a problem"),
            }
        }

        announce(index, tell);
        // And the copy the next session starts from, which would otherwise be
        // whatever the home held at this session's startup — a day or a week
        // ago on a desk that stays up. On a clock, because the file is the
        // whole list: see `KEPT_FRESH`.
        if written.elapsed() >= KEPT_FRESH {
            write_it_down(kept_at, index);
            written = Instant::now();
        }
        if rescan {
            return true;
        }
    }
    false
}

/// Take in a path that has turned up, and everything already inside it.
///
/// **A WATCH ON A TREE IS ALWAYS BEHIND A DIRECTORY THAT IS BEING FILLED.** The
/// kernel watches directories, not trees, so a directory that appears is only
/// watched once its own creation has been *read* — and `mkdir -p a/b && touch
/// a/b/c`, a `mv` of a populated tree into the home, or a checkout being
/// written all reach the disk faster than that. The events for what went
/// inside are never sent to anybody. Left alone, the index would hold the
/// directory and none of its contents until the next boot.
///
/// So anything that appears is walked. A plain file is a `read_dir` that
/// fails, which is the walk's own answer for a leaf — see
/// [`domicile_host::home_walk`] — so the ordinary case costs one failed system
/// call and says nothing.
fn appeared(index: &mut FileIndex, home: &Path, path: String) {
    if let Ok(inside) = walk(&home.join(&path), &RealDirectory) {
        index.found(inside.map(|under| format!("{path}/{under}")));
    }
    index.appeared(path);
}

/// Hand on what a launcher is offered, when it is not what was handed on last.
///
/// Whether it is is the index's own question rather than one asked here: most
/// of what a home directory reports changes nothing a page would draw, and
/// this message carries the whole list.
fn announce(index: &mut FileIndex, tell: &impl Fn(Offered)) {
    if index.changed() {
        tell(Offered {
            files: index.files(),
            indexing: index.indexing(),
        });
    }
}

/// Where this user's index is kept, read off the real environment.
pub fn kept_at() -> Option<PathBuf> {
    index_file(&|name| std::env::var(name).ok())
}
