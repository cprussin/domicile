//! `zxdg_exporter_v1` and `zxdg_exporter_v2`: a client exports its window and
//! gets a handle to pass to a portal as `parent_window`.
//!
//! GTK3 exports through v1; GTK4, Chromium and Electron through v2. The
//! handles live in [`domicile_host::xdg_foreign::Exports`], which resolves them.
//! No importer: the shell draws portal dialogs, so no client parents a window
//! to another client's. See `docs/architecture/PORTALS.md`.

use smithay::reexports::wayland_protocols::xdg::foreign::{
    zv1::server::{zxdg_exported_v1, zxdg_exporter_v1},
    zv2::server::{zxdg_exported_v2, zxdg_exporter_v2},
};
use smithay::reexports::wayland_server::{
    backend::ClientId, protocol::wl_surface::WlSurface, Client, DataInit, Dispatch, DisplayHandle,
    GlobalDispatch, New,
};

use crate::DomicileCompositor;

/// Advertises both exporters.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, zxdg_exporter_v1::ZxdgExporterV1, _>(1, ());
    display.create_global::<DomicileCompositor, zxdg_exporter_v2::ZxdgExporterV2, _>(1, ());
}

/// An exported object's handle, so its destruction can forget it.
pub struct Exported(String);

impl DomicileCompositor {
    /// Records an export of `surface` and returns its handle.
    fn export(&mut self, surface: &WlSurface) -> Exported {
        let app_id = self.app_id_of(surface);
        Exported(self.hub.host.lock().unwrap().exports_mut().export(app_id))
    }

    fn unexport(&mut self, exported: &Exported) {
        self.hub
            .host
            .lock()
            .unwrap()
            .exports_mut()
            .unexport(&exported.0);
    }
}

impl GlobalDispatch<zxdg_exporter_v1::ZxdgExporterV1, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<zxdg_exporter_v1::ZxdgExporterV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<zxdg_exporter_v1::ZxdgExporterV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &zxdg_exporter_v1::ZxdgExporterV1,
        request: zxdg_exporter_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let zxdg_exporter_v1::Request::Export { id, surface } = request {
            let exported = state.export(&surface);
            let handle = exported.0.clone();
            data_init.init(id, exported).handle(handle);
        }
    }
}

impl Dispatch<zxdg_exported_v1::ZxdgExportedV1, Exported> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &zxdg_exported_v1::ZxdgExportedV1,
        _: zxdg_exported_v1::Request,
        _: &Exported,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }

    fn destroyed(
        state: &mut Self,
        _: ClientId,
        _: &zxdg_exported_v1::ZxdgExportedV1,
        exported: &Exported,
    ) {
        state.unexport(exported);
    }
}

impl GlobalDispatch<zxdg_exporter_v2::ZxdgExporterV2, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<zxdg_exporter_v2::ZxdgExporterV2>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<zxdg_exporter_v2::ZxdgExporterV2, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &zxdg_exporter_v2::ZxdgExporterV2,
        request: zxdg_exporter_v2::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let zxdg_exporter_v2::Request::ExportToplevel { id, surface } = request {
            let exported = state.export(&surface);
            let handle = exported.0.clone();
            data_init.init(id, exported).handle(handle);
        }
    }
}

impl Dispatch<zxdg_exported_v2::ZxdgExportedV2, Exported> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &zxdg_exported_v2::ZxdgExportedV2,
        _: zxdg_exported_v2::Request,
        _: &Exported,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }

    fn destroyed(
        state: &mut Self,
        _: ClientId,
        _: &zxdg_exported_v2::ZxdgExportedV2,
        exported: &Exported,
    ) {
        state.unexport(exported);
    }
}
