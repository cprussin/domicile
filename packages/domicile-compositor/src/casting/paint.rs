//! Paints a frame's layers into memory, on the CPU where they are kept there
//! and read back from the GPU where they are not.

use smithay::backend::renderer::gles::GlesRenderer;

use crate::casting::gpu::{self, FillError, Layer, Snapshot};
use crate::casting::negotiation::Pixel;
use crate::casting::shm_copy::{copy, Client};

/// Draws `layers` over `target`, a `pixel` buffer with rows `stride` bytes
/// apart. A layer on the GPU needs `renderer`.
pub fn paint(
    layers: &[Layer],
    target: &mut [u8],
    stride: usize,
    pixel: Pixel,
    mut renderer: Option<&mut GlesRenderer>,
) -> Result<(), FillError> {
    for layer in layers {
        match layer.snapshot {
            Snapshot::Pixels {
                bytes: pixels,
                stride: from,
                alpha,
                ..
            } => copy(
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
            ),
            Snapshot::Texture(texture) => {
                // Read back at the source's size, then scale on copy.
                let row = layer.from.2 as usize * 4;
                let mut read = vec![0; row * layer.from.3 as usize];
                gpu::read_back(
                    renderer.as_deref_mut().ok_or(FillError::NoGpu)?,
                    texture,
                    layer.from,
                    &mut read,
                    row,
                )?;
                copy(
                    &Client {
                        bytes: &read,
                        stride: row,
                        alpha: true,
                    },
                    (0, 0, layer.from.2, layer.from.3),
                    target,
                    stride,
                    pixel,
                    layer.to,
                    layer.transform,
                );
            }
        }
    }
    Ok(())
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
            &[Layer::upright(&snapshot, TURNED)],
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
            &[Layer::upright(&snapshot, TURNED)],
            &mut target,
            4,
            Pixel::Bgra,
            Some(&mut renderer),
        )
        .expect("read back and painted");

        assert_eq!(blue(&target), [2, 1]);
    }

    /// Each pixel's blue byte.
    fn blue(target: &[u8]) -> Vec<u8> {
        target.chunks(4).map(|pixel| pixel[0]).collect()
    }
}
