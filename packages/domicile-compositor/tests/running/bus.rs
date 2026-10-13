//! A private `dbus-daemon`, standing in for the session bus or the system bus.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use zbus::blocking::Connection;

/// How long the compositor gets to take a name on the bus.
const PATIENCE: Duration = Duration::from_secs(20);

/// A private bus. Stopped on drop.
pub struct Bus {
    daemon: Child,
    pub address: String,
    _directory: tempfile::TempDir,
}

impl Bus {
    /// A bus with its own config, since a distribution's `session.conf`
    /// may be missing or name things this machine lacks.
    pub fn started() -> Bus {
        let directory = tempfile::tempdir().expect("a directory");
        let config = directory.path().join("bus.conf");
        std::fs::write(
            &config,
            format!(
                r#"<busconfig>
  <type>session</type>
  <listen>unix:path={}</listen>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>"#,
                directory.path().join("bus").display()
            ),
        )
        .expect("the config is written");
        let mut daemon = Command::new("dbus-daemon")
            .arg("--nofork")
            .arg("--print-address")
            .arg(format!("--config-file={}", config.display()))
            .stdout(Stdio::piped())
            .spawn()
            .expect("dbus-daemon starts; it is in `nix develop .#full`");
        let mut address = String::new();
        BufReader::new(daemon.stdout.take().expect("stdout was piped"))
            .read_line(&mut address)
            .expect("dbus-daemon prints its address");
        assert!(!address.trim().is_empty(), "dbus-daemon gave no address");
        Bus {
            daemon,
            address: address.trim().to_string(),
            _directory: directory,
        }
    }

    /// A client on the bus.
    pub fn client(&self) -> Connection {
        zbus::blocking::connection::Builder::address(self.address.as_str())
            .expect("an address")
            .build()
            .expect("the bus takes a client")
    }

    /// A client on the bus, once the compositor has taken `name`.
    pub fn client_once(&self, name: &str) -> Connection {
        let connection = self.client();
        let bus = zbus::blocking::fdo::DBusProxy::new(&connection).expect("the bus");
        let until = Instant::now() + PATIENCE;
        while !bus
            .name_has_owner(name.try_into().expect("a name"))
            .expect("the bus answers")
        {
            assert!(Instant::now() < until, "the compositor never took {name}");
            std::thread::sleep(Duration::from_millis(20));
        }
        connection
    }
}

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}
