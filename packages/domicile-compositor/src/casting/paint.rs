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
                );
            }
        }
    }
    Ok(())
}
