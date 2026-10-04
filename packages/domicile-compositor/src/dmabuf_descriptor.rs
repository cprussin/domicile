//! Converts a client's Smithay dmabuf into the description the engine
//! imports: size, fourcc, modifier and one entry per plane.
//!
//! Kept separate from the GPU glue so it can be tested without a GPU.

use std::os::fd::AsRawFd as _;

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;

/// One plane of a dmabuf: a GPU buffer shared by file descriptor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DmabufPlane {
    pub fd: i32,
    pub offset: u32,
    pub stride: u32,
}

/// A client's current GPU frame, shared zero-copy as a dmabuf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DmabufDescriptor {
    pub width: u32,
    pub height: u32,
    /// DRM FourCC pixel format (e.g. `AR24`).
    pub fourcc: u32,
    /// DRM format modifier (tiling/compression), 0 for linear.
    pub modifier: u64,
    pub planes: Vec<DmabufPlane>,
}

/// Describes `dmabuf` for the engine.
///
/// The plane fds are borrowed: keep the `Dmabuf` alive as long as the
/// descriptor.
pub fn descriptor_from(dmabuf: &Dmabuf) -> DmabufDescriptor {
    let format = dmabuf.format();
    DmabufDescriptor {
        width: dmabuf.width(),
        height: dmabuf.height(),
        fourcc: format.code as u32,
        modifier: u64::from(format.modifier),
        planes: dmabuf
            .handles()
            .zip(dmabuf.offsets())
            .zip(dmabuf.strides())
            .map(|((fd, offset), stride)| DmabufPlane {
                fd: fd.as_raw_fd(),
                offset,
                stride,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::os::fd::{AsRawFd as _, OwnedFd};

    use smithay::backend::allocator::dmabuf::{Dmabuf, DmabufFlags};
    use smithay::backend::allocator::{Fourcc, Modifier};

    use super::{descriptor_from, DmabufPlane};

    /// A real file descriptor for a test plane. Its contents do not matter.
    fn fd() -> OwnedFd {
        OwnedFd::from(File::open("/dev/null").expect("/dev/null opens"))
    }

    #[test]
    fn describes_geometry_format_and_modifier() {
        let plane = fd();
        let raw = plane.as_raw_fd();
        let mut builder = Dmabuf::builder(
            (640, 480),
            Fourcc::Argb8888,
            Modifier::Linear,
            DmabufFlags::empty(),
        );
        assert!(builder.add_plane(plane, 0, 0, 2560));
        let dmabuf = builder.build().expect("a single-plane buffer builds");

        let descriptor = descriptor_from(&dmabuf);

        assert_eq!((descriptor.width, descriptor.height), (640, 480));
        assert_eq!(descriptor.fourcc, Fourcc::Argb8888 as u32);
        assert_eq!(descriptor.modifier, u64::from(Modifier::Linear));
        assert_eq!(
            descriptor.planes,
            vec![DmabufPlane {
                fd: raw,
                offset: 0,
                stride: 2560,
            }]
        );
    }

    #[test]
    fn carries_every_plane_in_order() {
        // Multi-planar formats and compression modifiers use several fds; the
        // engine needs all of them, in index order.
        let (first, second) = (fd(), fd());
        let (first_raw, second_raw) = (first.as_raw_fd(), second.as_raw_fd());
        let mut builder = Dmabuf::builder(
            (16, 16),
            Fourcc::Nv12,
            Modifier::Invalid,
            DmabufFlags::empty(),
        );
        assert!(builder.add_plane(first, 0, 0, 16));
        assert!(builder.add_plane(second, 1, 256, 16));
        let dmabuf = builder.build().expect("a two-plane buffer builds");

        let descriptor = descriptor_from(&dmabuf);

        assert_eq!(
            descriptor.planes,
            vec![
                DmabufPlane {
                    fd: first_raw,
                    offset: 0,
                    stride: 16,
                },
                DmabufPlane {
                    fd: second_raw,
                    offset: 256,
                    stride: 16,
                },
            ]
        );
    }
}
