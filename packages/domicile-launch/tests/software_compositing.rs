//! Deciding whether a desktop on a tty composites on the CPU, from a fake
//! `/sys/class/drm`.

use std::os::unix::fs::symlink;
use std::path::Path;

use domicile_launch::software_compositing::{composites_on_the_cpu, Undecided};

/// Adds a render node whose device is driven by `driver`, with `features`
/// as virtio lists them if given.
fn render_node(drm: &Path, name: &str, driver: &str, features: Option<&str>) {
    let device = drm.join("devices").join(name);
    std::fs::create_dir_all(&device).expect("a device directory");
    symlink(
        format!("/sys/bus/virtio/drivers/{driver}"),
        device.join("driver"),
    )
    .expect("a driver link");
    if let Some(features) = features {
        std::fs::write(device.join("features"), features).expect("features");
    }
    std::fs::create_dir_all(drm.join(name)).expect("a node directory");
    symlink(&device, drm.join(name).join("device")).expect("a device link");
}

/// Adds a render node for a virtio-gpu on PCI, as Linux lays it out: the
/// node's device is the PCI function, driven by virtio-pci, and the virtio
/// device with its features is that function's `virtio0`.
fn pci_virtio_gpu(drm: &Path, name: &str, features: &str) {
    render_node(drm, name, "virtio-pci", None);
    let virtio = drm.join("devices").join(name).join("virtio0");
    std::fs::create_dir(&virtio).expect("a virtio device");
    symlink("/sys/bus/virtio/drivers/virtio_gpu", virtio.join("driver")).expect("a driver link");
    std::fs::write(virtio.join("features"), features).expect("features");
}

fn decided(drm: &Path) -> bool {
    composites_on_the_cpu(None, drm).expect("no override")
}

#[test]
fn a_card_with_no_render_node_composites_on_the_cpu() {
    // simpledrm, vkms, hyperv_drm: a card and no render node.
    let drm = tempfile::tempdir().expect("a directory");
    std::fs::create_dir(drm.path().join("card0")).expect("a card");

    assert!(decided(drm.path()));
}

#[test]
fn a_gpu_with_a_render_node_composites_on_the_gpu() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "amdgpu", None);

    assert!(!decided(drm.path()));
}

#[test]
fn a_2d_virtio_gpu_composites_on_the_cpu() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(
        drm.path(),
        "renderD128",
        "virtio_gpu",
        Some("0000000000001\n"),
    );

    assert!(decided(drm.path()));
}

#[test]
fn a_2d_virtio_gpu_on_pci_composites_on_the_cpu() {
    let drm = tempfile::tempdir().expect("a directory");
    pci_virtio_gpu(drm.path(), "renderD128", "0100000000001\n");

    assert!(decided(drm.path()));
}

#[test]
fn a_virtio_gpu_on_pci_with_virgl_composites_on_the_gpu() {
    let drm = tempfile::tempdir().expect("a directory");
    pci_virtio_gpu(drm.path(), "renderD128", "1100000000001\n");

    assert!(!decided(drm.path()));
}

#[test]
fn a_virtio_gpu_with_virgl_composites_on_the_gpu() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(
        drm.path(),
        "renderD128",
        "virtio_gpu",
        Some("1000000000001\n"),
    );

    assert!(!decided(drm.path()));
}

#[test]
fn any_card_with_3d_is_enough() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "virtio_gpu", Some("0\n"));
    render_node(drm.path(), "renderD129", "i915", None);

    assert!(!decided(drm.path()));
}

#[test]
fn the_variable_decides_over_the_cards() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "amdgpu", None);

    let decided = |overridden, drm: &Path| composites_on_the_cpu(overridden, drm).expect("decided");
    assert!(decided(Some("yes"), drm.path()));
    assert!(!decided(Some("no"), Path::new("/nowhere")));
    assert!(!decided(Some(""), drm.path()));
}

#[test]
fn a_variable_that_is_not_yes_or_no_is_refused() {
    assert!(matches!(
        composites_on_the_cpu(Some("1"), Path::new("/nowhere")),
        Err(Undecided::BadOverride(value)) if value == "1"
    ));
}

#[test]
fn a_sysfs_that_cannot_be_listed_is_said_rather_than_guessed() {
    assert!(matches!(
        composites_on_the_cpu(None, Path::new("/nowhere")),
        Err(Undecided::Sysfs { .. })
    ));
}
