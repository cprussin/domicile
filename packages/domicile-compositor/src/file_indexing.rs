//! The thread that builds the file index and then keeps it.
//!
//! Glue rather than policy. What an index holds is
//! [`domicile_host::file_index`], what goes into it is
//! [`domicile_host::home_walk`], what a filesystem event does to it is
//! [`domicile_host::file_changes`], and each of those is a function over
//! values with tests of its own. This is the loop that runs them, and the only
//! decisions in it are about *when*: when a half-built index is worth
//! republishing, and how long a burst of writes is gathered for.
//!
//! # The index is not shared, and the answer is
//!
//! [`FileIndex`] lives on this thread and nothing else touches it. What
//! crosses to the chrome connections is [`Offered`] — a search over the list
//! as it stood at the last announcement — which is a value rather than a thing
//! to lock against. A connection answering `search_files` takes a handle on it
//! and never waits for a walk; nothing on the Wayland thread waits for a disk.
//!
//! # Why it is a thread and not the event loop
//!
//! Walking a home directory takes seconds and blocks on a disk. The Wayland
//! thread is what every window on the desk is drawn behind, so nothing that
//! waits for a stranger's I/O may run on it — the same rule the clipboard's
//! read follows.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

use domicile_config::Omit;
use domicile_host::file_changes::{changes, Change};
use domicile_host::file_index::FileIndex;
use domicile_host::file_search::FileSearch;
use domicile_host::home_walk::{walk, walk_within, Directory, RealDirectory};
use domicile_host::home_watch::HomeWatcher;
use domicile_host::index_file::{read, write, IndexFileError};
use domicile_host::index_location::index_file;
use tracing::{debug, error, info, warn};

/// How many paths are taken off the walk before the index is told.
///
/// Small enough that a launcher opened early fills in visibly rather than in
/// one jump, big enough that a home of a hundred thousand files is not a
/// hundred thousand turns of the loop below.
const BATCH: usize = 2_000;

/// How often a walk that is still running is worth announcing.
///
/// Each announcement folds the whole list into a new [`FileSearch`], so this
/// is how often a home's worth of paths is lowered on this thread. Twice a
/// second is a launcher whose searches visibly fill in; ten times a second is
/// the same list ten times over for one more directory.
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

/// What a launcher's search is answered from, as the last announcement left
/// it.
///
/// Never sent anywhere whole. The index is the size of a home directory, and
/// what crosses into a page is what one query matched — see
/// `domicile_host::file_search`.
#[derive(Debug)]
pub struct Offered {
    pub search: FileSearch,
    /// Whether the walk behind this list is still running, which is what a
    /// shell draws its "still building" line from. See
    /// `domicile_protocol::HostMessage::FoundFiles`.
    pub indexing: bool,
}

/// What the index thread is told: the home moving, or the desk's rule for it.
///
/// One channel for both, because the thread spends its life waiting on the
/// first and has to hear the second while it does.
#[derive(Debug)]
pub enum Heard {
    /// What the watch on the home reported.
    Filesystem(notify::Result<notify::Event>),
    /// A reload moved `[files] omit`, which is a walk under the new rule —
    /// what it now leaves out has to go, and what it now takes back was never
    /// read.
    Omitting(Omit),
}

