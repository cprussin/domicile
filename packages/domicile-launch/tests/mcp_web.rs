//! Tests for the desk's side of the relay: an agent's TLS connection to the
//! desk's address reaches the HTTP server on the desk, through the relay.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;

use domicile_launch::mcp::web::{dial, serve, server_config, Certificates};
use domicile_relay::Relay;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

/// A relay for `relay.example`: (public port, desk address).
fn relay() -> (u16, String) {
    let public = TcpListener::bind("127.0.0.1:0").unwrap();
    let desks = TcpListener::bind("127.0.0.1:0").unwrap();
    let ports = (
        public.local_addr().unwrap().port(),
        desks.local_addr().unwrap().to_string(),
    );
    let counter = AtomicU8::new(0);
    let relay = Relay::new("relay.example", move || {
        [counter.fetch_add(1, Ordering::SeqCst); 32]
    });
    thread::spawn(move || relay.serve(public, desks));
    ports
}

/// An HTTP server that answers every request "hello".
fn local() -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut read = Vec::new();
            let mut byte = [0];
            while !read.ends_with(b"\r\n\r\n") && stream.read(&mut byte).unwrap() == 1 {
                read.push(byte[0]);
            }
            assert!(read.starts_with(b"GET /mcp HTTP/1.1\r\n"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
                )
                .unwrap();
        }
    });
    address
}

#[test]
fn an_agent_reaches_the_desk_through_the_relay_and_only_the_desk_decrypts() {
    let (public, desks) = relay();
    let dialed = dial(&desks, &[9; 32]).unwrap();
    let host = dialed.host.clone();
    assert!(host.ends_with(".relay.example"), "{host}");

    // A certificate authority the agent trusts, and the desk's certificate.
    let authority_key = rcgen::KeyPair::generate().unwrap();
    let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let authority = params.self_signed(&authority_key).unwrap();
    let issuer = rcgen::Issuer::from_params(&params, &authority_key);
    let desk_key = rcgen::KeyPair::generate().unwrap();
    let desk = rcgen::CertificateParams::new(vec![host.clone()])
        .unwrap()
        .signed_by(&desk_key, &issuer)
        .unwrap();
    let certificates = Arc::new(Certificates::default());
    assert!(!certificates.ready());
    certificates
        .set(&desk.pem(), &desk_key.serialize_pem())
        .unwrap();
    assert!(certificates.ready());

    let config = server_config(Arc::clone(&certificates));
    let local = local();
    thread::spawn(move || serve(dialed, &desks, &config, local));

    let mut roots = RootCertStore::empty();
    roots.add(authority.der().clone()).unwrap();
    let mut client_config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
    client_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    let connection = ClientConnection::new(
        Arc::new(client_config),
        ServerName::try_from(host.clone()).unwrap(),
    )
    .unwrap();
    let tcp = TcpStream::connect(("127.0.0.1", public)).unwrap();
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .unwrap();
    let mut tls = StreamOwned::new(connection, tcp);
    tls.write_all(format!("GET /mcp HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes())
        .unwrap();
    let mut answer = String::new();
    let _ = tls.read_to_string(&mut answer);
    assert!(answer.ends_with("\r\n\r\nhello"), "{answer}");
}
