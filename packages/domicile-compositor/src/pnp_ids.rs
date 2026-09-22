//! The vendor behind a monitor's three-letter id.
//!
//! An EDID names its maker in three letters — `DEL`, `BOE`, `GSM` — and
//! nothing else. The table that turns those into `Dell Inc.`, `BOE` and
//! `LG Electronics` is hwdata's `pnp.ids`, which every distribution ships and
//! which libdisplay-info reads for exactly this; Chromium does not carry it,
//! so the engine's reading of a panel's name arrives here still spelled the
//! way the firmware spells it.
//!
//! The table is data under GPL-2+ and this tree is MIT OR Apache-2.0, so
//! nothing here is generated from it and nothing here embeds it. It is read at
//! run time from the file the machine already has, and a machine that has none
//! keeps the three letters — [`read_the_table`] is what says so out loud.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::PathBuf;

use thiserror::Error;

/// The environment variable naming the table to read.
///
/// Read at run time rather than baked in at build time, because the binary
/// this repository builds with `cargo` and the one the flake installs are the
/// same binary: the wrapper sets this, a checkout does not, and the search in
/// [`where_hwdata_keeps_it`] is what covers the second case.
const STATED: &str = "DOMICILE_PNP_IDS";

/// hwdata's `pnp.ids`, as the lookup a monitor's name needs.
#[derive(Debug)]
pub struct Vendors {
    by_id: HashMap<String, String>,
}

impl Vendors {
    /// The table, as hwdata writes one: an id, a tab, the vendor's own name.
    ///
    /// Lenient about the shape of a line and strict about nothing, because
    /// this is somebody else's file and the cost of a line it cannot read is
    /// one monitor named in three letters. Blank lines and `#` comments are
    /// not entries; anything else is split at its first run of whitespace, so
    /// a file separated by spaces reads the same as one separated by tabs.
    ///
    /// Ids are held uppercase and looked up uppercase: hwdata spells two of
    /// its own entries in lower case (`inu`), an EDID spells its maker in
    /// upper, and a monitor is not going to be named for the difference.
    pub fn listed_in(table: &str) -> Vendors {
        Vendors {
            by_id: table
                .lines()
                .filter(|line| !line.trim_start().starts_with('#'))
                .filter_map(|line| line.split_once(char::is_whitespace))
                .map(|(id, vendor)| (id.to_ascii_uppercase(), vendor.trim().to_string()))
                .filter(|(id, vendor)| !id.is_empty() && !vendor.is_empty())
                .collect(),
        }
    }

    /// The table a machine with no `pnp.ids` has.
    pub fn none() -> Vendors {
        Vendors {
            by_id: HashMap::new(),
        }
    }

    /// `description` with its three-letter id replaced by the vendor's own
    /// name, or `None` where this table does not name that id.
    ///
    /// `None` rather than the description back, because the caller's two uses
    /// differ: what a `wl_output` states wants the best name there is, and a
    /// profile has to go on matching the letters a config was written with.
    pub fn spelled_out(&self, description: &str) -> Option<String> {
        let (id, rest) = match description.split_once(' ') {
            Some((id, rest)) => (id, rest),
            None => (description, ""),
        };
        self.by_id
            .get(&id.to_ascii_uppercase())
            .map(|vendor| match rest {
                "" => vendor.clone(),
                rest => format!("{vendor} {rest}"),
            })
    }
}

/// Why this machine names no vendors.
#[derive(Debug, Error)]
pub enum NoTable {
    #[error(
        "no pnp.ids where hwdata keeps one; looked in {}",
        looked.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
    )]
    Nowhere { looked: Vec<PathBuf> },

    #[error("could not read the pnp.ids at {}: {why}", path.display())]
    Unreadable { path: PathBuf, why: std::io::Error },

    /// A file in the right place holding nothing this can read. hwdata's own
    /// table is two and a half thousand entries, so zero is a file that is not
    /// it rather than a vendor list that happens to be short.
    #[error("the pnp.ids at {} names no vendors at all", path.display())]
    NamesNothing { path: PathBuf },
}

/// The table this machine keeps, or why it keeps none.
///
/// The failure is the caller's to state and recover from — a desktop comes up
/// whether or not a monitor can be named — and it is returned rather than
/// logged here so that the one place which decides to carry on without a table
/// is also the one place that says so.
pub fn read_the_table() -> Result<Vendors, NoTable> {
    read(&where_hwdata_keeps_it(
        std::env::var(STATED).ok().as_deref(),
    ))
}

/// Every place this machine might keep hwdata's table, the most deliberate
/// first.
///
/// `stated` is what the wrapper the flake builds sets, and is an exact store
/// path. The rest is where a distribution puts the `hwdata` package's copy,
/// and is what a `cargo run` out of a checkout finds.
fn where_hwdata_keeps_it(stated: Option<&str>) -> Vec<PathBuf> {
    stated
        .map(PathBuf::from)
        .into_iter()
        .chain(
            ["/usr/share/hwdata/pnp.ids", "/usr/share/misc/pnp.ids"]
                .into_iter()
                .map(PathBuf::from),
        )
        .collect()
}

