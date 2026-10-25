//! The keymaps the desktop switches between and the one it types on, and the
//! pages listening for them across every chrome connection. The compositor
//! lists them; a page listens with `SystemRequest::Keymaps`. See
//! `docs/SHELL-CONFIG.md`.

use std::sync::{Arc, Mutex};

use domicile_protocol::{KeymapChoice, ListedKeymap, SystemEvent};

use crate::fanout::{Fanout, Hear, Listener};

/// The keymaps, in the config's order, and the name of the active one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listed {
    pub keymaps: Vec<ListedKeymap>,
    pub active: String,
}

impl Listed {
    /// The name `choice` picks, or `None` for a name not listed.
    pub fn chosen(&self, choice: &KeymapChoice) -> Option<String> {
        match choice {
            KeymapChoice::Next => {
                let at = self
                    .keymaps
                    .iter()
                    .position(|keymap| keymap.name == self.active)
                    .expect("the active keymap is listed");
                Some(self.keymaps[(at + 1) % self.keymaps.len()].name.clone())
            }
            KeymapChoice::Named { name } => self
                .keymaps
                .iter()
                .any(|keymap| keymap.name == *name)
                .then(|| name.clone()),
        }
    }

    /// The event a listening page is told.
    pub(crate) fn event(&self) -> SystemEvent {
        SystemEvent::Keymaps {
            keymaps: self.keymaps.clone(),
            active: self.active.clone(),
        }
    }
}

/// The current list and every page listening. Clones share both, so every
/// connection's [`crate::system::System`] holds a clone of one.
#[derive(Clone, Default)]
pub struct Keymaps {
    listed: Arc<Mutex<Option<Listed>>>,
    hearing: Fanout<Listed>,
}

impl Keymaps {
    /// Sets the list, and tells every listener if it changed.
    pub fn list(&self, listed: Listed) {
        {
            let mut current = self.listed.lock().unwrap();
            if current.as_ref() == Some(&listed) {
                return;
            }
            *current = Some(listed.clone());
        }
        self.hearing.send(&listed);
    }

    /// The current list, once the compositor gave one.
    pub fn listed(&self) -> Option<Listed> {
        self.listed.lock().unwrap().clone()
    }

    /// Calls `hear` with every change until the [`Listener`] drops.
    pub(crate) fn listen(&self, hear: Hear<Listed>) -> Listener {
        self.hearing.listen(hear)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listed(active: &str) -> Listed {
        Listed {
            keymaps: ["dvp", "us", "de"]
                .map(|name| ListedKeymap {
                    name: name.into(),
                    description: None,
                })
                .into(),
            active: active.into(),
        }
    }

    #[test]
    fn next_is_the_one_after_the_active_keymap_and_wraps() {
        assert_eq!(
            listed("dvp").chosen(&KeymapChoice::Next).as_deref(),
            Some("us")
        );
        assert_eq!(
            listed("de").chosen(&KeymapChoice::Next).as_deref(),
            Some("dvp")
        );
    }

    #[test]
    fn a_name_is_chosen_only_when_it_is_listed() {
        let named = |name: &str| KeymapChoice::Named { name: name.into() };
        assert_eq!(listed("dvp").chosen(&named("de")).as_deref(), Some("de"));
        assert_eq!(listed("dvp").chosen(&named("fr")), None);
    }
}
