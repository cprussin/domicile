//! The pages listening for `domicile send-shell` commands, across every chrome
//! connection. A page listens with `SystemRequest::ShellCommands`; see
//! `docs/architecture/KEYBINDINGS.md`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Hears one command, on behalf of one page.
pub(crate) type Hear = Arc<dyn Fn(&[String]) + Send + Sync>;

/// Every page listening for commands. Clones share the listeners, so every
/// connection's [`crate::system::System`] holds a clone of one.
#[derive(Clone, Default)]
pub struct ShellCommands(Arc<Mutex<Listeners>>);

#[derive(Default)]
struct Listeners {
    next: u64,
    hearing: HashMap<u64, Hear>,
}

/// One page listening. Dropping it stops it.
pub(crate) struct Listener {
    commands: ShellCommands,
    key: u64,
}

impl ShellCommands {
    /// Calls `hear` with every command sent until the [`Listener`] drops.
    pub(crate) fn listen(&self, hear: Hear) -> Listener {
        let mut listeners = self.0.lock().unwrap();
        let key = listeners.next;
        listeners.next += 1;
        listeners.hearing.insert(key, hear);
        Listener {
            commands: self.clone(),
            key,
        }
    }

    /// Sends `command` to every listener, and returns how many there were.
    ///
    /// Each is called outside the lock, since hearing takes its connection's
    /// lock, which a page starting to listen holds while it takes this one.
    pub(crate) fn send(&self, command: &[String]) -> usize {
        let hearing: Vec<Hear> = self.0.lock().unwrap().hearing.values().cloned().collect();
        for hear in &hearing {
            hear(command);
        }
        hearing.len()
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.commands.0.lock().unwrap().hearing.remove(&self.key);
    }
}