/// The first of these paths that holds a table.
///
/// A path that is not there is the next candidate's turn; a path that is there
/// and cannot be read is the answer, because a table named and unreadable is a
/// machine misconfigured rather than a machine without one.
fn read(candidates: &[PathBuf]) -> Result<Vendors, NoTable> {
    for path in candidates {
        match std::fs::read_to_string(path) {
            Ok(table) => {
                let vendors = Vendors::listed_in(&table);
                return if vendors.by_id.is_empty() {
                    Err(NoTable::NamesNothing { path: path.clone() })
                } else {
                    Ok(vendors)
                };
            }
            // The only error that means "look somewhere else". Every other one
            // is about the file that *is* there.
            Err(why) if why.kind() == ErrorKind::NotFound => {}
            Err(why) => {
                return Err(NoTable::Unreadable {
                    path: path.clone(),
                    why,
                })
            }
        }
    }
    Err(NoTable::Nowhere {
        looked: candidates.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// One entry per quirk hwdata's own file has: a tab between the two
    /// columns, a vendor name with spaces, one with a comma and a period, and
    /// an id hwdata spells in lower case.
    const TABLE: &str = "\
DEL\tDell Inc.
ABS\tAbaco Systems, Inc.
GSM\tLG Electronics
inu\tInovatec S.p.A.
";

    #[test]
    fn a_monitors_maker_is_named_the_way_the_table_names_it() {
        assert_eq!(
            Vendors::listed_in(TABLE).spelled_out("DEL DELL U3219Q 2ZLS413"),
            Some("Dell Inc. DELL U3219Q 2ZLS413".to_string())
        );
    }

    #[test]
    fn a_vendors_own_name_keeps_its_spaces_and_its_commas() {
        assert_eq!(
            Vendors::listed_in(TABLE).spelled_out("ABS SOMETHING 123"),
            Some("Abaco Systems, Inc. SOMETHING 123".to_string())
        );
    }

    #[test]
    fn an_id_the_table_spells_in_lower_case_still_answers() {
        assert_eq!(
            Vendors::listed_in(TABLE).spelled_out("INU PANEL 9"),
            Some("Inovatec S.p.A. PANEL 9".to_string())
        );
    }

    #[test]
    fn a_table_separated_by_spaces_reads_the_same_as_one_separated_by_tabs() {
        assert_eq!(
            Vendors::listed_in("GSM  LG Electronics\n").spelled_out("GSM LG HDR 4K"),
            Some("LG Electronics LG HDR 4K".to_string())
        );
    }

    #[test]
    fn a_comment_and_a_blank_line_are_not_entries() {
        assert_eq!(
            Vendors::listed_in("# List of PNP IDs\n\nDEL\tDell Inc.\n").spelled_out("DEL U2717D"),
            Some("Dell Inc. U2717D".to_string())
        );
    }

    #[test]
    fn a_monitor_that_states_only_its_maker_is_still_spelled_out() {
        assert_eq!(
            Vendors::listed_in(TABLE).spelled_out("DEL"),
            Some("Dell Inc.".to_string())
        );
    }

    #[test]
    fn an_id_no_table_names_is_left_the_way_the_edid_spelled_it() {
        assert_eq!(Vendors::listed_in(TABLE).spelled_out("ZZZ PANEL 1"), None);
    }

    #[test]
    fn a_monitor_that_states_nothing_has_no_vendor_to_spell_out() {
        assert_eq!(Vendors::listed_in(TABLE).spelled_out(""), None);
    }

    #[test]
    fn a_machine_with_no_table_names_nobody() {
        assert_eq!(Vendors::none().spelled_out("DEL U2717D"), None);
    }

    #[test]
    fn the_path_the_flake_states_is_looked_at_before_anywhere_else() {
        assert_eq!(
            where_hwdata_keeps_it(Some("/nix/store/abc-hwdata/share/hwdata/pnp.ids"))
                .first()
                .map(PathBuf::as_path),
            Some(Path::new("/nix/store/abc-hwdata/share/hwdata/pnp.ids"))
        );
    }

    #[test]
    fn a_checkout_that_states_nothing_looks_where_a_distribution_installs_one() {
        assert_eq!(
            where_hwdata_keeps_it(None),
            vec![
                PathBuf::from("/usr/share/hwdata/pnp.ids"),
                PathBuf::from("/usr/share/misc/pnp.ids"),
            ]
        );
    }

    #[test]
    fn a_path_that_is_not_there_is_the_next_candidates_turn() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let table = dir.path().join("pnp.ids");
        std::fs::write(&table, TABLE).expect("writing the table");
        let read = read(&[dir.path().join("nothing-here"), table]).expect("a table");
        assert_eq!(
            read.spelled_out("DEL U2717D"),
            Some("Dell Inc. U2717D".to_string())
        );
    }

    #[test]
    fn a_machine_with_the_table_nowhere_says_everywhere_it_looked() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let looked_in = dir.path().join("nothing-here");
        let error = read(std::slice::from_ref(&looked_in)).expect_err("no table anywhere");
        assert!(
            matches!(&error, NoTable::Nowhere { looked } if looked == &vec![looked_in]),
            "{error}"
        );
    }

    #[test]
    fn a_table_that_is_there_and_cannot_be_read_is_not_a_machine_without_one() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let error = read(&[dir.path().to_path_buf()]).expect_err("a path that is not a file");
        assert!(matches!(error, NoTable::Unreadable { .. }), "{error}");
    }

    #[test]
    fn a_file_in_the_right_place_that_names_nobody_is_not_the_table() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let table = dir.path().join("pnp.ids");
        std::fs::write(&table, "# nothing but a header\n").expect("writing the file");
        let error = read(std::slice::from_ref(&table)).expect_err("a file that is not hwdata's");
        assert!(
            matches!(&error, NoTable::NamesNothing { path } if path == &table),
            "{error}"
        );
    }
}
