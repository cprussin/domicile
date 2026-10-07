//! Paper sizes from their PWG 5101.1 self-describing names, such as
//! `iso_a4_210x297mm`: `class_size_dimensions`.

/// A paper size a media name describes.
#[derive(Debug, Clone, PartialEq)]
pub struct Paper {
    /// The name without its dimensions, such as `iso_a4`, as GTK names paper.
    pub name: String,
    pub width_mm: f64,
    pub height_mm: f64,
}

impl Paper {
    /// The paper `media` names. `None` for a name that is not
    /// self-describing, or one that bounds custom sizes (`custom_min_…`).
    pub fn of(media: &str) -> Option<Paper> {
        let described = Described::of(media)?;
        let millimeters = match described.unit {
            "mm" => 1.0,
            _ => 25.4,
        };
        Some(Paper {
            name: described.name.into(),
            width_mm: described.width.parse::<f64>().ok()? * millimeters,
            height_mm: described.height.parse::<f64>().ok()? * millimeters,
        })
    }
}

/// `media` for people: `A4 (210 × 297 mm)`. The name itself when it is not
/// self-describing.
pub fn label(media: &str) -> String {
    match Described::of(media) {
        Some(described) => {
            let size: Vec<String> = described.size.split('-').map(capitalized).collect();
            format!(
                "{} ({} × {} {})",
                size.join(" "),
                described.width,
                described.height,
                described.unit
            )
        }
        None => media.into(),
    }
}

/// A self-describing name's parts, as written.
struct Described<'a> {
    /// `class_size`.
    name: &'a str,
    size: &'a str,
    width: &'a str,
    height: &'a str,
    /// `mm` or `in`.
    unit: &'a str,
}

impl<'a> Described<'a> {
    fn of(media: &'a str) -> Option<Described<'a>> {
        let (name, dimensions) = media.rsplit_once('_')?;
        let (class, size) = name.split_once('_')?;
        let unit = ["mm", "in"]
            .into_iter()
            .find(|unit| dimensions.ends_with(unit))?;
        let (width, height) = dimensions[..dimensions.len() - unit.len()].split_once('x')?;
        let bounds = class == "custom" && (size.starts_with("min") || size.starts_with("max"));
        let numbers = [width, height]
            .iter()
            .all(|number| number.parse::<f64>().is_ok());
        (numbers && !bounds).then_some(Described {
            name,
            size,
            width,
            height,
            unit,
        })
    }
}

fn capitalized(word: &str) -> String {
    let mut letters = word.chars();
    letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_metric_size_reads_in_millimeters() {
        assert_eq!(
            Paper::of("iso_a4_210x297mm"),
            Some(Paper {
                name: "iso_a4".into(),
                width_mm: 210.0,
                height_mm: 297.0,
            })
        );
    }

    #[test]
    fn an_imperial_size_is_converted_to_millimeters() {
        let paper = Paper::of("na_letter_8.5x11in").expect("a size");

        assert_eq!(paper.name, "na_letter");
        assert!((paper.width_mm - 215.9).abs() < 1e-9, "{}", paper.width_mm);
        assert!(
            (paper.height_mm - 279.4).abs() < 1e-9,
            "{}",
            paper.height_mm
        );
    }

    #[test]
    fn a_size_name_may_hold_hyphens() {
        assert_eq!(
            Paper::of("na_index-4x6_4x6in").map(|paper| paper.name),
            Some("na_index-4x6".into())
        );
    }

    #[test]
    fn names_that_describe_no_one_size_are_not_paper() {
        for media in [
            "A4",
            "custom_min_3x5in",
            "custom_max_8.5x14in",
            "iso_a4_210x297",
            "iso_a4_axbmm",
        ] {
            assert_eq!(Paper::of(media), None, "{media}");
        }
    }

    #[test]
    fn a_label_names_the_size_and_its_dimensions() {
        assert_eq!(label("iso_a4_210x297mm"), "A4 (210 × 297 mm)");
        assert_eq!(label("na_letter_8.5x11in"), "Letter (8.5 × 11 in)");
        assert_eq!(label("na_index-4x6_4x6in"), "Index 4x6 (4 × 6 in)");
        assert_eq!(label("Custom"), "Custom");
    }
}
