//! Turning a client's committed dmabuf into the [`BridgeRegistry`] frame record.
//!
//! [`domicile_bridge`] describes a GPU frame in engine terms — a fourcc, a
//! modifier and one plane per buffer fd — so that the eventual CEF external
//! texture binds to exactly what the client allocated. Smithay describes the
//! same buffer in its own types; this is the one place the two meet, kept
//! separate (and tested) so the GPU glue around it stays free of bookkeeping.
//!
//! [`BridgeRegistry`]: domicile_bridge::BridgeRegistry

use std::os::fd::AsRawFd as _;

use domicile_bridge::{DmabufDescriptor, DmabufPlane};
use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;

/// Describe `dmabuf` in the bridge's terms.
///
/// The plane fds are borrowed, not owned: they stay valid only as long as the
/// `Dmabuf` the descriptor was taken from, so a caller that keeps the
/// descriptor must keep that buffer alive too.
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

    use domicile_bridge::DmabufPlane;
    use smithay::backend::allocator::dmabuf::{Dmabuf, DmabufFlags};
    use smithay::backend::allocator::{Fourcc, Modifier};

    use super::descriptor_from;

    /// A dmabuf needs real file descriptors; their contents never matter here,
    /// only that each plane carries the fd it was built with.
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
        // Multi-planar formats (and modifiers with a compression plane) attach
        // more than one fd; the engine needs all of them, in index order.
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