/// Build the index, write it down, and then keep it current, forever.
///
/// Meant to be handed a thread of its own. `omit` is what the desk's config
/// leaves out, and a new one arrives on `heard`; `told` is the other end of
/// it, which the watch is given so what it reports arrives there too. `tell` is how the rest of the
/// desktop hears about it, called only when something a page would draw has
/// moved: the compositor publishes the [`Offered`] for `search_files` to
/// answer from. Nothing is broadcast: a page is only ever told what its own
/// query matched.
///
/// **Nothing below the home is fatal.** A cache file that will not read, a
/// directory that will not open, a watch that cannot be established: each
/// costs a launcher that is a little less good, and each is logged and carried
/// on from. The one thing this returns for is a home directory that cannot be
/// read at all, which is a broken desktop — and a launcher on one is left with
/// no list rather than with an empty one, because "you have no files" said on
/// a full home is the worse answer. The panel still opens and still takes a
/// path, a URL or a query.
pub fn keep_the_index(
    home: PathBuf,
    kept_at: Option<PathBuf>,
    mut omit: Omit,
    (told, heard): (Sender<Heard>, Receiver<Heard>),
    tell: impl Fn(Offered),
) {
    if kept_at.is_none() {
        debug!("nowhere to keep a file index, so every start walks the home");
    }
    let mut index = FileIndex::building(remembered(kept_at.as_deref()));

    loop {
        // BEFORE THE WALK, WHICH IS WHAT A LAUNCHER WAITS ON. A launcher
        // opened before anything is announced is answered nothing: no rows,
        // and no line saying the index is still being built. Said here, it has
        // last session's list and the fact that it is being checked, from the
        // moment the home is known to open.
        //
        // Not on a home that will not open: that would be a launcher holding
        // last session's list of a home it cannot see, under a notice saying
        // it is still looking, for as long as the session lasts.
        if let Err(err) = fs::read_dir(&home) {
            error!(
                %err, home = %home.display(),
                "the home directory could not be read, so a launcher has \
                 nothing to be offered"
            );
            return;
        }
        announce(&mut index, &tell);

        // THE WALK WATCHES WHAT IT READS, AND THAT IS THE ONLY ORDER THAT LOSES
        // NOTHING. The kernel reports what moves under a watch it already has,
        // so a directory read with no watch behind it goes stale as the walk
        // runs: a file written into it afterwards was in neither the walk nor
        // any event, and nothing revisits a home until the next boot — so the
        // launcher went the whole session without it. So each directory is
        // watched before it is read, and what the walk omits is never watched
        // at all. See `domicile_host::home_watch`.
        //
        // Events that arrive while the walk runs wait on `heard`, which is
        // unbounded and so never turns a send away, and `FileIndex::found` and
        // `FileIndex::appeared` are both inserts into a set — so a path the
        // walk and an event both report lands once.
        //
        // Held to the end of this turn of the loop and no further: a walk again
        // is a watcher again, so nothing the new rule omits stays watched.
        let watched = watch_the_home(&home, told.clone());
        let walked = match &watched {
            Some(watcher) => {
                let walked = walk_the_home(&home, &omit, watcher, &mut index, &tell);
                report_unwatched(watcher);
                walked
            }
            None => walk_the_home(&home, &omit, &RealDirectory, &mut index, &tell),
        };
        if !walked {
            return;
        }
        // Where it always was, because the file is a copy of the whole list: it
        // wants the walk to have ended and has nothing to say to the watch.
        write_it_down(kept_at.as_deref(), &index);
        // And with no watch there is nothing further to hear — the walk above
        // is this session's last word on the home. See `watch_the_home`.
        let Some(watcher) = watched else {
            return;
        };

        match hold_it_current(
            &heard,
            &home,
            &omit,
            &watcher,
            kept_at.as_deref(),
            &mut index,
            &tell,
        ) {
            Held::Lost => {
                debug!("the kernel dropped filesystem events, so the home is being walked again");
            }
            Held::Omitting(new) => {
                info!("the desk's config moved `files.omit`, so the home is being walked again");
                omit = new;
            }
            Held::Ended => return,
        }
        index.rebuilding();
    }
}

/// A watcher for the walk to read the home through, and nothing when one
/// cannot be established.
///
/// **Nothing is the launcher this desktop had before any of this existed**: the
/// caller still walks the home and still publishes what it found, and what is
/// lost is the index staying true as the home moves. Loud rather than retried,
/// because a thread spinning will not move whatever refused it.
fn watch_the_home(home: &Path, told: Sender<Heard>) -> Option<HomeWatcher> {
    match HomeWatcher::new(move |event| {
        // Only refused when the index thread has gone, which is the desktop
        // going away — nothing to report from a watcher's thread.
        let _ = told.send(Heard::Filesystem(event));
    }) {
        Ok(watcher) => Some(watcher),
        Err(err) => {
            error!(
                %err, home = %home.display(),
                "the home directory cannot be watched, so what a launcher is \
                 offered is what was there at startup"
            );
            None
        }
    }
}

/// Say which directories were read but not watched, if any were.
///
/// What is under them is offered as the walk found it and stays that way until
/// the next walk, which is a launcher that is a little less good rather than a
/// broken one — so one line for all of them, naming the usual cause.
fn report_unwatched(watcher: &HomeWatcher) {
    if let Some(unwatched) = watcher.unwatched() {
        error!(
            err = %unwatched.first, directories = unwatched.count,
            "directories in the home could not be watched -- check \
             fs.inotify.max_user_watches -- so what a launcher is offered \
             from them is what was there when they were read"
        );
    }
}

