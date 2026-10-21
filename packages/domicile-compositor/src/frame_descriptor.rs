//! What the engine imports a window's frame from: a dmabuf, or shared memory
//! for an engine on the CPU (see `crate::memory_frames`).

use crate::dmabuf_descriptor::DmabufDescriptor;
use crate::engine::ShmBuffer;

/// A frame's buffer, described for the engine. Its fds are borrowed: keep the
/// buffer alive as long as the descriptor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameDescriptor {
    Dmabuf(DmabufDescriptor),
    Shm(ShmBuffer),
}
