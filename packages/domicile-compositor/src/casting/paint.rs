//! Paints a frame's layers into memory: on the CPU when every layer is kept
//! there, else drawn together on the GPU and read back once.

use smithay::backend::renderer::gles::GlesRenderer;

use crate::casting::gpu::{self, FillError, Layer, Snapshot};
use crate::casting::negotiation::Pixel;
use crate::casting::pacing::within;
use crate::casting::shm_copy::{copy, Client};

/// Draws `layers` over `target`, a `pixel` buffer with rows `stride` bytes
/// apart. A layer on the GPU needs `renderer`.
///
/// With a layer on the GPU, the GPU draws them all, scaling each, and the
/// frame is read back in one go: reading back each source at its own size
/// and scaling it on the CPU took longer than a frame on a desk near 4K.
///
/// The GPU also draws layers that overlap, which the CPU would replace rather
/// than blend. Without a `renderer` the CPU does.
pub fn paint(
    layers: &[Layer],
    target: &mut [u8],
    stride: usize,
    pixel: Pixel,
    renderer: Option<&mut GlesRenderer>,
) -> Result<(), FillError> {
    let on_the_gpu = layers
        .iter()
        .any(|layer| matches!(layer.snapshot, Snapshot::Texture(_)));
    if on_the_gpu || (renderer.is_some() && overlap(layers)) {
        let size = layers.iter().fold((0, 0), |(width, height), layer| {
            (
                width.max((layer.to.0 + layer.to.2) as u32),
                height.max((layer.to.1 + layer.to.3) as u32),
            )
        });
        return gpu::read_drawn(
            renderer.ok_or(FillError::NoGpu)?,
            layers,
            size,
            target,
            stride,
        );
    }
    for layer in layers {
        let Snapshot::Pixels {
            bytes: pixels,
            stride: from,
            alpha,
            ..
        } = layer.snapshot
        else {
            unreachable!("a frame with a layer on the GPU is drawn there above");
        };
        copy(
            &Client {
                bytes: pixels,
                stride: *from,
                alpha: *alpha,
            },
            layer.from,
            target,
            stride,
            pixel,
            layer.to,
            layer.transform,
        );
    }
    Ok(())
}

/// Whether any layer is drawn over another.
fn overlap(layers: &[Layer]) -> bool {
    layers.iter().enumerate().any(|(at, layer)| {
        layers[..at]
            .iter()
            .any(|under| within(layer.to, under.to).is_some())
    })
}

#[cfg(test)]
mod tests {
    use smithay::backend::allocator::Fourcc;
    use smithay::backend::renderer::ImportMem as _;
    use smithay::utils::{Size, Transform};

    use super::paint;
    use crate::buffer_transform::Sampled;
    use crate::casting::gpu::{Layer, Snapshot};
    use crate::casting::negotiation::Pixel;
    use crate::dmabuf_import::headless_renderer;

    /// A 2x1 frame in `Argb8888` byte order: blue 1 on the left, 2 on the
    /// right.
    const SIDE_BY_SIDE: [u8; 8] = [1, 0, 0, 255, 2, 0, 0, 255];

    /// All of [`SIDE_BY_SIDE`], drawn a quarter turn counterclockwise.
    const TURNED: Sampled = Sampled {
        crop: (0, 0, 2, 1),
        transform: Transform::_90,
    };

    #[test]
    fn a_turned_frame_kept_on_the_cpu_is_painted_upright() {
        let snapshot = Snapshot::Pixels {
            bytes: SIDE_BY_SIDE.to_vec(),
            stride: 8,
            alpha: true,
            size: (2, 1),
        };
        let mut target = [0; 8];

        paint(
            &[Layer::placed(&snapshot, TURNED, (0, 0, 1, 2))],
            &mut target,
            4,
            Pixel::Bgra,
            None,
        )
        .expect("painted on the CPU");

        assert_eq!(blue(&target), [2, 1]);
    }

