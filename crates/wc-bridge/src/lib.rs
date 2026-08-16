//! The AppTextureBridge — bookkeeping that connects a Wayland client's GPU
//! surface to a web-engine external-image texture.
//!
//! This is the load-bearing idea of Loom made concrete on the data side: each
//! app gets a stable [`ExternalImageId`] that the engine binds to its `<app>`
//! element (exactly as it binds a `<video>` frame), and each new client frame
//! is a [`DmabufDescriptor`] handed to that texture. This crate holds only the
//! pure bookkeeping; the actual CEF/Chromium binding (importing the dmabuf and
//! feeding it to the compositor) lives behind the `cef` feature and is spelled
//! out in `docs/CEF-SPIKE.md` — it needs the prebuilt CEF distribution and a GPU.
//!
//! Keeping the bookkeeping here, testable, is what keeps that GPU glue thin.

use std::collections::HashMap;

/// A stable handle the engine uses for an app's external-image texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ExternalImageId(pub u64);

/// One plane of a dmabuf (a GPU buffer shared by file descriptor).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DmabufPlane {
    pub fd: i32,
    pub offset: u32,
    pub stride: u32,
}

/// A description of a client's current GPU frame, shared zero-copy as a dmabuf.
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

/// Per-app texture bookkeeping.
#[derive(Debug, Clone)]
struct AppTexture {
    image_id: ExternalImageId,
    latest: Option<DmabufDescriptor>,
}

/// Submitting a frame for an app that was never registered.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("no texture registered for app: {0}")]
pub struct UnregisteredApp(pub String);

/// Maps apps to engine external-image textures and their latest frames.
#[derive(Debug, Default)]
pub struct BridgeRegistry {
    apps: HashMap<String, AppTexture>,
    next_id: u64,
}

impl BridgeRegistry {
    pub fn new() -> Self {
        BridgeRegistry::default()
    }

    /// Ensure the app has a texture, returning its stable image id. Idempotent:
    /// re-registering an existing app returns the same id (the engine keeps its
    /// binding for that `<app>` element across frames).
    pub fn register(&mut self, app_id: impl Into<String>) -> ExternalImageId {
        let app_id = app_id.into();
        if let Some(texture) = self.apps.get(&app_id) {
            return texture.image_id;
        }
        self.next_id += 1;
        let image_id = ExternalImageId(self.next_id);
        self.apps.insert(app_id, AppTexture { image_id, latest: None });
        image_id
    }

    /// Record the app's latest frame. Errors if the app was never registered.
    pub fn update_frame(
        &mut self,
        app_id: &str,
        frame: DmabufDescriptor,
    ) -> Result<(), UnregisteredApp> {
        match self.apps.get_mut(app_id) {
            Some(texture) => {
                texture.latest = Some(frame);
                Ok(())
            }
            None => Err(UnregisteredApp(app_id.to_string())),
        }
    }

    /// The app's external-image id, if registered.
    pub fn image_id(&self, app_id: &str) -> Option<ExternalImageId> {
        self.apps.get(app_id).map(|t| t.image_id)
    }

    /// The app's most recently submitted frame, if any.
    pub fn latest_frame(&self, app_id: &str) -> Option<&DmabufDescriptor> {
        self.apps.get(app_id).and_then(|t| t.latest.as_ref())
    }

    /// Drop an app's texture and frames, returning whether it existed.
    pub fn remove(&mut self, app_id: &str) -> bool {
        self.apps.remove(app_id).is_some()
    }

    pub fn len(&self) -> usize {
        self.apps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.apps.is_empty()
    }
}
