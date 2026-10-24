//! Taking up a reloaded config, apart from its displays (see
//! `DomicileCompositor::adopt_the_desktop`). `crate::restatement` says what
//! changed.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::time::Instant;

use tracing::{debug, error, info, warn};

use domicile_config::{ExtensionsConfig, IdleConfig, KeyboardConfig, LockConfig, Omit, ThemeMode};
use domicile_host::Host;
use domicile_protocol::Theme;

use crate::file_indexing::Heard;
use crate::idle::Idle;
use crate::keymap::compiled_keymap;
use crate::portals::shell_appearance;
use crate::restatement::Restatement;
use crate::scale::output_scale;
use crate::{grepped, DomicileCompositor};
use crate::{pam, shell_config};

/// Convert a config theme to the protocol's.
///
/// Kept as two enums because `domicile-protocol` depends only on serde, like
/// `DisplayTransform` and `domicile_config::Transform`.
/// `scripts/test-themes-agree.sh` keeps them in sync.
pub fn theme_on_the_wire(mode: ThemeMode) -> Theme {
    match mode {
        ThemeMode::Dark => Theme::Dark,
        ThemeMode::Light => Theme::Light,
    }
}

/// Give the host the config's `extensions`, for chromes that connect later.
///
/// Config paths came from JSON, so they are UTF-8 and `display` is lossless.
pub fn hand_over_the_extensions(host: &mut Host, extensions: &ExtensionsConfig) {
    host.set_extensions(
        extensions.web_store.clone(),
        extensions
            .unpacked
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
    );
}

/// Give the host the resolved shell keybindings and the shell's options, for
/// chromes that connect later.
pub fn hand_over_the_shell_config(host: &mut Host, keys: BTreeMap<String, u32>, options: String) {
    host.set_shell_config(keys, options);
}

