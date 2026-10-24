//! Cursor sessions: what a client is told of the pointer over a source, and
//! when its capture session copies the pointer's image.
//!
//! Generic over the frame so the rules are tested without a client.

use crate::casting::{Over, Sprite};

/// What a cursor session's client hears.
#[derive(Debug, PartialEq, Eq)]
pub enum Told {
    Enter,
    Leave,
    /// The hotspot's place in the source's pixels.
    Position((i32, i32)),
    /// The hotspot in the image's pixels.
    Hotspot((i32, i32)),
}

/// What a cursor session's client was last told.
#[derive(Default)]
pub struct Pointing {
    /// Where the pointer is and its hotspot, while it is over the source.
    shown: Option<((i32, i32), (i32, i32))>,
}

impl Pointing {
    /// The pointer is `over` the source, or off it. Returns what the client
    /// has not heard.
    pub fn moved(&mut self, over: Option<&Over>) -> Vec<Told> {
        let now = over.map(|over| {
            let (x, y) = over.at;
            ((x.round() as i32, y.round() as i32), over.sprite.hotspot)
        });
        let before = std::mem::replace(&mut self.shown, now);
        match (before, now) {
            (None, None) => Vec::new(),
            (Some(_), None) => vec![Told::Leave],
            (None, Some((at, hotspot))) => {
                vec![Told::Enter, Told::Position(at), Told::Hotspot(hotspot)]
            }
            (Some((was_at, was_hotspot)), Some((at, hotspot))) => {
                let mut told = Vec::new();
                if at != was_at {
                    told.push(Told::Position(at));
                }
                if hotspot != was_hotspot {
                    told.push(Told::Hotspot(hotspot));
                }
                told
            }
        }
    }
}

/// What a cursor capture session does.
#[derive(Debug, PartialEq)]
pub enum Imaged<F> {
    /// Offer buffers of this size.
    Constrain((u32, u32)),
    /// The frame fails: its buffer is no longer the image's size.
    Fail(F),
    /// Copy the image into the frame's buffer, and it is ready.
    Copy(F, Sprite),
}

/// A cursor capture session's image: its size, the last one copied and the
/// frame that waits for a new one.
pub struct Imaging<F> {
    size: Option<(u32, u32)>,
    copied: Option<Sprite>,
    waiting: Option<F>,
}

impl<F> Imaging<F> {
    pub fn new() -> Self {
        Self {
            size: None,
            copied: None,
            waiting: None,
        }
    }

    /// The image is `sprite`, or there is none while the pointer is off the
    /// source.
    pub fn drawn(&mut self, sprite: Option<&Sprite>) -> Vec<Imaged<F>> {
        let Some(sprite) = sprite else {
            return Vec::new();
        };
        let mut done = Vec::new();
        if self.size != Some(sprite.size) {
            self.size = Some(sprite.size);
            done.push(Imaged::Constrain(sprite.size));
            done.extend(self.waiting.take().map(Imaged::Fail));
            return done;
        }
        if self.copied.as_ref() != Some(sprite) {
            if let Some(frame) = self.waiting.take() {
                self.copied = Some(sprite.clone());
                done.push(Imaged::Copy(frame, sprite.clone()));
            }
        }
        done
    }

    /// `frame` captures into a buffer of `size` while the image is `sprite`.
    /// `None` when the buffer is not the image's size.
    pub fn capture(
        &mut self,
        frame: F,
        size: (u32, u32),
        sprite: Option<&Sprite>,
    ) -> Option<Vec<Imaged<F>>> {
        if self.size != Some(size) {
            return None;
        }
        match sprite {
            Some(sprite) if sprite.size == size && self.copied.as_ref() != Some(sprite) => {
                self.copied = Some(sprite.clone());
                Some(vec![Imaged::Copy(frame, sprite.clone())])
            }
            _ => {
                self.waiting = Some(frame);
                Some(Vec::new())
            }
        }
    }

    /// The waiting frame is gone.
    pub fn abandoned(&mut self) {
        self.waiting = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sprite(size: (u32, u32), hotspot: (i32, i32), byte: u8) -> Sprite {
        let pixels = vec![byte; (size.0 * size.1 * 4) as usize];
        Sprite::from_bgra(size, hotspot, 1.0, pixels).expect("a sprite")
    }

    fn over(at: (f64, f64), sprite: Sprite) -> Over {
        Over { at, sprite }
    }

    #[test]
    fn the_client_hears_the_pointer_enter_move_and_leave() {
        let mut pointing = Pointing::default();
        let arrow = sprite((1, 1), (0, 0), 1);

        assert_eq!(pointing.moved(None), []);
        assert_eq!(
            pointing.moved(Some(&over((1.4, 2.6), arrow.clone()))),
            [Told::Enter, Told::Position((1, 3)), Told::Hotspot((0, 0))]
        );
        assert_eq!(pointing.moved(Some(&over((1.0, 3.0), arrow.clone()))), []);
        assert_eq!(
            pointing.moved(Some(&over((5.0, 3.0), sprite((2, 2), (1, 1), 1)))),
            [Told::Position((5, 3)), Told::Hotspot((1, 1))]
        );
        assert_eq!(pointing.moved(None), [Told::Leave]);
    }

    #[test]
    fn a_frame_copies_an_image_it_has_not_had_and_waits_for_the_next() {
        let mut imaging = Imaging::new();
        let first = sprite((2, 2), (0, 0), 1);

        assert_eq!(imaging.drawn(Some(&first)), [Imaged::Constrain((2, 2))]);
        assert_eq!(
            imaging.capture("a", (2, 2), Some(&first)),
            Some(vec![Imaged::Copy("a", first.clone())])
        );
        assert_eq!(imaging.capture("b", (2, 2), Some(&first)), Some(vec![]));
        let second = sprite((2, 2), (0, 0), 2);
        assert_eq!(
            imaging.drawn(Some(&second)),
            [Imaged::Copy("b", second.clone())]
        );
    }

    #[test]
    fn an_image_of_another_size_offers_it_and_fails_the_waiting_frame() {
        let mut imaging = Imaging::new();
        imaging.drawn(Some(&sprite((2, 2), (0, 0), 1)));
        imaging.capture("a", (2, 2), None).expect("fits");

        assert_eq!(
            imaging.drawn(Some(&sprite((3, 3), (0, 0), 1))),
            [Imaged::Constrain((3, 3)), Imaged::Fail("a")]
        );
        assert_eq!(imaging.capture("b", (2, 2), None), None);
    }

    #[test]
    fn a_frame_waits_while_the_pointer_is_off_the_source() {
        let mut imaging = Imaging::new();
        let image = sprite((1, 1), (0, 0), 1);
        imaging.drawn(Some(&image));

        assert_eq!(imaging.capture("a", (1, 1), None), Some(vec![]));
        assert_eq!(imaging.drawn(None), []);
        assert_eq!(imaging.drawn(Some(&image)), [Imaged::Copy("a", image)]);
    }
}
