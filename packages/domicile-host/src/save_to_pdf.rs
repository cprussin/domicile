//! Save to PDF, as the print dialog offers it: a printer that writes the
//! application's own document to a file.

use domicile_protocol::{Media, Orientation, PrintOptions, Printer};

use crate::print_media::label;

/// The papers a PDF can take, Letter first.
const PAPERS: [&str; 6] = [
    "na_letter_8.5x11in",
    "na_legal_8.5x14in",
    "na_ledger_11x17in",
    "iso_a3_297x420mm",
    "iso_a4_210x297mm",
    "iso_a5_148x210mm",
];

/// Save to PDF's paper, orientation and pages, starting on Letter in
/// portrait. One copy: a second is the same file.
pub fn printer() -> Printer {
    Printer {
        name: "pdf".into(),
        description: Some("Save to PDF".into()),
        media: PAPERS
            .into_iter()
            .map(|name| Media {
                name: name.into(),
                label: label(name),
            })
            .collect(),
        sides: Vec::new(),
        color_modes: Vec::new(),
        orientations: vec![Orientation::Portrait, Orientation::Landscape],
        qualities: Vec::new(),
        copies_max: 1,
        page_ranges: true,
        initial: PrintOptions {
            media: Some(PAPERS[0].into()),
            copies: 1,
            sides: None,
            color_mode: None,
            orientation: Some(Orientation::Portrait),
            quality: None,
            pages: Vec::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_offers_paper_orientation_and_pages_and_starts_on_letter() {
        let pdf = printer();

        assert_eq!(
            pdf.media.first(),
            Some(&Media {
                name: "na_letter_8.5x11in".into(),
                label: "Letter (8.5 × 11 in)".into(),
            })
        );
        assert!(pdf
            .media
            .iter()
            .any(|media| media.label == "A4 (210 × 297 mm)"));
        assert_eq!(
            pdf.orientations,
            [Orientation::Portrait, Orientation::Landscape]
        );
        assert!(pdf.page_ranges);
        assert_eq!(pdf.copies_max, 1);
        assert!(pdf.sides.is_empty() && pdf.color_modes.is_empty() && pdf.qualities.is_empty());
        assert_eq!(pdf.initial.media.as_deref(), Some("na_letter_8.5x11in"));
    }
}
