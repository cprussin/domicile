//! `org.freedesktop.impl.portal.Request`: the frontend's handle on one
//! dialog, exported while the dialog waits.

use std::sync::Arc;

use super::queue::Queue;

/// One dialog's `Request` object.
pub struct Request {
    pub id: u32,
    pub queue: Arc<Queue>,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Request")]
impl Request {
    /// The application gave up on the dialog. The shell stops showing it, and
    /// the call that opened it ends with response `2`.
    fn close(&self) {
        self.queue.withdraw(self.id);
    }
}
