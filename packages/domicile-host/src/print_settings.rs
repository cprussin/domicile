//! The Print portal's `settings` and `page-setup`, as GTK serializes
//! `GtkPrintSettings` and `GtkPageSetup`, to and from [`PrintOptions`].
//!
//! Applications hand back what they were given, so these round-trip. GTK
//! counts `page-ranges` from 0; [`PageRange`] counts from 1.

use std::collections::HashMap;

use domicile_protocol::{
    ColorMode, Orientation, PageRange, PrintOptions, PrintQuality, Printer, Sides,
};

use crate::print_media::{label, Paper};

/// GTK's `duplex` values.
const SIDES: [(Sides, &str); 3] = [
    (Sides::OneSided, "simplex"),
    (Sides::TwoSidedLongEdge, "horizontal"),
    (Sides::TwoSidedShortEdge, "vertical"),
];

/// GTK's `use-color` values.
const COLOR_MODES: [(ColorMode, &str); 2] =
    [(ColorMode::Color, "true"), (ColorMode::Monochrome, "false")];

/// GTK's `orientation` values, and the page setup's `Orientation`.
const ORIENTATIONS: [(Orientation, &str); 4] = [
    (Orientation::Portrait, "portrait"),
    (Orientation::Landscape, "landscape"),
    (Orientation::ReverseLandscape, "reverse_landscape"),
    (Orientation::ReversePortrait, "reverse_portrait"),
];

/// GTK's `quality` values.
const QUALITIES: [(PrintQuality, &str); 3] = [
    (PrintQuality::Draft, "draft"),
    (PrintQuality::Normal, "normal"),
    (PrintQuality::High, "high"),
];

/// What an application's settings and page setup ask for. An absent field
/// leaves the printer's default.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Preset {
    /// The printer's CUPS name.
    pub printer: Option<String>,
    /// A [`Paper::name`].
    paper: Option<String>,
    copies: Option<u32>,
    sides: Option<Sides>,
    color_mode: Option<ColorMode>,
    orientation: Option<Orientation>,
    quality: Option<PrintQuality>,
    /// Empty for every page.
    pages: Option<Vec<PageRange>>,
}

impl Preset {
    /// Read the string values of `settings` and `page_setup`. A value GTK
    /// would not write reads as absent. The settings win over the page setup.
    pub fn read(
        settings: &HashMap<String, String>,
        page_setup: &HashMap<String, String>,
    ) -> Preset {
        let setting = |key: &str| settings.get(key).map(String::as_str);
        let either = |key: &str, page_key: &str| {
            setting(key).or(page_setup.get(page_key).map(String::as_str))
        };
        Preset {
            printer: setting("printer").map(String::from),
            paper: either("paper-format", "Name").map(String::from),
            copies: setting("n-copies").and_then(|copies| copies.parse().ok()),
            sides: setting("duplex").and_then(|text| named(&SIDES, text)),
            color_mode: setting("use-color").and_then(|text| named(&COLOR_MODES, text)),
            orientation: either("orientation", "Orientation")
                .and_then(|text| named(&ORIENTATIONS, text)),
            quality: setting("quality").and_then(|text| named(&QUALITIES, text)),
            pages: match setting("print-pages") {
                Some("all") => Some(Vec::new()),
                Some("ranges") => setting("page-ranges").and_then(page_ranges),
                _ => None,
            },
        }
    }

    /// `printer`'s options, with this preset where the printer supports it.
    pub fn applied(&self, printer: &Printer) -> PrintOptions {
        let initial = &printer.initial;
        let media = self.paper.as_ref().and_then(|paper| {
            printer
                .media
                .iter()
                .find(|media| Paper::of(&media.name).is_some_and(|offered| &offered.name == paper))
        });
        PrintOptions {
            media: media
                .map(|media| media.name.clone())
                .or(initial.media.clone()),
            copies: self
                .copies
                .filter(|copies| (1..=printer.copies_max).contains(copies))
                .unwrap_or(initial.copies),
            sides: supported(self.sides, &printer.sides).or(initial.sides),
            color_mode: supported(self.color_mode, &printer.color_modes).or(initial.color_mode),
            orientation: supported(self.orientation, &printer.orientations).or(initial.orientation),
            quality: supported(self.quality, &printer.qualities).or(initial.quality),
            pages: self
                .pages
                .clone()
                .filter(|_| printer.page_ranges)
                .unwrap_or(initial.pages.clone()),
        }
    }
}

/// GTK's page setup: the paper and orientation.
#[derive(Debug, Clone, PartialEq)]
pub struct PageSetup {
    /// A [`Paper::name`].
    pub name: String,
    pub display_name: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub orientation: Option<&'static str>,
}

