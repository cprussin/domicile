//! Composition from an input method into native windows: `text-input-v3` for
//! editors, and `input-method-v2` with `virtual-keyboard-v1` for the input
//! method (fcitx5, IBus). See `docs/architecture/TEXT-INPUT.md`.
//!
//! Smithay relays between them: text-input focus follows keyboard focus, and
//! an input method that grabs the keyboard hears the keys the engine passes to
//! the focused native window. This module adds what Smithay leaves out:
//!
//! - One input method per seat. Smithay tells the input method already bound
//!   that it is `unavailable` and never stores the new one, so neither works.
//!   Here a second one gets `unavailable` and nothing else, as the protocol
//!   asks, and the first keeps working.
//! - Nothing reaches an editor while the desk is locked. Keys go to the lock
//!   page then, but a native window keeps the seat's focus, so an input
//!   method's text or a virtual keyboard's presses would land behind the lock.

use smithay::delegate_text_input_manager;
use smithay::reexports::wayland_protocols_misc::{
    zwp_input_method_v2::server::{
        zwp_input_method_keyboard_grab_v2::{self, ZwpInputMethodKeyboardGrabV2},
        zwp_input_method_manager_v2::{self, ZwpInputMethodManagerV2},
        zwp_input_method_v2::{self, ZwpInputMethodV2},
        zwp_input_popup_surface_v2::{self, ZwpInputPopupSurfaceV2},
    },
    zwp_virtual_keyboard_v1::server::{
        zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1,
        zwp_virtual_keyboard_v1::{self, ZwpVirtualKeyboardV1},
    },
};
use smithay::reexports::wayland_server::{
    backend::ClientId, protocol::wl_surface::WlSurface, Client, DataInit, Dispatch, DisplayHandle,
};
use smithay::utils::{Logical, Rectangle};
use smithay::wayland::input_method::{
    InputMethodHandler, InputMethodManagerGlobalData, InputMethodManagerState, InputMethodUserData,
    PopupSurface,
};
use smithay::wayland::text_input::TextInputManagerState;
use smithay::wayland::virtual_keyboard::{
    VirtualKeyboardManagerGlobalData, VirtualKeyboardManagerState, VirtualKeyboardUserData,
};
use tracing::debug;

use crate::DomicileCompositor;

/// The three managers' globals. Kept so they live as long as the display.
pub struct TextInput {
    _text_input: TextInputManagerState,
    _input_method: InputMethodManagerState,
    _virtual_keyboard: VirtualKeyboardManagerState,
    /// Whether an input method is bound to the seat. Domicile has one seat.
    input_method_bound: bool,
}

impl TextInput {
    /// Advertises the managers. Every client may be an editor; only an
    /// unsandboxed one may be an input method or a virtual keyboard, since
    /// either can type into any window.
    pub fn advertise(display: &DisplayHandle) -> Self {
        Self {
            _text_input: TextInputManagerState::new::<DomicileCompositor>(display),
            _input_method: InputMethodManagerState::new::<DomicileCompositor, _>(
                display,
                crate::clients::sees_privileged_globals,
            ),
            _virtual_keyboard: VirtualKeyboardManagerState::new::<DomicileCompositor, _>(
                display,
                crate::clients::sees_privileged_globals,
            ),
            input_method_bound: false,
        }
    }
}

/// The input method's candidate popup is not shown yet: see `KNOWN-GAPS.md`.
/// Its surface is kept by Smithay and drawn nowhere.
impl InputMethodHandler for DomicileCompositor {
    fn new_popup(&mut self, _: PopupSurface) {
        debug!("input method: a candidate popup, which is not shown yet");
    }

    fn dismiss_popup(&mut self, _: PopupSurface) {}

    fn popup_repositioned(&mut self, _: PopupSurface) {}

    fn parent_geometry(&self, _: &WlSurface) -> Rectangle<i32, Logical> {
        Rectangle::default()
    }
}

delegate_text_input_manager!(DomicileCompositor);

// Smithay's `delegate_input_method_manager!`, but with the manager and each
// input method through `DomicileCompositor`, for the rules in the module docs.
smithay::reexports::wayland_server::delegate_global_dispatch!(DomicileCompositor: [
    ZwpInputMethodManagerV2: InputMethodManagerGlobalData
] => InputMethodManagerState);
smithay::reexports::wayland_server::delegate_dispatch!(DomicileCompositor: [
    ZwpInputMethodKeyboardGrabV2: smithay::wayland::input_method::InputMethodKeyboardUserData<DomicileCompositor>
] => InputMethodManagerState);
smithay::reexports::wayland_server::delegate_dispatch!(DomicileCompositor: [
    ZwpInputPopupSurfaceV2: smithay::wayland::input_method::InputMethodPopupSurfaceUserData
] => InputMethodManagerState);

// Smithay's `delegate_virtual_keyboard_manager!`, but with each virtual
// keyboard through `DomicileCompositor`, for the lock rule in the module docs.
smithay::reexports::wayland_server::delegate_global_dispatch!(DomicileCompositor: [
    ZwpVirtualKeyboardManagerV1: VirtualKeyboardManagerGlobalData
] => VirtualKeyboardManagerState);
smithay::reexports::wayland_server::delegate_dispatch!(DomicileCompositor: [
    ZwpVirtualKeyboardManagerV1: ()
] => VirtualKeyboardManagerState);