    #[test]
    fn a_turned_frame_on_the_gpu_is_painted_upright() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let snapshot = Snapshot::Texture(
            renderer
                .import_memory(&SIDE_BY_SIDE, Fourcc::Argb8888, Size::from((2, 1)), false)
                .expect("the pixels import"),
        );
        let mut target = [0; 8];

        paint(
            &[Layer::placed(&snapshot, TURNED, (0, 0, 1, 2))],
            &mut target,
            4,
            Pixel::Bgra,
            Some(&mut renderer),
        )
        .expect("read back and painted");

        assert_eq!(blue(&target), [2, 1]);
    }

    /// A desk across a monitor kept on the CPU and one on the GPU, the
    /// second scaled down by half, is drawn together.
    #[test]
    fn layers_on_the_cpu_and_the_gpu_are_painted_side_by_side() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let cpu = Snapshot::Pixels {
            bytes: SIDE_BY_SIDE.to_vec(),
            stride: 8,
            alpha: true,
            size: (2, 1),
        };
        let wide = [SIDE_BY_SIDE, SIDE_BY_SIDE].concat();
        let gpu = Snapshot::Texture(
            renderer
                .import_memory(&wide, Fourcc::Argb8888, Size::from((4, 1)), false)
                .expect("the pixels import"),
        );
        let layers = [
            Layer {
                snapshot: &cpu,
                from: (0, 0, 2, 1),
                to: (0, 0, 2, 1),
                transform: Transform::Normal,
            },
            Layer {
                snapshot: &gpu,
                from: (0, 0, 4, 1),
                to: (2, 0, 2, 1),
                transform: Transform::Normal,
            },
        ];
        let mut target = [0; 16];

        paint(&layers, &mut target, 16, Pixel::Bgra, Some(&mut renderer)).expect("painted");

        assert_eq!(blue(&target)[..2], [1, 2]);
        // Every other source pixel; which of each pair is the GPU's pick.
        assert!(blue(&target)[2..]
            .iter()
            .all(|&blue| blue == 1 || blue == 2));
    }

    /// A subsurface's clear pixels show the window under them.
    #[test]
    fn layers_over_each_other_are_blended() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let pixels = |bytes: [u8; 8]| Snapshot::Pixels {
            bytes: bytes.to_vec(),
            stride: 8,
            alpha: true,
            size: (2, 1),
        };
        let (window, over) = (pixels(SIDE_BY_SIDE), pixels([0, 0, 0, 0, 9, 0, 0, 255]));
        let whole = (0, 0, 2, 1);
        let layers = [&window, &over].map(|snapshot| Layer {
            snapshot,
            from: whole,
            to: whole,
            transform: Transform::Normal,
        });
        let mut target = [0; 8];

        paint(&layers, &mut target, 8, Pixel::Bgra, Some(&mut renderer)).expect("painted");

        assert_eq!(blue(&target), [1, 9]);
    }

    /// Without a renderer, a scaled layer cut at its window's top left reads
    /// only its own buffer.
    #[test]
    fn a_scaled_layer_cut_at_the_top_left_is_painted_on_the_cpu() {
        let snapshot = Snapshot::Pixels {
            bytes: (0..25).flat_map(|blue| [blue, 0, 0, 255]).collect(),
            stride: 20,
            alpha: true,
            size: (5, 5),
        };
        let layer = Layer {
            snapshot: &snapshot,
            from: (0, 0, 5, 5),
            to: (-5, -5, 10, 10),
            transform: Transform::Normal,
        }
        .cut((0, 0, 5, 5))
        .expect("half of it is inside");
        let mut target = [0; 100];

        paint(&[layer], &mut target, 20, Pixel::Bgra, None).expect("painted on the CPU");

        let blue = blue(&target);
        assert_eq!(blue[..5], [12, 12, 13, 13, 14]);
        assert_eq!(blue[20..], [22, 22, 23, 23, 24]);
    }

    /// Each pixel's blue byte.
    fn blue(target: &[u8]) -> Vec<u8> {
        target.chunks(4).map(|pixel| pixel[0]).collect()
    }
}
