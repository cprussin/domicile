//! Wire shapes for the print dialog.
//!
//! Pinned as JSON because the SDK hard-codes them. See
//! `packages/domicile-compositor/src/portals/README.md`.

use domicile_protocol::{
    ChromeMessage, ColorMode, Media, Orientation, PageRange, PortalAnswer, PortalKind, PrintDialog,
    PrintOptions, PrintQuality, Printer, Sides,
};

fn options() -> PrintOptions {
    PrintOptions {
        media: Some("iso_a4_210x297mm".into()),
        copies: 2,
        sides: Some(Sides::TwoSidedLongEdge),
        color_mode: Some(ColorMode::Monochrome),
        orientation: Some(Orientation::ReverseLandscape),
        quality: Some(PrintQuality::High),
        pages: vec![PageRange { first: 1, last: 3 }],
    }
}

fn dialog() -> PrintDialog {
    PrintDialog {
        title: "Report".into(),
        accept_label: None,
        printers: vec![Printer {
            name: "office".into(),
            description: Some("Office laser".into()),
            media: vec![Media {
                name: "iso_a4_210x297mm".into(),
                label: "A4 (210 × 297 mm)".into(),
            }],
            sides: vec![Sides::OneSided, Sides::TwoSidedShortEdge],
            color_modes: vec![ColorMode::Color],
            orientations: vec![Orientation::Portrait, Orientation::ReversePortrait],
            qualities: vec![PrintQuality::Draft, PrintQuality::Normal],
            copies_max: 99,
            page_ranges: true,
            initial: options(),
        }],
        printer: Some("office".into()),
    }
}

#[test]
fn a_print_dialog_lists_each_printer_with_its_options() {
    let written = serde_json::to_string(&PortalKind::Print(dialog())).expect("it serializes");

    assert_eq!(
        written,
        concat!(
            r#"{"kind":"print","body":{"title":"Report","printers":[{"name":"office","#,
            r#""description":"Office laser","media":[{"name":"iso_a4_210x297mm","label":"A4 (210 × 297 mm)"}],"#,
            r#""sides":["one_sided","two_sided_short_edge"],"color_modes":["color"],"#,
            r#""orientations":["portrait","reverse_portrait"],"qualities":["draft","normal"],"#,
            r#""copies_max":99,"page_ranges":true,"initial":{"media":"iso_a4_210x297mm","#,
            r#""copies":2,"sides":"two_sided_long_edge","color_mode":"monochrome","#,
            r#""orientation":"reverse_landscape","quality":"high","pages":[{"first":1,"last":3}]}}],"#,
            r#""printer":"office"}}"#
        )
    );
}

#[test]
fn a_print_answer_parses() {
    let line = concat!(
        r#"{"type":"answer_portal_request","id":4,"answer":{"kind":"print","printer":"office","#,
        r#""options":{"copies":1,"pages":[]}}}"#
    );

    assert_eq!(
        serde_json::from_str::<ChromeMessage>(line).expect("the SDK's own wire form"),
        ChromeMessage::AnswerPortalRequest {
            id: 4,
            answer: PortalAnswer::Print {
                printer: "office".into(),
                options: PrintOptions {
                    media: None,
                    copies: 1,
                    sides: None,
                    color_mode: None,
                    orientation: None,
                    quality: None,
                    pages: Vec::new(),
                },
            },
        }
    );
}

#[test]
fn a_print_dialog_takes_only_a_printer_it_offered() {
    let print = PortalKind::Print(dialog());
    let chose = |printer: &str| PortalAnswer::Print {
        printer: printer.into(),
        options: options(),
    };

    assert!(print.accepts(&chose("office")));
    assert!(!print.accepts(&chose("elsewhere")));
    assert!(!print.accepts(&PortalAnswer::Access));
    assert!(print.accepts(&PortalAnswer::Canceled));
    assert_eq!(chose("office").response(), 0);
}

#[test]
fn a_print_answer_with_no_copies_or_impossible_pages_is_not_taken() {
    let print = PortalKind::Print(dialog());
    let chose = |copies: u32, first: u32, last: u32| PortalAnswer::Print {
        printer: "office".into(),
        options: PrintOptions {
            copies,
            pages: vec![PageRange { first, last }],
            ..options()
        },
    };

    assert!(print.accepts(&chose(1, 2, 2)));
    assert!(!print.accepts(&chose(0, 1, 1)));
    assert!(!print.accepts(&chose(1, 0, 1)));
    assert!(!print.accepts(&chose(1, 3, 2)));
}