impl Dispatch<ZwpInputMethodManagerV2, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        client: &Client,
        manager: &ZwpInputMethodManagerV2,
        request: zwp_input_method_manager_v2::Request,
        data: &(),
        display: &DisplayHandle,
        init: &mut DataInit<'_, Self>,
    ) {
        let binding = matches!(
            request,
            zwp_input_method_manager_v2::Request::GetInputMethod { .. }
        );
        if binding && state.text_input.input_method_bound {
            let zwp_input_method_manager_v2::Request::GetInputMethod { input_method, .. } = request
            else {
                unreachable!("matched above")
            };
            debug!("input method: the seat has one already; this one is unavailable");
            init.init(input_method, Unavailable).unavailable();
            return;
        }
        <InputMethodManagerState as Dispatch<ZwpInputMethodManagerV2, (), Self>>::request(
            state, client, manager, request, data, display, init,
        );
        if binding {
            debug!("input method: bound to the seat");
            state.text_input.input_method_bound = true;
        }
    }
}

impl Dispatch<ZwpInputMethodV2, InputMethodUserData<DomicileCompositor>> for DomicileCompositor {
    fn request(
        state: &mut Self,
        client: &Client,
        input_method: &ZwpInputMethodV2,
        request: zwp_input_method_v2::Request,
        data: &InputMethodUserData<Self>,
        display: &DisplayHandle,
        init: &mut DataInit<'_, Self>,
    ) {
        let writes = matches!(
            request,
            zwp_input_method_v2::Request::CommitString { .. }
                | zwp_input_method_v2::Request::SetPreeditString { .. }
                | zwp_input_method_v2::Request::DeleteSurroundingText { .. }
                | zwp_input_method_v2::Request::Commit { .. }
        );
        if writes && state.the_desk_is_locked() {
            debug!("input method: the desk is locked; its text reaches no editor");
            return;
        }
        <InputMethodManagerState as Dispatch<ZwpInputMethodV2, _, Self>>::request(
            state,
            client,
            input_method,
            request,
            data,
            display,
            init,
        );
    }

    fn destroyed(
        state: &mut Self,
        client: ClientId,
        input_method: &ZwpInputMethodV2,
        data: &InputMethodUserData<Self>,
    ) {
        <InputMethodManagerState as Dispatch<ZwpInputMethodV2, _, Self>>::destroyed(
            state,
            client,
            input_method,
            data,
        );
        debug!("input method: gone; the seat takes another");
        state.text_input.input_method_bound = false;
    }
}

/// An input method, or one of its objects, that arrived while the seat had
/// one. It is told `unavailable` and does nothing; its client should destroy
/// it. Its requests are ignored rather than refused, since a client can send
/// some before it hears `unavailable`.
pub struct Unavailable;

impl Dispatch<ZwpInputMethodV2, Unavailable> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &ZwpInputMethodV2,
        request: zwp_input_method_v2::Request,
        _: &Unavailable,
        _: &DisplayHandle,
        init: &mut DataInit<'_, Self>,
    ) {
        match request {
            zwp_input_method_v2::Request::GetInputPopupSurface { id, .. } => {
                init.init(id, Unavailable);
            }
            zwp_input_method_v2::Request::GrabKeyboard { keyboard } => {
                init.init(keyboard, Unavailable);
            }
            _ => {}
        }
    }
}

impl Dispatch<ZwpInputPopupSurfaceV2, Unavailable> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &ZwpInputPopupSurfaceV2,
        _: zwp_input_popup_surface_v2::Request,
        _: &Unavailable,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }
}

impl Dispatch<ZwpInputMethodKeyboardGrabV2, Unavailable> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &ZwpInputMethodKeyboardGrabV2,
        _: zwp_input_method_keyboard_grab_v2::Request,
        _: &Unavailable,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }
}

impl Dispatch<ZwpVirtualKeyboardV1, VirtualKeyboardUserData<DomicileCompositor>>
    for DomicileCompositor
{
    fn request(
        state: &mut Self,
        client: &Client,
        keyboard: &ZwpVirtualKeyboardV1,
        request: zwp_virtual_keyboard_v1::Request,
        data: &VirtualKeyboardUserData<Self>,
        display: &DisplayHandle,
        init: &mut DataInit<'_, Self>,
    ) {
        // A press while locked is dropped. A release still goes through, so a
        // key pressed before the lock does not stay down in the window.
        if let zwp_virtual_keyboard_v1::Request::Key { state: 1, .. } = request {
            if state.the_desk_is_locked() {
                debug!("virtual keyboard: the desk is locked; its press reaches no window");
                return;
            }
        }
        <VirtualKeyboardManagerState as Dispatch<ZwpVirtualKeyboardV1, _, Self>>::request(
            state, client, keyboard, request, data, display, init,
        );
    }

    fn destroyed(
        state: &mut Self,
        client: ClientId,
        keyboard: &ZwpVirtualKeyboardV1,
        data: &VirtualKeyboardUserData<Self>,
    ) {
        <VirtualKeyboardManagerState as Dispatch<ZwpVirtualKeyboardV1, _, Self>>::destroyed(
            state, client, keyboard, data,
        );
    }
}