impl DomicileCompositor {
    /// Apply everything in a reloaded config except the display list.
    ///
    /// [`Restatement`] computes what changed beforehand, so an unrelated edit
    /// does not resend the keymap to every client. See
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) for
    /// displays.
    pub fn adopt_the_rest_of_the_config(&mut self, restated: &Restatement) {
        if let Some(keyboard) = &restated.keyboard {
            self.retype_the_desktop(keyboard);
        }
        // After the keyboard, whose layout chords are resolved on.
        if restated.shell_config {
            self.rebind_the_keys();
        }
        if restated.pointers {
            self.bind_the_pointers();
        }
        if let Some(max_scale) = restated.max_scale {
            self.cap_the_scale_at(max_scale);
        }
        if let Some(idle) = &restated.idle {
            self.reset_the_idle_clock(idle);
        }
        if let Some(omit) = &restated.omit {
            self.omit_from_the_index(omit);
        }
        if let Some(extensions) = &restated.extensions {
            // Store then broadcast, so the next chrome to connect gets the new
            // list.
            let told = {
                let mut host = self.hub.host.lock().unwrap();
                hand_over_the_extensions(&mut host, extensions);
                host.describe_extensions()
            };
            self.hub.broadcast(
                told.expect("a host that has just been given extensions has them to state"),
            );
        }
        if let Some(sites) = &restated.force_dark {
            // Store then broadcast, like the extensions.
            let told = {
                let mut host = self.hub.host.lock().unwrap();
                host.set_force_dark(sites.clone());
                host.describe_force_dark()
            };
            self.hub.broadcast(told);
        }
        if let Some(lockdown) = &restated.lockdown {
            self.hub.portals.lock_down(lockdown.clone());
        }
        if let Some(lock) = &restated.lock {
            self.rekey_the_lock(lock);
        }
        if let Some(theme) = restated.theme {
            // The config overrides the shell's toggle. The toggle writes
            // nothing back because the config is generated, so a `theme` edit
            // is the source of truth.
            self.hub.take_up_the_theme(theme_on_the_wire(theme));
        }
        if let Some(theme) = &restated.appearance {
            self.hub.portals.restyle(theme);
            if let Some(tray) = self.hub.tray.get() {
                tray.retheme(theme.icon_theme.clone());
            }
            if let Some(server) = self.hub.notifications.get() {
                server.retheme(theme.icon_theme.clone());
            }
            // Release the host before broadcasting.
            let told = self
                .hub
                .host
                .lock()
                .unwrap()
                .set_appearance(shell_appearance(theme));
            if let Some(message) = told {
                self.hub.broadcast(message);
            }
        }
    }

    /// Compile the config's keymap and send it to every consumer.
    ///
    /// One compilation feeds the seat (each client's `wl_keyboard.keymap`), the
    /// browser process (over the chrome socket), and later chromes (stored
    /// copy). See [`crate::keymap`].
    ///
    /// A keymap that fails to compile is refused and logged, not fatal. At
    /// startup it is fatal so the desktop never runs on xkb's fallback. On
    /// reload the last good keymap stays.
    pub fn retype_the_desktop(&mut self, keyboard: &KeyboardConfig) {
        match compiled_keymap(keyboard) {
            Err(why) => warn!(%why, "{}", grepped::KEYMAP_REFUSED),
            Ok(keymap) => {
                info!(
                    layout = %keyboard.xkb_layout,
                    variant = %keyboard.xkb_variant,
                    "the desktop types on the keyboard the config now names"
                );
                // The seat first: Smithay writes the keymap and sends the new
                // fd to each bound `wl_keyboard`.
                //
                // From the text, not `XkbConfig`, so the seat and the chrome
                // get the same bytes from one compilation.
                let typing = self
                    .seat
                    .get_keyboard()
                    .expect("the seat was given a keyboard at startup");
                typing
                    .set_keymap_from_string(self, keymap.clone())
                    .expect("xkb reads back the keymap text it has just written");
                // Then the browser process. Store then broadcast, so the next
                // chrome to connect gets the new keymap.
                let told = {
                    let mut host = self.hub.host.lock().unwrap();
                    host.set_keymap(keymap);
                    host.describe_keymap()
                };
                self.hub.broadcast(
                    told.expect("a host that has just been given a keymap has one to state"),
                );
            }
        }
    }

    /// Resolve the reloaded config's keybindings and send them and the shell's
    /// options to every chrome.
    ///
    /// A keysym the keymap cannot type is refused and logged, not fatal, as in
    /// [`retype_the_desktop`]. The host keeps the last good keys for new
    /// chromes. A keymap that does not compile is refused here too.
    ///
    /// [`retype_the_desktop`]: DomicileCompositor::retype_the_desktop
    pub fn rebind_the_keys(&mut self) {
        match shell_config::keys(self.config.current()) {
            Err(why) => warn!(%why, "{}", grepped::KEYS_REFUSED),
            Ok(resolved) => {
                // Store then broadcast, as in `retype_the_desktop`.
                let told = {
                    let mut host = self.hub.host.lock().unwrap();
                    hand_over_the_shell_config(
                        &mut host,
                        resolved,
                        shell_config::options(self.config.current()),
                    );
                    host.describe_shell_config()
                };
                self.hub.broadcast(
                    told.expect("a host that has just been given keys has them to state"),
                );
            }
        }
    }

    /// Apply a new `output.max_scale`.
    ///
    /// Updates the hub's copy, which bounds future chrome densities, and
    /// re-applies the cap to the current desktop using the chrome's last
    /// reported ratio.
    ///
    /// [`set_output`](DomicileCompositor::set_output) skips unchanged outputs,
    /// and a described desktop refuses this (see
    /// [`set_output_scale`](DomicileCompositor::set_output_scale)).
    pub fn cap_the_scale_at(&mut self, max_scale: u32) {
        self.hub.max_scale.store(max_scale, Ordering::Relaxed);
        self.set_output_scale(output_scale(self.device_pixel_ratio, max_scale));
    }

    /// Apply new `idle` timeouts.
    ///
    /// The clock restarts from now, for blanking and locking alike.
    ///
    /// A dark desktop is woken. The new clock starts awake ([`Idle::after`]),
    /// so it can never report [`Blanking::ComeBack`] for screens the old clock
    /// turned off. Relight them now; the desktop blanks again after the new
    /// timeout.
    pub fn reset_the_idle_clock(&mut self, idle: &IdleConfig) {
        let was_dark = self.the_screens_are_dark();
        // Keep client inhibitors; see [`Idle::takes_over_from`].
        self.idle = match (Idle::after(idle, Instant::now()), self.idle.as_mut()) {
            (Some(clock), Some(previous)) => Some(clock.takes_over_from(previous)),
            (clock, _) => clock,
        };
        debug!("the idle clock starts over from the reloaded timeouts");
        // Not fatal on reload, unlike at startup: the desktop just stops
        // blanking and locking on its own. Logged so it is not silent.
        if let Err(why) = self.arm_the_idle_clock() {
            error!(
                %why,
                "no clock for the reloaded idle timeouts, so this desktop will not \
                 blank or lock on its own until it is restarted"
            );
        }
        // The new clock starts lit, so a warning running is over.
        self.tell_the_shells_how_soon_the_screens_blank();
        if was_dark {
            debug!("the idle timeout changed while the screens were off; they come back on");
            // Tell the shells. They were told the desktop is idle, and the
            // clock that would announce waking is gone. A shell would otherwise
            // stay in its idle state over a lit desktop. Unguarded, so this
            // works even if the timeout was removed.
            self.tell_the_chromes_whether_anybody_is_here();
            self.state_the_connectors();
        }
    }

    /// Apply a new `files.omit`.
    ///
    /// The index thread re-walks the home, which both drops newly omitted paths
    /// and finds newly included ones. The launcher keeps its results until
    /// then.
    pub fn omit_from_the_index(&self, omit: &Omit) {
        match &self.index {
            Some(index) => {
                if index.send(Heard::Omitting(omit.clone())).is_err() {
                    // The thread has exited, after logging why (unreadable
                    // home, or a watch failed to start).
                    warn!(
                        "the file index is no longer kept, so `files.omit` \
                         reaches it at the next start"
                    );
                }
            }
            None => debug!("no home is indexed, so `files.omit` has nothing to change"),
        }
    }

    /// Apply a new `lock`. See [`Lock::rekeyed`].
    ///
    /// PAM that startup would refuse keeps the current verifier.
    pub fn rekey_the_lock(&mut self, lock: &LockConfig) {
        match pam::for_the_desk(lock.service(), &self.pam_confdir) {
            Err(why) => error!(%why, "the reloaded lock cannot be used; the current one stays"),
            Ok(verifier) => {
                self.lock.rekeyed(Box::new(verifier));
                info!("taking up a reloaded lock");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use domicile_protocol::HostMessage;

    use super::hand_over_the_extensions;

    #[test]
    fn the_configs_extensions_go_to_the_host() {
        let mut host = domicile_host::Host::new();
        hand_over_the_extensions(
            &mut host,
            &domicile_config::ExtensionsConfig {
                web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".to_string()],
                unpacked: vec![std::path::PathBuf::from("/home/u/my-extension")],
            },
        );
        assert_eq!(
            host.describe_extensions(),
            Some(HostMessage::Extensions {
                web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".to_string()],
                unpacked: vec!["/home/u/my-extension".to_string()],
            })
        );
    }
}
