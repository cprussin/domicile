//! Deciding whether a desktop composites on the CPU, from its platform and,
//! on a tty, a fake `/sys/class/drm`.

use std::os::unix::fs::symlink;
use std::path::Path;

use domicile_launch::software_compositing::{composites_on_the_cpu, on_the_cpu, Undecided};

/// For cards with no vmwgfx, which is never asked about 3D.
fn no_vmwgfx(node: &str) -> std::io::Result<bool> {
    panic!("asked {node}, which is no vmwgfx")
}

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
    composites_on_the_cpu(None, drm, no_vmwgfx).expect("no override")
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
fn a_vmwgfx_with_no_3d_composites_on_the_cpu() {
    // VirtualBox's VMSVGA and VMware with 3D off.
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "vmwgfx", None);

    let asked = |node: &str| {
        assert_eq!(node, "renderD128");
        Ok(false)
    };
    assert!(composites_on_the_cpu(None, drm.path(), asked).expect("decided"));
}

#[test]
fn a_vmwgfx_with_3d_composites_on_the_gpu() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "vmwgfx", None);

    assert!(!composites_on_the_cpu(None, drm.path(), |_| Ok(true)).expect("decided"));
}

#[test]
fn a_vmwgfx_that_cannot_be_asked_is_said_rather_than_guessed() {
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "vmwgfx", None);

    let refused = |_: &str| Err(std::io::Error::from_raw_os_error(libc::EACCES));
    assert!(matches!(
        composites_on_the_cpu(None, drm.path(), refused),
        Err(Undecided::Vmwgfx { node, .. }) if node == "renderD128"
    ));
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

    let decided = |overridden, drm: &Path| {
        composites_on_the_cpu(overridden, drm, no_vmwgfx).expect("decided")
    };
    assert!(decided(Some("yes"), drm.path()));
    assert!(!decided(Some("no"), Path::new("/nowhere")));
    assert!(!decided(Some(""), drm.path()));
}

#[test]
fn a_variable_that_is_not_yes_or_no_is_refused() {
    assert!(matches!(
        composites_on_the_cpu(Some("1"), Path::new("/nowhere"), no_vmwgfx),
        Err(Undecided::BadOverride(value)) if value == "1"
    ));
}

#[test]
fn a_sysfs_that_cannot_be_listed_is_said_rather_than_guessed() {
    assert!(matches!(
        composites_on_the_cpu(None, Path::new("/nowhere"), no_vmwgfx),
        Err(Undecided::Sysfs { .. })
    ));
}

#[test]
fn a_headless_desktop_composites_on_the_cpu() {
    // Headless imports no dmabufs, whatever cards there are.
    let drm = tempfile::tempdir().expect("a directory");
    render_node(drm.path(), "renderD128", "amdgpu", None);

    assert!(on_the_cpu("headless", None, drm.path(), no_vmwgfx).expect("decided"));
    assert!(on_the_cpu("headless", Some("yes"), drm.path(), no_vmwgfx).expect("decided"));
}

#[test]
fn a_headless_desktop_on_the_gpu_is_refused() {
    assert!(matches!(
        on_the_cpu("headless", Some("no"), Path::new("/nowhere"), no_vmwgfx),
        Err(Undecided::HeadlessOnTheGpu)
    ));
}

#[test]
fn a_nested_desktop_draws_as_its_host_lets_it() {
    assert!(
        !on_the_cpu("wayland", Some("yes"), Path::new("/nowhere"), no_vmwgfx).expect("decided")
    );
}

#[test]
fn a_tty_desktop_reads_the_cards() {
    let drm = tempfile::tempdir().expect("a directory");
    std::fs::create_dir(drm.path().join("card0")).expect("a card");

    assert!(on_the_cpu("drm", None, drm.path(), no_vmwgfx).expect("decided"));
}