/// The settings `options` on `printer` set, to lay over the application's
/// own so that keys this does not know survive.
pub fn settings(printer: &str, options: &PrintOptions) -> Vec<(&'static str, String)> {
    let paper = options.media.as_deref().and_then(Paper::of);
    let pages = if options.pages.is_empty() {
        "all"
    } else {
        "ranges"
    };
    [
        Some(("printer", printer.to_string())),
        Some(("n-copies", options.copies.to_string())),
        paper
            .as_ref()
            .map(|paper| ("paper-format", paper.name.clone())),
        paper
            .as_ref()
            .map(|paper| ("paper-width", millimeters(paper.width_mm))),
        paper
            .as_ref()
            .map(|paper| ("paper-height", millimeters(paper.height_mm))),
        options
            .sides
            .map(|sides| ("duplex", name(&SIDES, sides).into())),
        options
            .color_mode
            .map(|mode| ("use-color", name(&COLOR_MODES, mode).into())),
        options
            .orientation
            .map(|orientation| ("orientation", name(&ORIENTATIONS, orientation).into())),
        options
            .quality
            .map(|quality| ("quality", name(&QUALITIES, quality).into())),
        Some(("print-pages", pages.into())),
        (!options.pages.is_empty()).then(|| ("page-ranges", gtk_ranges(&options.pages))),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The page setup for `options`. `None` when its media names no one size.
pub fn page_setup(options: &PrintOptions) -> Option<PageSetup> {
    let media = options.media.as_deref()?;
    let paper = Paper::of(media)?;
    Some(PageSetup {
        name: paper.name,
        display_name: label(media),
        width_mm: paper.width_mm,
        height_mm: paper.height_mm,
        orientation: options
            .orientation
            .map(|orientation| name(&ORIENTATIONS, orientation)),
    })
}

/// The value `table` spells `text`.
fn named<T: Copy>(table: &[(T, &str)], text: &str) -> Option<T> {
    table
        .iter()
        .find(|(_, spelled)| *spelled == text)
        .map(|(value, _)| *value)
}

/// How `table` spells `value`.
fn name<T: PartialEq>(table: &[(T, &'static str)], value: T) -> &'static str {
    table
        .iter()
        .find(|(listed, _)| *listed == value)
        .map(|(_, spelled)| *spelled)
        .expect("every value is in its table")
}

/// `wanted`, if `offered` holds it.
fn supported<T: PartialEq>(wanted: Option<T>, offered: &[T]) -> Option<T> {
    wanted.filter(|wanted| offered.contains(wanted))
}

/// GTK's `page-ranges`, such as `0-2,4`, counted from 1.
fn page_ranges(text: &str) -> Option<Vec<PageRange>> {
    text.split(',')
        .map(|range| {
            let (first, last) = range.split_once('-').unwrap_or((range, range));
            let first = first.trim().parse::<u32>().ok()? + 1;
            let last = last.trim().parse::<u32>().ok()? + 1;
            (first <= last).then_some(PageRange { first, last })
        })
        .collect()
}

/// `pages` as GTK's `page-ranges`, counted from 0.
fn gtk_ranges(pages: &[PageRange]) -> String {
    pages
        .iter()
        .map(|range| {
            if range.first == range.last {
                format!("{}", range.first - 1)
            } else {
                format!("{}-{}", range.first - 1, range.last - 1)
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// `length` to a hundredth of a millimeter, as GTK writes it.
fn millimeters(length: f64) -> String {
    format!("{}", (length * 100.0).round() / 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_protocol::Media;

    fn strings(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    fn a4_landscape() -> PrintOptions {
        PrintOptions {
            media: Some("iso_a4_210x297mm".into()),
            copies: 3,
            sides: Some(Sides::TwoSidedShortEdge),
            color_mode: Some(ColorMode::Monochrome),
            orientation: Some(Orientation::Landscape),
            quality: Some(PrintQuality::Draft),
            pages: vec![
                PageRange { first: 1, last: 3 },
                PageRange { first: 5, last: 5 },
            ],
        }
    }

    fn printer() -> Printer {
        Printer {
            name: "office".into(),
            description: None,
            media: ["na_letter_8.5x11in", "iso_a4_210x297mm"]
                .into_iter()
                .map(|name| Media {
                    name: name.into(),
                    label: label(name),
                })
                .collect(),
            sides: vec![
                Sides::OneSided,
                Sides::TwoSidedLongEdge,
                Sides::TwoSidedShortEdge,
            ],
            color_modes: vec![ColorMode::Color, ColorMode::Monochrome],
            orientations: vec![
                Orientation::Portrait,
                Orientation::Landscape,
                Orientation::ReverseLandscape,
                Orientation::ReversePortrait,
            ],
            qualities: vec![
                PrintQuality::Draft,
                PrintQuality::Normal,
                PrintQuality::High,
            ],
            copies_max: 99,
            page_ranges: true,
            initial: PrintOptions {
                media: Some("na_letter_8.5x11in".into()),
                copies: 1,
                sides: Some(Sides::OneSided),
                color_mode: Some(ColorMode::Color),
                orientation: Some(Orientation::Portrait),
                quality: Some(PrintQuality::Normal),
                pages: Vec::new(),
            },
        }
    }

    #[test]
    fn gtk_settings_read_as_a_preset() {
        let preset = Preset::read(
            &strings(&[
                ("printer", "office"),
                ("paper-format", "iso_a4"),
                ("n-copies", "3"),
                ("duplex", "vertical"),
                ("use-color", "false"),
                ("orientation", "reverse_landscape"),
                ("quality", "high"),
                ("print-pages", "ranges"),
                ("page-ranges", "0-2,4"),
            ]),
            &HashMap::new(),
        );

        assert_eq!(
            preset,
            Preset {
                printer: Some("office".into()),
                paper: Some("iso_a4".into()),
                copies: Some(3),
                sides: Some(Sides::TwoSidedShortEdge),
                color_mode: Some(ColorMode::Monochrome),
                orientation: Some(Orientation::ReverseLandscape),
                quality: Some(PrintQuality::High),
                pages: Some(vec![
                    PageRange { first: 1, last: 3 },
                    PageRange { first: 5, last: 5 }
                ]),
            }
        );
    }

    #[test]
    fn the_page_setup_names_the_paper_and_orientation_the_settings_leave_out() {
        let page_setup = strings(&[("Name", "iso_a4"), ("Orientation", "landscape")]);

        let preset = Preset::read(&HashMap::new(), &page_setup);
        assert_eq!(preset.paper.as_deref(), Some("iso_a4"));
        assert_eq!(preset.orientation, Some(Orientation::Landscape));

        let preset = Preset::read(&strings(&[("orientation", "portrait")]), &page_setup);
        assert_eq!(preset.orientation, Some(Orientation::Portrait));
    }

    #[test]
    fn values_gtk_would_not_write_read_as_absent() {
        let preset = Preset::read(
            &strings(&[
                ("n-copies", "many"),
                ("duplex", "sideways"),
                ("use-color", "maybe"),
                ("quality", "superb"),
                ("print-pages", "ranges"),
                ("page-ranges", "3-x"),
            ]),
            &HashMap::new(),
        );

        assert_eq!(preset, Preset::default());
    }

    #[test]
    fn every_page_is_no_ranges_and_other_selections_are_left_alone() {
        let pages = |print_pages: &str| {
            Preset::read(
                &strings(&[("print-pages", print_pages), ("page-ranges", "1")]),
                &HashMap::new(),
            )
            .pages
        };

        assert_eq!(pages("all"), Some(Vec::new()));
        assert_eq!(pages("current"), None);
    }

    #[test]
    fn a_preset_applies_only_what_the_printer_supports() {
        let preset = Preset::read(
            &strings(&[
                ("paper-format", "iso_a3"),
                ("n-copies", "500"),
                ("duplex", "horizontal"),
                ("quality", "draft"),
            ]),
            &HashMap::new(),
        );
        let narrow = Printer {
            sides: Vec::new(),
            page_ranges: false,
            ..printer()
        };

        assert_eq!(
            preset.applied(&narrow),
            PrintOptions {
                quality: Some(PrintQuality::Draft),
                ..printer().initial
            }
        );
    }

    #[test]
    fn chosen_options_are_written_as_gtk_settings() {
        assert_eq!(
            settings("office", &a4_landscape()),
            [
                ("printer", "office".to_string()),
                ("n-copies", "3".into()),
                ("paper-format", "iso_a4".into()),
                ("paper-width", "210".into()),
                ("paper-height", "297".into()),
                ("duplex", "vertical".into()),
                ("use-color", "false".into()),
                ("orientation", "landscape".into()),
                ("quality", "draft".into()),
                ("print-pages", "ranges".into()),
                ("page-ranges", "0-2,4".into()),
            ]
        );
    }

    #[test]
    fn written_settings_read_back_as_the_same_options() {
        let written: HashMap<String, String> = settings("office", &a4_landscape())
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect();

        let preset = Preset::read(&written, &HashMap::new());
        assert_eq!(preset.printer.as_deref(), Some("office"));
        assert_eq!(preset.applied(&printer()), a4_landscape());
    }

    #[test]
    fn the_page_setup_is_the_chosen_paper() {
        assert_eq!(
            page_setup(&a4_landscape()),
            Some(PageSetup {
                name: "iso_a4".into(),
                display_name: "A4 (210 × 297 mm)".into(),
                width_mm: 210.0,
                height_mm: 297.0,
                orientation: Some("landscape"),
            })
        );
        let unnamed = PrintOptions {
            media: None,
            ..a4_landscape()
        };
        assert_eq!(page_setup(&unnamed), None);
    }
}
