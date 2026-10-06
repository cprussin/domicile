//! A `memfd` mapped into the compositor, for one shm stream buffer.
//!
//! The PipeWire thread creates it and hands the consumer its fd. The Wayland
//! thread writes frames into the mapping while the buffer is lent to it.

use std::ffi::CStr;
use std::fs::File;
use std::os::fd::{AsFd, BorrowedFd, FromRawFd as _, OwnedFd};
use std::ptr::NonNull;

/// A shared, writable mapping of a `memfd`.
#[derive(Debug)]
pub struct Mapping {
    pointer: NonNull<u8>,
    length: usize,
    fd: OwnedFd,
}

// SAFETY: the mapping is plain memory. Writers are kept apart by the lending
// protocol: only the thread a buffer is lent to writes it.
unsafe impl Send for Mapping {}
// SAFETY: as above.
unsafe impl Sync for Mapping {}

impl Mapping {
    /// A new zeroed `memfd` of `length` bytes, mapped.
    pub fn new(length: usize) -> std::io::Result<Mapping> {
        const NAME: &CStr = c"domicile-cast";
        // SAFETY: a valid name, and flags the kernel defines.
        let raw = unsafe { libc::memfd_create(NAME.as_ptr(), libc::MFD_CLOEXEC) };
        if raw < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: a new fd that nothing else owns.
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        File::from(fd.try_clone()?).set_len(length as u64)?;
        // SAFETY: maps the whole of a file of `length` bytes.
        let pointer = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                raw,
                0,
            )
        };
        if pointer == libc::MAP_FAILED {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Mapping {
            pointer: NonNull::new(pointer.cast()).expect("mmap does not return null on success"),
            length,
            fd,
        })
    }

    /// The mapping's bytes.
    ///
    /// # Safety
    ///
    /// The caller must hold the buffer: no other thread may touch it, and the
    /// consumer does not read it until it is queued.
    #[allow(clippy::mut_from_ref)] // The lending protocol gives exclusive access.
    pub unsafe fn bytes(&self) -> &mut [u8] {
        // SAFETY: a live mapping of `length` bytes; exclusivity is the
        // caller's obligation.
        unsafe { std::slice::from_raw_parts_mut(self.pointer.as_ptr(), self.length) }
    }

    pub fn len(&self) -> usize {
        self.length
    }
}

impl AsFd for Mapping {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.fd.as_fd()
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        // SAFETY: the mapping `new` made, unmapped once.
        unsafe { libc::munmap(self.pointer.as_ptr().cast(), self.length) };
    }
}

#[cfg(test)]
mod tests {
    use std::io::Read as _;
    use std::os::fd::AsFd as _;

    use super::Mapping;

    #[test]
    fn what_is_written_reaches_the_fd() {
        let mapping = Mapping::new(8).expect("a memfd");

        // SAFETY: this test is the only user.
        unsafe { mapping.bytes() }.copy_from_slice(b"frame!!!");

        let mut read = String::new();
        std::fs::File::from(mapping.as_fd().try_clone_to_owned().expect("dup"))
            .read_to_string(&mut read)
            .expect("reads");
        assert_eq!(read, "frame!!!");
    }
}
