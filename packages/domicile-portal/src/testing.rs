//! Two D-Bus connections joined by a socket pair, for testing interfaces
//! without a bus daemon, and the options a call sends.

use std::collections::HashMap;
use std::os::unix::net::UnixStream;
use std::thread;

use zbus::connection::Builder;
use zbus::{Connection, OwnedVariant, Variant};

/// A call's options, or the results of its answer.
pub type Results = HashMap<String, OwnedVariant>;

/// The options `sent`, as a call carries them.
pub fn options(sent: Vec<(&str, Variant<'static>)>) -> Results {
    sent.into_iter()
        .map(|(name, value)| (name.into(), OwnedVariant::try_from(value).expect("ownable")))
        .collect()
}

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
        Builder::unix_stream(ours)
            .server(zbus::Guid::generate())
            .p2p(),
    );
    // Both ends must handshake at once.
    let server = thread::spawn(move || zbus::block_on(server.build()).expect("the server end"));
    let client = zbus::block_on(serve_client(Builder::unix_stream(theirs).p2p()).build())
        .expect("the client end");
    (server.join().expect("the server handshook"), client)
}
