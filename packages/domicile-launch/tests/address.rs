//! What `domicile open-url` hands the engine, from the word it was given.

use std::path::Path;

use domicile_launch::address::url_for;

#[test]
fn an_address_is_handed_on_as_it_was_given() {
    assert_eq!(
        url_for("https://example.com/a?b=c#d", Path::new("/work")),
        "https://example.com/a?b=c#d"
    );
    assert_eq!(
        url_for("mailto:someone@example.com", Path::new("/work")),
        "mailto:someone@example.com"
    );
}

#[test]
fn a_path_is_a_file_in_the_directory_it_was_typed_in() {
    // `cargo doc --open` hands `BROWSER` a path, not a URL — and relative to a
    // working directory the engine does not share.
    assert_eq!(
        url_for("target/doc/index.html", Path::new("/work")),
        "file:///work/target/doc/index.html"
    );
    assert_eq!(
        url_for("/tmp/page.html", Path::new("/work")),
        "file:///tmp/page.html"
    );
}

#[test]
fn a_path_is_escaped_into_a_url() {
    // A space, or a `#`, is a different address unescaped: the first is no
    // URL at all and the second is a fragment of a shorter path.
    assert_eq!(
        url_for("/tmp/my page #2.html", Path::new("/work")),
        "file:///tmp/my%20page%20%232.html"
    );
}
