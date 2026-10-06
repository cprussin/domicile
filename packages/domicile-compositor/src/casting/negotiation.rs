//! What a stream offers its consumer, and what the consumer's answer means.
//!
//! The stream offers dmabuf formats first, each with the modifiers the
//! compositor's GPU can render to, and shm after them. A consumer that cannot
//! take a dmabuf picks shm. A consumer that takes a dmabuf may leave the
//! modifier open; the producer then picks the first one it can allocate and
//! announces that format again, fixed.

/// A pixel layout a stream carries: one 32-bit pixel, blue in the low byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pixel {
    /// DRM `XRGB8888`, SPA `BGRx`. The fourth byte is undefined.
    Bgrx,
    /// DRM `ARGB8888`, SPA `BGRA`, premultiplied.
    Bgra,
}

/// Every layout a stream offers, in order of preference. A translucent window
/// keeps its alpha in `Bgra`; `Bgrx` is the format most consumers expect.
pub const PIXELS: [Pixel; 2] = [Pixel::Bgrx, Pixel::Bgra];

/// Bytes in one pixel of every [`Pixel`].
pub const BYTES_PER_PIXEL: u32 = 4;

/// How many buffers a stream asks for: one being filled, one with the
/// consumer, and slack so a slow consumer does not starve the producer.
pub const BUFFERS: u32 = 4;

/// The highest frame rate a stream offers. Consumers may ask for less.
pub const MAX_FRAMERATE: u32 = 60;

/// One format the stream offers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Offered {
    /// A dmabuf of `pixel`, in one of `modifiers`.
    Dmabuf { pixel: Pixel, modifiers: Vec<u64> },
    /// Shared memory, `memfd` backed.
    Shm { pixel: Pixel },
}

/// The formats a stream offers, best first.
///
/// `modifiers` gives the modifiers the GPU can render `pixel` to; an empty
/// list leaves that layout to shm. Without a GPU every list is empty.
pub fn offer(modifiers: impl Fn(Pixel) -> Vec<u64>) -> Vec<Offered> {
    let dmabuf = PIXELS.iter().filter_map(|&pixel| {
        let modifiers = modifiers(pixel);
        (!modifiers.is_empty()).then_some(Offered::Dmabuf { pixel, modifiers })
    });
    let shm = PIXELS.iter().map(|&pixel| Offered::Shm { pixel });
    dmabuf.chain(shm).collect()
}

/// The format the consumer picked, as PipeWire reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Picked {
    pub pixel: Pixel,
    pub size: (u32, u32),
    /// `None` for shm. One entry when the consumer fixed the modifier,
    /// several when it left the choice to the producer.
    pub modifiers: Option<Vec<u64>>,
}

/// What the producer does with the consumer's pick.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settled {
    /// Stream through shared memory.
    Shm { pixel: Pixel, size: (u32, u32) },
    /// Stream dmabufs with this modifier.
    Dmabuf {
        pixel: Pixel,
        size: (u32, u32),
        modifier: u64,
    },
    /// Announce this modifier as the only one, and wait for the consumer to
    /// pick again.
    Fixate { pixel: Pixel, modifier: u64 },
    /// No offered modifier allocates. Offer shm only, and wait for the
    /// consumer to pick again.
    DropDmabuf,
}

/// Settles `picked`, trying the consumer's modifiers in its order.
///
/// `allocates` says whether the GPU can allocate a buffer of the picked size
/// with that modifier.
pub fn settle(picked: &Picked, mut allocates: impl FnMut(Pixel, u64) -> bool) -> Settled {
    let Picked {
        pixel,
        size,
        modifiers,
    } = picked;
    match modifiers.as_deref() {
        None => Settled::Shm {
            pixel: *pixel,
            size: *size,
        },
        Some([modifier]) => Settled::Dmabuf {
            pixel: *pixel,
            size: *size,
            modifier: *modifier,
        },
        Some(choices) => choices
            .iter()
            .find(|&&modifier| allocates(*pixel, modifier))
            .map_or(Settled::DropDmabuf, |&modifier| Settled::Fixate {
                pixel: *pixel,
                modifier,
            }),
    }
}

/// The stride and size of one shm buffer.
pub fn shm_layout(size: (u32, u32)) -> (u32, u32) {
    let stride = size.0 * BYTES_PER_PIXEL;
    (stride, stride * size.1)
}

#[cfg(test)]
mod tests {
    use super::{offer, settle, shm_layout, Offered, Picked, Pixel, Settled};

    const LINEAR: u64 = 0;
    const TILED: u64 = 0x0100_0000_0000_0001;

    #[test]
    fn dmabuf_comes_first_and_shm_is_always_offered() {
        let offered = offer(|pixel| match pixel {
            Pixel::Bgrx => vec![TILED, LINEAR],
            // The GPU cannot render this one, so it goes to shm only.
            Pixel::Bgra => vec![],
        });

        assert_eq!(
            offered,
            vec![
                Offered::Dmabuf {
                    pixel: Pixel::Bgrx,
                    modifiers: vec![TILED, LINEAR],
                },
                Offered::Shm { pixel: Pixel::Bgrx },
                Offered::Shm { pixel: Pixel::Bgra },
            ]
        );
    }

    #[test]
    fn a_pick_without_a_modifier_is_shm() {
        let picked = Picked {
            pixel: Pixel::Bgra,
            size: (320, 240),
            modifiers: None,
        };

        assert_eq!(
            settle(&picked, |_, _| panic!("shm allocates nothing on the GPU")),
            Settled::Shm {
                pixel: Pixel::Bgra,
                size: (320, 240),
            }
        );
    }

    #[test]
    fn a_fixed_modifier_is_streamed() {
        let picked = Picked {
            pixel: Pixel::Bgrx,
            size: (320, 240),
            modifiers: Some(vec![TILED]),
        };

        assert_eq!(
            settle(&picked, |_, _| panic!("a fixed modifier is not retried")),
            Settled::Dmabuf {
                pixel: Pixel::Bgrx,
                size: (320, 240),
                modifier: TILED,
            }
        );
    }

    #[test]
    fn an_open_choice_fixates_the_first_modifier_that_allocates() {
        let picked = Picked {
            pixel: Pixel::Bgrx,
            size: (320, 240),
            modifiers: Some(vec![TILED, LINEAR]),
        };

        assert_eq!(
            settle(&picked, |_, modifier| modifier == LINEAR),
            Settled::Fixate {
                pixel: Pixel::Bgrx,
                modifier: LINEAR,
            }
        );
    }

    #[test]
    fn an_open_choice_that_never_allocates_falls_back_to_shm() {
        let picked = Picked {
            pixel: Pixel::Bgrx,
            size: (320, 240),
            modifiers: Some(vec![TILED, LINEAR]),
        };

        assert_eq!(settle(&picked, |_, _| false), Settled::DropDmabuf);
    }

    #[test]
    fn an_shm_buffer_is_four_bytes_a_pixel_with_no_padding() {
        assert_eq!(shm_layout((320, 240)), (1280, 1280 * 240));
    }
}
