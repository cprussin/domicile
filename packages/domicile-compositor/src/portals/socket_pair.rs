//! Two D-Bus connections joined by a socket pair, for testing interfaces
//! without a bus daemon.

use std::os::unix::net::UnixStream;
use std::thread;

use zbus::blocking::connection::Builder;
use zbus::blocking::Connection;

/// A server, set up by `serve`, and a client connected to it.
pub fn connected(
    serve: impl FnOnce(Builder<'static>) -> Builder<'static>,
) -> (Connection, Connection) {
    connected_both(serve, |client| client)
}

/// As [`connected`], with objects on the client's end too, for a backend
/// that calls back into the application's connection.
pub fn connected_both(
    serve: impl FnOnce(Builder<'static>) -> Builder<'static>,
    serve_client: impl FnOnce(Builder<'static>) -> Builder<'static>,
) -> (Connection, Connection) {
    let (ours, theirs) = UnixStream::pair().expect("a socket pair");
    let server = serve(
        Builder::async_io_unix_stream(ours)
            .server(zbus::Guid::generate())
            .expect("a server guid")
            .p2p(),
    );
    // Both ends must handshake at once.
    let server = thread::spawn(move || server.build().expect("the server end"));
    let client = serve_client(Builder::async_io_unix_stream(theirs).p2p())
        .build()
        .expect("the client end");
    (server.join().expect("the server handshook"), client)
}
