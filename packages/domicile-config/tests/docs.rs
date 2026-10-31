//! Every config example in the docs parses, so a reader can copy one.

use std::fs;
use std::path::{Path, PathBuf};

use domicile_config::Config;

/// The pages that show config files: the user guide and the reference.
fn pages() -> Vec<PathBuf> {
    let docs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs");
    let mut pages: Vec<PathBuf> = fs::read_dir(docs.join("use"))
        .expect("the user guide is there")
        .map(|entry| entry.expect("a guide page").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "md"))
        .collect();
    pages.extend(
        [
            "SHELL-CONFIG.md",
            "RUNNING-A-DESKTOP.md",
            "DISPLAYS.md",
            "IDLE.md",
            "LOCK.md",
        ]
        .map(|page| docs.join(page)),
    );
    pages
}

/// Each ```json block of `text`.
fn json_blocks(text: &str) -> Vec<&str> {
    text.split("```json\n")
        .skip(1)
        .map(|rest| rest.split("```").next().expect("a block ends"))
        .collect()
}

#[test]
fn every_config_example_in_the_docs_parses() {
    let mut failures = Vec::new();
    for page in pages() {
        let text = fs::read_to_string(&page).expect("the page reads");
        for block in json_blocks(&text) {
            if let Err(error) = Config::parse(block) {
                failures.push(format!("{}:\n{block}\n{error}", page.display()));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
