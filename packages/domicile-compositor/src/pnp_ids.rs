//! Maps a monitor's three-letter EDID vendor id to the vendor's name.
//!
//! An EDID names its maker only by an id such as `DEL`, `BOE` or `GSM`.
//! hwdata's `pnp.ids` maps these to names. Chromium does not ship it, so
//! panel names from the engine arrive with the raw id.
//!
//! The table is GPL-2+ and this tree is MIT OR Apache-2.0, so it is never
//! embedded or generated from. It is read at run time from the machine's
//! copy; without one, names keep the id and [`read_the_table`] says why.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::PathBuf;

use thiserror::Error;

/// The environment variable naming the table to read.
///
/// Read at run time because `cargo` builds and the flake's install are the
/// same binary. The flake's wrapper sets it; a checkout falls back to
/// [`where_hwdata_keeps_it`].
const STATED: &str = "DOMICILE_PNP_IDS";

/// hwdata's `pnp.ids`, as the lookup a monitor's name needs.
#[derive(Debug)]
pub struct Vendors {
    by_id: HashMap<String, String>,
}

impl Vendors {
    /// Parse a table in hwdata's format: an id, a tab, the vendor's name.
    ///
    /// Lenient, because it is someone else's file and a bad line only costs
    /// one monitor its name. Blank lines and `#` comments are skipped; other
    /// lines split at the first whitespace.
    ///
    /// Ids are stored and looked up uppercase: hwdata has lowercase entries
    /// (`inu`) and EDIDs are uppercase.
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

    /// `description` with its leading id replaced by the vendor's name, or
    /// `None` if the table lacks the id.
    ///
    /// Returns `None` rather than `description` because callers differ: a
    /// `wl_output` wants the best name, while profiles must keep matching the
    /// id a config was written with.
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

    /// A file with no readable entries. hwdata's table has about 2500, so an
    /// empty one is the wrong file.
    #[error("the pnp.ids at {} names no vendors at all", path.display())]
    NamesNothing { path: PathBuf },
}

/// The machine's table, or why it has none.
///
/// The error is returned, not logged, so the caller that decides to carry on
/// without names is the one place that reports it.
pub fn read_the_table() -> Result<Vendors, NoTable> {
    read(&where_hwdata_keeps_it(
        std::env::var(STATED).ok().as_deref(),
    ))
}

/// Candidate paths for hwdata's table, most specific first.
///
/// `stated` is the exact store path the flake's wrapper sets. The others are
/// where distributions install `hwdata`, used by `cargo run` from a checkout.
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

/// The table at the first candidate path that exists.
///
/// A missing path moves on to the next. An existing but unreadable one is an
/// error, because it means the machine is misconfigured.
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
            // Only a missing file means "try the next path".
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