/// Fill the index from a walk of the home, and say when it is whole.
///
/// `false` when there is no home to walk, which is the one failure that ends
/// the indexing. Everything the walk meets *below* the home — a directory it
/// may not read, a name that is not text — is the walk's own business and is
/// not reported here; see [`domicile_host::home_walk`].
fn walk_the_home(
    home: &Path,
    omit: &Omit,
    directory: &impl Directory,
    index: &mut FileIndex,
    tell: &impl Fn(Offered),
) -> bool {
    let omitted = |path: &str| omit.omits(path);
    let mut walking = match walk(home, directory, &omitted) {
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

    let started = Instant::now();
    let mut last_told = Instant::now();
    loop {
        let batch: Vec<String> = walking.by_ref().take(BATCH).collect();
        if batch.is_empty() {
            break;
        }
        index.found(batch);
        // On a clock rather than per batch, because what a batch costs is the
        // whole list folded over again: see `WHILE_BUILDING`.
        if last_told.elapsed() >= WHILE_BUILDING {
            announce(index, tell);
            last_told = Instant::now();
        }
    }

    index.built();
    announce(index, tell);
    debug!(
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
            debug!(
                files = files.len(),
                "a launcher has last session's list while the home is walked"
            );
            files
        }
        Err(IndexFileError::Missing) => {
            debug!(
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

/// Why [`hold_it_current`] stopped holding.
enum Held {
    /// The kernel dropped events, and the index is wrong in a way nothing can
    /// work out from here.
    Lost,
    /// The desk's config moved what is left out.
    Omitting(Omit),
    /// Nothing is left to hear from, which is the desktop going away.
    Ended,
}

/// Apply what the watch reports until the home has to be walked again.
fn hold_it_current(
    heard: &Receiver<Heard>,
    home: &Path,
    omit: &Omit,
    watcher: &HomeWatcher,
    kept_at: Option<&Path>,
    index: &mut FileIndex,
    tell: &impl Fn(Offered),
) -> Held {
    let omitted = |path: &str| omit.omits(path);
    let mut written = Instant::now();
    while let Ok(first) = heard.recv() {
        // A `git checkout` is thousands of events over a second or two. Taken
        // one at a time they would be the whole home folded again per file, so
        // the burst is gathered until it stops.
        let gathered =
            std::iter::once(first).chain(std::iter::from_fn(|| heard.recv_timeout(SETTLE).ok()));

        let mut rescan = false;
        let mut omitting = None;
        for heard in gathered {
            match heard {
                // Taken after the burst rather than at once, because the rest
                // of the burst is still true of the home and a walk under the
                // new rule starts from this index either way.
                Heard::Omitting(new) => omitting = Some(new),
                Heard::Filesystem(Ok(event)) => {
                    rescan |= event.need_rescan();
                    for change in changes(&event, home, &omitted) {
                        match change {
                            Change::Appeared(path) => {
                                appeared(index, home, watcher, &omitted, path)
                            }
                            Change::Vanished(path) => index.vanished(&path),
                        }
                    }
                }
                // A directory that went away mid-read, a permission that
                // moved. The watch survives it, and whatever it cost the index
                // is what the next walk reconciles.
                Heard::Filesystem(Err(err)) => {
                    warn!(%err, "a filesystem watch reported a problem");
                }
            }
        }

        report_unwatched(watcher);
        announce(index, tell);
        // And the copy the next session starts from, which would otherwise be
        // whatever the home held at this session's startup — a day or a week
        // ago on a desk that stays up. On a clock, because the file is the
        // whole list: see `KEPT_FRESH`.
        if written.elapsed() >= KEPT_FRESH {
            write_it_down(kept_at, index);
            written = Instant::now();
        }
        if let Some(new) = omitting {
            return Held::Omitting(new);
        }
        if rescan {
            return Held::Lost;
        }
    }
    Held::Ended
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
/// So a directory that appears is walked through the watcher, under the same
/// rule as the boot walk — which is also what watches it and everything in it.
/// Not a link to one, which the boot walk would not have followed either, and
/// not a plain file: one `lstat` answers both, and says nothing.
fn appeared(
    index: &mut FileIndex,
    home: &Path,
    watcher: &HomeWatcher,
    omitted: &impl Fn(&str) -> bool,
    path: String,
) {
    let directory = fs::symlink_metadata(home.join(&path)).is_ok_and(|found| found.is_dir());
    if directory {
        if let Ok(inside) = walk_within(home, &path, watcher, omitted) {
            index.found(inside);
        }
    }
    index.appeared(path);
}

/// Hand on what a launcher is offered, when it is not what was handed on last.
///
/// Whether it is is the index's own question rather than one asked here: most
/// of what a home directory reports changes nothing a page would draw, and
/// an announcement folds the whole list.
fn announce(index: &mut FileIndex, tell: &impl Fn(Offered)) {
    if index.changed() {
        tell(Offered {
            search: FileSearch::new(index.files()),
            indexing: index.indexing(),
        });
    }
}

/// Where this user's index is kept, read off the real environment.
pub fn kept_at() -> Option<PathBuf> {
    index_file(&|name| std::env::var(name).ok())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::thread;
    use std::time::Duration;

    use domicile_config::Omit;

    use super::{keep_the_index, Heard};

    /// How long the index has to announce the list this expects of it.
    ///
    /// A real walk of a real directory, a real inotify watch and the quarter
    /// second [`super::SETTLE`] gathers a burst for, on a machine that may be
    /// running every other check in this repo at the same time. The home here
    /// is four paths, so this is orders of magnitude more than the work.
    const ANNOUNCED_WITHIN: Duration = Duration::from_secs(10);

    /// How long an index nobody is writing into stays quiet before it is
    /// believed to have settled: past [`super::SETTLE`], and past a walk of the
    /// largest home below.
    const SETTLED: Duration = Duration::from_secs(3);

    /// More rows than any home below has, so nothing is truncated.
    const EVERY_ROW: usize = 100;

    #[test]
    fn the_index_says_it_is_building_before_it_walks_the_home() {
        // A walk of a real home takes seconds, and a launcher opened before
        // anything was announced was answered nothing at all: no rows, and no
        // line saying the index was still being built.
        //
        // So the first announcement goes out before the walk has read
        // anything. A path created while it is in hand is one
        // the walk still reaches, which the walk's own last announcement shows.
        let home = tempfile::tempdir().expect("a home to lay out");
        fs::create_dir(home.path().join("Notes")).expect("the directory");
        fs::write(home.path().join("Notes/today.org"), "").expect("the file");
        let (announcements, go_on) = keeping(home.path());

        let (seeded, indexing) = next(&announcements);
        assert!(indexing, "a walk that has not ended is still indexing");
        assert!(
            seeded.is_empty(),
            "nothing is written down for this home to start from, so the first \
             announcement is an empty seed: {seeded:?}"
        );
        fs::create_dir(home.path().join("Early")).expect("the directory");
        fs::write(home.path().join("Early/plan.org"), "").expect("the file");
        go_on.send(()).expect("the walk goes on");

        assert_eq!(
            walked(&announcements, &go_on),
            ["Early/", "Early/plan.org", "Notes/", "Notes/today.org"],
            "the walk read the home after the index said it was building"
        );
    }

    #[test]
    fn a_file_written_while_the_home_is_walked_is_still_offered() {
        // THE WINDOW BETWEEN THE WALK AND THE WATCH, WHICH A SESSION USED TO
        // LOSE A FILE TO FOREVER. `keep_the_index` established its watch after
        // the walk had ended, so a file written into a directory the walk had
        // already read was in neither: the walk was past it, and the kernel had
        // nobody to report it to. Nothing revisits a home until the next boot,
        // so that file was missing from the launcher for the whole session.
        //
        // The walk's last announcement is what makes this a check rather than
        // a race: a path created in the home once it is in hand is one the walk
        // provably cannot reach, so only a watch that was already up can find
        // it.
        let home = tempfile::tempdir().expect("a home to lay out");
        fs::create_dir(home.path().join("Notes")).expect("the directory");
        fs::write(home.path().join("Notes/today.org"), "").expect("the file");
        let (announcements, go_on) = keeping(home.path());

        let mut last = walked(&announcements, &go_on);
        // A directory with a file inside it, because the directory is a row of
        // its own that nothing synthesizes from the file's name — the second
        // thing the window cost, a file offered with nowhere to sit.
        fs::create_dir(home.path().join("Late")).expect("the directory");
        fs::write(home.path().join("Late/plan.org"), "").expect("the file");
        go_on.send(()).expect("the index goes on");

        let expected = ["Late/", "Late/plan.org", "Notes/", "Notes/today.org"];
        while last != expected {
            last = next(&announcements).0;
            let _ = go_on.send(());
        }
    }

    #[test]
    fn a_home_of_more_directories_than_the_kernel_queues_events_for_is_indexed_once() {
        // WATCHING A DIRECTORY IS OPENING IT, AND AN OPEN WAS AN EVENT. The
        // watch asked the kernel for every open under the home, so setting it
        // up reported one per directory it visited, and so did the walk. A
        // home of more directories than `max_queued_events` overflowed the
        // queue before anybody read it, the overflow is the kernel saying
        // events were lost, and lost events are a walk again — which overflowed
        // again. The index was rebuilt forever and the launcher said "still
        // finding your files" for as long as the session lasted.
        let queued: usize = fs::read_to_string("/proc/sys/fs/inotify/max_queued_events")
            .expect("the kernel's bound on queued inotify events")
            .trim()
            .parse()
            .expect("a count");
        let home = tempfile::tempdir().expect("a home to lay out");
        for directory in 0..=queued {
            fs::create_dir(home.path().join(directory.to_string())).expect("the directory");
        }
        let (announcements, go_on) = keeping(home.path());

        walked(&announcements, &go_on);
        go_on.send(()).expect("the index goes on");

        if let Ok((_, indexing)) = announcements.recv_timeout(SETTLED) {
            panic!("the index announced again after its walk ended (indexing: {indexing})");
        }
    }

    #[test]
    fn a_directory_that_appears_after_the_walk_is_watched_too() {
        // NOTHING WATCHES A DIRECTORY BUT A WALK OF IT. One made once the boot
        // walk has ended is walked when it is heard, and that walk is what
        // watches it — so a file written into it later is heard as well.
        let home = tempfile::tempdir().expect("a home to lay out");
        let (announcements, go_on) = keeping(home.path());

        walked(&announcements, &go_on);
        fs::create_dir(home.path().join("Late")).expect("the directory");
        go_on.send(()).expect("the index goes on");
        until(&announcements, &go_on, "Late");
        fs::write(home.path().join("Late/plan.org"), "").expect("the file");
        go_on.send(()).expect("the index goes on");

        until(&announcements, &go_on, "Late/plan.org");
    }

    #[test]
    fn a_link_that_appears_after_the_walk_is_offered_but_not_followed() {
        // As the boot walk offers one: by name, and no further. See
        // `domicile_host::home_walk`.
        let home = tempfile::tempdir().expect("a home to lay out");
        let elsewhere = tempfile::tempdir().expect("a directory outside the home");
        fs::write(elsewhere.path().join("inside.txt"), "").expect("the file");
        let (announcements, go_on) = keeping(home.path());

        walked(&announcements, &go_on);
        symlink(elsewhere.path(), home.path().join("result")).expect("the link");
        // Heard after the link, so by the time it is offered the link has been
        // taken in too.
        fs::write(home.path().join("after.txt"), "").expect("the file");
        go_on.send(()).expect("the index goes on");

        assert_eq!(
            until(&announcements, &go_on, "after.txt"),
            ["after.txt", "result"]
        );
    }

    /// What each announcement offers and whether it is still indexing, and
    /// what lets the index go on past each one.
    type Keeping = (Receiver<(Vec<String>, bool)>, Sender<()>);

    /// An index of `home` kept on a thread of its own, holding at every
    /// announcement until the test says to go on — so what the home holds when
    /// the index moves is the test's to decide rather than a clock's.
    fn keeping(home: &Path) -> Keeping {
        let (announced, announcements) = channel();
        let (go_on, resumed) = channel();
        let (told, heard) = channel::<Heard>();
        let home = home.to_path_buf();
        thread::spawn(move || {
            keep_the_index(home, None, Omit::default(), (told, heard), move |offered| {
                // Both refused only once the test has ended, which is the test
                // having already said whatever went wrong.
                let _ =
                    announced.send((offered.search.find("", EVERY_ROW).files, offered.indexing));
                let _ = resumed.recv();
            });
        });
        (announcements, go_on)
    }

    /// The next announcement, which the index is holding at.
    fn next(announcements: &Receiver<(Vec<String>, bool)>) -> (Vec<String>, bool) {
        announcements
            .recv_timeout(ANNOUNCED_WITHIN)
            .unwrap_or_else(|_| panic!("the index announced nothing within {ANNOUNCED_WITHIN:?}"))
    }

    /// The first announcement to offer `path`, with the index held there.
    fn until(
        announcements: &Receiver<(Vec<String>, bool)>,
        go_on: &Sender<()>,
        path: &str,
    ) -> Vec<String> {
        loop {
            let (files, _) = next(announcements);
            if files.iter().any(|file| file == path) {
                return files;
            }
            let _ = go_on.send(());
        }
    }

    /// What the walk's last announcement offers, with the index held there.
    fn walked(announcements: &Receiver<(Vec<String>, bool)>, go_on: &Sender<()>) -> Vec<String> {
        loop {
            let (files, indexing) = next(announcements);
            if !indexing {
                return files;
            }
            let _ = go_on.send(());
        }
    }
}
