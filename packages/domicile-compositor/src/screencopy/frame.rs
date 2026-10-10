//! An `ext_image_copy_capture_frame_v1`'s state: the buffer it was given and
//! whether it was captured.
//!
//! Generic over the buffer so the protocol's rules are tested without a
//! client.

/// One frame, before and after its capture.
pub struct Frame<B> {
    buffer: Option<B>,
    captured: bool,
}

/// A request the frame's state forbids, as the protocol's errors name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Misuse {
    NoBuffer,
    InvalidBufferDamage,
    AlreadyCaptured,
}

impl<B: Clone> Frame<B> {
    pub fn new() -> Self {
        Self {
            buffer: None,
            captured: false,
        }
    }

    /// Takes the buffer to capture into, in place of any earlier one.
    pub fn attach(&mut self, buffer: B) -> Result<(), Misuse> {
        self.uncaptured()?;
        self.buffer = Some(buffer);
        Ok(())
    }

    /// Checks damage the client reports on its buffer. Every shot is copied
    /// whole, so the damage itself is not kept.
    pub fn damage(&self, rect: (i32, i32, i32, i32)) -> Result<(), Misuse> {
        self.uncaptured()?;
        let (x, y, width, height) = rect;
        if x < 0 || y < 0 || width <= 0 || height <= 0 {
            Err(Misuse::InvalidBufferDamage)
        } else {
            Ok(())
        }
    }

    /// Captures: returns the buffer to copy into. A frame captures once.
    pub fn capture(&mut self) -> Result<B, Misuse> {
        self.uncaptured()?;
        let buffer = self.buffer.clone().ok_or(Misuse::NoBuffer)?;
        self.captured = true;
        Ok(buffer)
    }

    fn uncaptured(&self) -> Result<(), Misuse> {
        if self.captured {
            Err(Misuse::AlreadyCaptured)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_captures_into_the_last_buffer_attached() {
        let mut frame = Frame::new();
        frame.attach("first").expect("attached");
        frame.attach("second").expect("attached again");

        assert_eq!(frame.capture(), Ok("second"));
    }

    #[test]
    fn a_frame_without_a_buffer_cannot_capture() {
        assert_eq!(Frame::<&str>::new().capture(), Err(Misuse::NoBuffer));
    }

    #[test]
    fn a_captured_frame_takes_no_more_requests() {
        let mut frame = Frame::new();
        frame.attach("buffer").expect("attached");
        frame.capture().expect("captured");

        assert_eq!(frame.capture(), Err(Misuse::AlreadyCaptured));
        assert_eq!(frame.attach("another"), Err(Misuse::AlreadyCaptured));
        assert_eq!(frame.damage((0, 0, 1, 1)), Err(Misuse::AlreadyCaptured));
    }

    #[test]
    fn damage_must_be_a_rectangle_inside_the_buffers_corner() {
        let frame = Frame::<&str>::new();

        assert_eq!(frame.damage((0, 0, 1, 1)), Ok(()));
        assert_eq!(
            frame.damage((-1, 0, 1, 1)),
            Err(Misuse::InvalidBufferDamage)
        );
        assert_eq!(
            frame.damage((0, -1, 1, 1)),
            Err(Misuse::InvalidBufferDamage)
        );
        assert_eq!(frame.damage((0, 0, 0, 1)), Err(Misuse::InvalidBufferDamage));
        assert_eq!(frame.damage((0, 0, 1, 0)), Err(Misuse::InvalidBufferDamage));
    }
}
