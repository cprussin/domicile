//! The `domicile` host daemon.
//!
//! Boots from config, resolves the active chrome package, and serves the chrome
//! protocol over a Unix socket. This is the compositor's control plane; the
//! Wayland server and web-engine bridge will attach to the same host brain.

use std::io::BufReader;
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::exit;
use std::thread;

use domicile::run_connection;
use domicile_config::Config;
use domicile_host::ipc::Session;

struct Args {
    socket: PathBuf,
    config: PathBuf,
    shells_dir: PathBuf,
}

fn parse_args() -> Args {
    let mut socket = std::env::var_os("DOMICILE_SOCKET").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("domicile.sock"));
    let mut config = PathBuf::from("domicile.toml");
    let mut shells_dir = PathBuf::from("shells");

    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--socket" => socket = it.next().map(PathBuf::from).unwrap_or(socket),
            "--config" => config = it.next().map(PathBuf::from).unwrap_or(config),
            "--shells-dir" => shells_dir = it.next().map(PathBuf::from).unwrap_or(shells_dir),
            "--help" | "-h" => {
                eprintln!("usage: domicile [--socket PATH] [--config PATH] [--shells-dir PATH]");
                exit(0);
            }
            other => eprintln!("domicile: ignoring unknown argument {other:?}"),
        }
    }
    Args { socket, config, shells_dir }
}

fn main() {
    let args = parse_args();

    // Config is optional: a missing/invalid file means run with defaults rather
    // than refuse to boot (mirrors the hot-reload "keep serving" philosophy).
    let config = match Config::load(&args.config) {
        Ok(config) => config,
        Err(err) => {
            eprintln!("domicile: using default config ({err})");
            Config::default()
        }
    };

    let shell_path = config.shell.package.resolve(&args.shells_dir);
    eprintln!("domicile: active chrome package -> {}", shell_path.display());

    // Fresh socket each boot.
    let _ = std::fs::remove_file(&args.socket);
    let listener = match UnixListener::bind(&args.socket) {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("domicile: cannot bind {}: {err}", args.socket.display());
            exit(1);
        }
    };
    eprintln!("domicile: serving chrome protocol on {}", args.socket.display());

    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                thread::spawn(move || {
                    let reader = BufReader::new(stream.try_clone().expect("clone stream"));
                    let mut session = Session::new();
                    if let Err(err) = run_connection(reader, stream, &mut session) {
                        eprintln!("domicile: connection ended: {err}");
                    }
                });
            }
            Err(err) => {
                eprintln!("domicile: accept error: {err}");
                break;
            }
        }
    }
}
