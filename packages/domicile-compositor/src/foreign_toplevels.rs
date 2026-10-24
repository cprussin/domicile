//! `ext-foreign-toplevel-list-v1`: the windows, for capture tools to pick
//! one as a source (see [`crate::screencopy`]). Hidden from sandboxed
//! clients, as the capture globals are.

use std::collections::HashMap;

use smithay::delegate_foreign_toplevel_list;
use smithay::reexports::wayland_server::DisplayHandle;
use smithay::wayland::foreign_toplevel_list::{
    ForeignToplevelHandle, ForeignToplevelListHandler, ForeignToplevelListState,
};

use crate::DomicileCompositor;

/// Each window's handle, by its host app id.
pub struct ForeignToplevels {
    state: ForeignToplevelListState,
    handles: HashMap<String, ForeignToplevelHandle>,
}

/// The host app id of the window a handle lists, in its user data.
pub struct Listed(pub String);

impl ForeignToplevels {
    /// Advertises the list.
    pub fn new(display: &DisplayHandle) -> Self {
        Self {
            state: ForeignToplevelListState::new_with_filter::<DomicileCompositor>(
                display,
                crate::clients::sees_privileged_globals,
            ),
            handles: HashMap::new(),
        }
    }

    /// Lists window `app_id`, which has no title or desktop id yet.
    pub fn opened(&mut self, app_id: &str) {
        let handle = self.state.new_toplevel::<DomicileCompositor>("", "");
        handle
            .user_data()
            .insert_if_missing_threadsafe(|| Listed(app_id.to_string()));
        self.handles.insert(app_id.to_string(), handle);
    }

    /// Window `app_id` took `title`.
    pub fn titled(&self, app_id: &str, title: &str) {
        if let Some(handle) = self.handles.get(app_id) {
            handle.send_title(title);
            handle.send_done();
        }
    }

    /// Window `app_id` took `desktop_id`, its client's app id.
    pub fn named(&self, app_id: &str, desktop_id: &str) {
        if let Some(handle) = self.handles.get(app_id) {
            handle.send_app_id(desktop_id);
            handle.send_done();
        }
    }

    /// Window `app_id` closed.
    pub fn closed(&mut self, app_id: &str) {
        if let Some(handle) = self.handles.remove(app_id) {
            self.state.remove_toplevel(&handle);
        }
    }
}

impl ForeignToplevelListHandler for DomicileCompositor {
    fn foreign_toplevel_list_state(&mut self) -> &mut ForeignToplevelListState {
        &mut self.foreign_toplevels.state
    }
}

delegate_foreign_toplevel_list!(DomicileCompositor);
