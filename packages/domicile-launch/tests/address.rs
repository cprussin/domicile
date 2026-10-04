//! Tests for the URL `domicile open-url` sends the engine.

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
    // `cargo doc --open` passes `BROWSER` a relative path, and the engine has
    // a different working directory.
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
    // Unescaped, a space makes an invalid URL and `#` starts a fragment.
    assert_eq!(
        url_for("/tmp/my page #2.html", Path::new("/work")),
        "file:///tmp/my%20page%20%232.html"
    );
}
