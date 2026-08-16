//! Tests for the AppTextureBridge bookkeeping, written before the implementation.
//!
//! The bridge maps each app to a stable engine "external image" id and tracks
//! the latest GPU frame (a dmabuf) the app has submitted. The CEF side consults
//! this to bind an `<app>` element's texture; here we test only the pure
//! bookkeeping, which is what makes the un-runnable GPU glue thin.

use wc_bridge::{BridgeRegistry, DmabufDescriptor, DmabufPlane};

fn frame(w: u32, h: u32) -> DmabufDescriptor {
    DmabufDescriptor {
        width: w,
        height: h,
        fourcc: 0x34325241, // 'AR24'
        modifier: 0,
        planes: vec![DmabufPlane { fd: 7, offset: 0, stride: w * 4 }],
    }
}

#[test]
fn registering_assigns_a_stable_image_id() {
    let mut reg = BridgeRegistry::new();
    let id = reg.register("app-1");
    // Registering the same app again must return the SAME id: the engine's
    // external-image binding for that <app> element persists across frames.
    assert_eq!(reg.register("app-1"), id);
    // A different app gets a different id.
    assert_ne!(reg.register("app-2"), id);
    assert_eq!(reg.len(), 2);
}

#[test]
fn frames_are_stored_and_retrievable() {
    let mut reg = BridgeRegistry::new();
    reg.register("app-1");
    reg.update_frame("app-1", frame(640, 480)).unwrap();

    let latest = reg.latest_frame("app-1").expect("a frame was submitted");
    assert_eq!((latest.width, latest.height), (640, 480));
    assert_eq!(latest.planes[0].stride, 640 * 4);
}

#[test]
fn a_newer_frame_replaces_the_previous_one() {
    let mut reg = BridgeRegistry::new();
    reg.register("app-1");
    reg.update_frame("app-1", frame(100, 100)).unwrap();
    reg.update_frame("app-1", frame(200, 150)).unwrap();
    assert_eq!(reg.latest_frame("app-1").map(|f| (f.width, f.height)), Some((200, 150)));
}

#[test]
fn submitting_a_frame_for_an_unregistered_app_errors() {
    let mut reg = BridgeRegistry::new();
    assert!(reg.update_frame("ghost", frame(1, 1)).is_err());
}

#[test]
fn removing_an_app_drops_its_texture_and_frames() {
    let mut reg = BridgeRegistry::new();
    reg.register("app-1");
    reg.update_frame("app-1", frame(10, 10)).unwrap();

    assert!(reg.remove("app-1"));
    assert!(reg.image_id("app-1").is_none());
    assert!(reg.latest_frame("app-1").is_none());
    assert!(!reg.remove("app-1"), "removing a missing app returns false");
    assert!(reg.is_empty());
}

#[test]
fn image_id_is_none_for_unknown_apps() {
    let reg = BridgeRegistry::new();
    assert!(reg.image_id("nope").is_none());
}
