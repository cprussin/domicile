//! The OAuth 2.1 authorization server that `domicile mcp --http` runs for
//! itself, so a client such as claude.ai can sign in to the desk.
//!
//! A client registers itself (RFC 7591) and sends the user to `/authorize`,
//! where they enter the pairing code the desk then shows them. The code
//! proves they can see the desk; what the agent may then reach, the user still decides on the
//! desk at its first tool call. Codes are bound to a PKCE S256 challenge.
//! Clients and refresh tokens are kept, refresh tokens only as hashes, so a
//! client stays signed in when the server restarts. See `docs/AGENTS.md`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::base64;

/// A request's query or form fields.
pub(super) type Params = HashMap<String, String>;

/// How long an authorization code may wait to be exchanged.
const CODE_LIFETIME_MS: u64 = 2 * 60 * 1000;
/// How long an access token lasts.
const ACCESS_LIFETIME_MS: u64 = 60 * 60 * 1000;
/// How long a refresh token lasts unused.
const REFRESH_IDLE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// Wrong pairing codes before the code changes.
const MISSES: u32 = 5;
/// The letters a pairing code is made of: no 0, 1, I, L or O to misread.
const PAIRING_LETTERS: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/// What the server keeps between runs.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Saved {
    clients: Vec<Client>,
    refresh: Vec<Refresh>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Client {
    id: String,
    name: String,
    redirect_uris: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Refresh {
    /// The token's SHA-256, in hex.
    hash: String,
    client: String,
    used_ms: u64,
}

/// An authorization code waiting to be exchanged.
struct Code {
    code: String,
    client: String,
    redirect_uri: String,
    challenge: String,
    issued_ms: u64,
}

struct Access {
    token: String,
    expires_ms: u64,
}

/// What `/authorize` answers.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Authorized {
    /// Send the browser here: the client, with a code or an error.
    Redirect(String),
    /// Ask for the pairing code, for the client named; `wrong` after a wrong
    /// one.
    Ask { client: String, wrong: bool },
    /// The request can't go back to the client, which is unknown or named a
    /// redirect it didn't register.
    Refused(String),
}

/// Shows the user the pairing code for the client named.
pub(super) type Shows = dyn Fn(&str, &str) + Send;

/// The authorization server.
pub(super) struct Auth {
    issuer: String,
    path: Option<PathBuf>,
    saved: Saved,
    codes: Vec<Code>,
    access: Vec<Access>,
    pairing: String,
    misses: u32,
    clock: Box<dyn Fn() -> u64 + Send>,
    random: Box<dyn FnMut() -> [u8; 32] + Send>,
    told: Box<Shows>,
}

impl Auth {
    /// The server at `issuer`, its base URL, keeping what it must at `path`.
    /// `clock` is the time in milliseconds and `random` makes secrets.
    /// `told` hears the client and the pairing code each time `/authorize`
    /// asks for it, for the desk to show the user.
    pub(super) fn new(
        issuer: String,
        path: Option<PathBuf>,
        clock: impl Fn() -> u64 + Send + 'static,
        random: impl FnMut() -> [u8; 32] + Send + 'static,
        told: impl Fn(&str, &str) + Send + 'static,
    ) -> Auth {
        let saved = path.as_ref().map(load).unwrap_or_default();
        let mut auth = Auth {
            issuer,
            path,
            saved,
            codes: Vec::new(),
            access: Vec::new(),
            pairing: String::new(),
            misses: 0,
            clock: Box::new(clock),
            random: Box::new(random),
            told: Box::new(told),
        };
        auth.new_pairing();
        auth
    }

    /// The MCP endpoint, which tokens are for.
    pub(super) fn resource(&self) -> String {
        format!("{}/mcp", self.issuer)
    }

    /// RFC 9728's protected resource metadata.
    pub(super) fn resource_metadata(&self) -> Value {
        json!({
            "resource": self.resource(),
            "authorization_servers": [self.issuer],
            "bearer_methods_supported": ["header"],
        })
    }

    /// RFC 8414's authorization server metadata.
    pub(super) fn metadata(&self) -> Value {
        let issuer = &self.issuer;
        json!({
            "issuer": issuer,
            "authorization_endpoint": format!("{issuer}/authorize"),
            "token_endpoint": format!("{issuer}/token"),
            "registration_endpoint": format!("{issuer}/register"),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
        })
    }

    /// Registers a client from its metadata, answering RFC 7591's response
    /// or error.
    pub(super) fn register(&mut self, metadata: &Value) -> Result<Value, Value> {
        let redirect_uris: Vec<String> = match metadata["redirect_uris"].as_array() {
            Some(uris) if !uris.is_empty() => uris
                .iter()
                .map(|uri| uri.as_str().map(str::to_string))
                .collect::<Option<_>>()
                .ok_or_else(|| refusal("invalid_redirect_uri", "redirect_uris are strings"))?,
            _ => return Err(refusal("invalid_redirect_uri", "redirect_uris is required")),
        };
        if let Some(uri) = redirect_uris.iter().find(|uri| !redirectable(uri)) {
            return Err(refusal(
                "invalid_redirect_uri",
                &format!("{uri} is neither https nor on this computer"),
            ));
        }
        let name = metadata["client_name"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("An agent")
            .to_string();
        let client = Client {
            id: self.secret(),
            name,
            redirect_uris,
        };
        let answer = json!({
            "client_id": client.id,
            "client_name": client.name,
            "redirect_uris": client.redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        });
        self.saved.clients.push(client);
        self.save();
        Ok(answer)
    }

    /// Answers `/authorize` with `query`, and with the pairing code the user
    /// `entered`, if they have.
    pub(super) fn authorize(&mut self, query: &Params, entered: Option<&str>) -> Authorized {
        let field = |name: &str| query.get(name).map(String::as_str).unwrap_or("");
        let Some(client) = self.client(field("client_id")).cloned() else {
            return Authorized::Refused("This app isn't registered with your desktop.".into());
        };
        let redirect_uri = field("redirect_uri");
        if !client.redirect_uris.iter().any(|uri| uri == redirect_uri) {
            return Authorized::Refused(format!(
                "{} asked to go back to an address it didn't register.",
                client.name
            ));
        }
        let back = |error: &str| {
            let mut fields = vec![("error", error)];
            if let Some(state) = query.get("state") {
                fields.push(("state", state));
            }
            Authorized::Redirect(with_query(redirect_uri, &fields))
        };
        if field("response_type") != "code" {
            return back("unsupported_response_type");
        }
        if field("code_challenge_method") != "S256" || field("code_challenge").is_empty() {
            return back("invalid_request");
        }
        if query
            .get("resource")
            .is_some_and(|resource| *resource != self.resource())
        {
            return back("invalid_target");
        }
        let wrong = match entered {
            Some(entered) if same_code(entered, &self.pairing) => false,
            Some(_) => {
                self.misses += 1;
                if self.misses >= MISSES {
                    self.new_pairing();
                }
                true
            }
            None => false,
        };
        if entered.is_none() || wrong {
            (self.told)(&client.name, &self.pairing);
            return Authorized::Ask {
                client: client.name,
                wrong,
            };
        }
        // A code lets one client in once.
        self.new_pairing();
        let code = self.secret();
        self.codes.push(Code {
            code: code.clone(),
            client: client.id,
            redirect_uri: redirect_uri.to_string(),
            challenge: field("code_challenge").to_string(),
            issued_ms: (self.clock)(),
        });
        let mut fields = vec![("code", code.as_str())];
        if let Some(state) = query.get("state") {
            fields.push(("state", state));
        }
        Authorized::Redirect(with_query(redirect_uri, &fields))
    }

    /// Answers `/token` with `form`: tokens, or RFC 6749's error.
    pub(super) fn token(&mut self, form: &Params) -> Result<Value, Value> {
        let field = |name: &str| form.get(name).map(String::as_str).unwrap_or("");
        if form
            .get("resource")
            .is_some_and(|resource| *resource != self.resource())
        {
            return Err(refusal(
                "invalid_target",
                "tokens are only for this desktop",
            ));
        }
        let client = field("client_id").to_string();
        let now = (self.clock)();
        match field("grant_type") {
            "authorization_code" => {
                let at = self
                    .codes
                    .iter()
                    .position(|code| code.code == field("code"))
                    .ok_or_else(|| refusal("invalid_grant", "the code is unknown or used"))?;
                // Used or not, a code is tried once.
                let code = self.codes.remove(at);
                if now.saturating_sub(code.issued_ms) > CODE_LIFETIME_MS {
                    return Err(refusal("invalid_grant", "the code expired"));
                }
                if code.client != client || code.redirect_uri != field("redirect_uri") {
                    return Err(refusal("invalid_grant", "the code was for another client"));
                }
                if challenge(field("code_verifier")) != code.challenge {
                    return Err(refusal("invalid_grant", "the code verifier does not match"));
                }
                Ok(self.tokens(client, now))
            }
            "refresh_token" => {
                let hash = hashed(field("refresh_token"));
                self.saved
                    .refresh
                    .retain(|refresh| now.saturating_sub(refresh.used_ms) <= REFRESH_IDLE_MS);
                let at = self
                    .saved
                    .refresh
                    .iter()
                    .position(|refresh| refresh.hash == hash && refresh.client == client)
                    .ok_or_else(|| refusal("invalid_grant", "the refresh token is unknown"))?;
                // Each refresh token is used once.
                self.saved.refresh.remove(at);
                Ok(self.tokens(client, now))
            }
            _ => Err(refusal(
                "unsupported_grant_type",
                "authorization_code or refresh_token",
            )),
        }
    }

    /// Whether `token` is an access token this server issued that is still
    /// good.
    pub(super) fn allows(&mut self, token: &str) -> bool {
        let now = (self.clock)();
        self.access.retain(|access| access.expires_ms > now);
        self.access.iter().any(|access| access.token == token)
    }

    fn tokens(&mut self, client: String, now: u64) -> Value {
        let access = self.secret();
        let refresh = self.secret();
        self.access.push(Access {
            token: access.clone(),
            expires_ms: now + ACCESS_LIFETIME_MS,
        });
        self.saved.refresh.push(Refresh {
            hash: hashed(&refresh),
            client,
            used_ms: now,
        });
        self.save();
        json!({
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": ACCESS_LIFETIME_MS / 1000,
            "refresh_token": refresh,
        })
    }

    fn client(&self, id: &str) -> Option<&Client> {
        self.saved.clients.iter().find(|client| client.id == id)
    }

    fn new_pairing(&mut self) {
        let bytes = (self.random)();
        let letters: String = bytes[..8]
            .iter()
            .map(|byte| char::from(PAIRING_LETTERS[usize::from(*byte) % PAIRING_LETTERS.len()]))
            .collect();
        self.pairing = format!("{}-{}", &letters[..4], &letters[4..]);
        self.misses = 0;
    }

    fn secret(&mut self) -> String {
        base64url(&(self.random)())
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        let written = path
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| {
                fs::write(
                    path,
                    serde_json::to_vec_pretty(&self.saved).expect("it serializes"),
                )
            });
        if let Err(why) = written {
            eprintln!(
                "domicile: could not save signed-in agents to {}: {why}",
                path.display()
            );
        }
    }
}

fn load(path: &PathBuf) -> Saved {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|why| {
            eprintln!(
                "domicile: {} is unreadable, so every agent signs in again: {why}",
                path.display()
            );
            Saved::default()
        }),
        Err(_) => Saved::default(),
    }
}

fn refusal(error: &str, description: &str) -> Value {
    json!({"error": error, "error_description": description})
}

/// Whether a client may be sent back to `uri`: over https, or to this
/// computer.
fn redirectable(uri: &str) -> bool {
    let loopback = ["http://localhost", "http://127.0.0.1", "http://[::1]"];
    uri.starts_with("https://")
        || loopback.iter().any(|base| {
            uri.strip_prefix(base)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with([':', '/']))
        })
}

/// `uri` with `fields` added to its query.
fn with_query(uri: &str, fields: &[(&str, &str)]) -> String {
    let joined = fields
        .iter()
        .map(|(name, value)| format!("{name}={}", escaped(value)))
        .collect::<Vec<_>>()
        .join("&");
    let separator = if uri.contains('?') { '&' } else { '?' };
    format!("{uri}{separator}{joined}")
}

/// `value` percent-encoded for a query.
fn escaped(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Whether `entered` is `code`, ignoring case, spaces and dashes, in time
/// that doesn't depend on where they differ.
fn same_code(entered: &str, code: &str) -> bool {
    let normal = |text: &str| -> Vec<u8> {
        text.bytes()
            .filter(u8::is_ascii_alphanumeric)
            .map(|byte| byte.to_ascii_uppercase())
            .collect()
    };
    let (entered, code) = (normal(entered), normal(code));
    entered.len() == code.len()
        && entered
            .iter()
            .zip(&code)
            .fold(0u8, |differs, (a, b)| differs | (a ^ b))
            == 0
}

/// PKCE's S256 challenge for `verifier`.
fn challenge(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

fn hashed(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn base64url(bytes: &[u8]) -> String {
    base64(bytes)
        .trim_end_matches('=')
        .replace('+', "-")
        .replace('/', "_")
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    const ISSUER: &str = "https://desk.example";
    const VERIFIER: &str = "a-verifier-long-enough-to-be-a-real-one-0123456789";

    /// A server whose clock `now` sets, whose secrets count up, and the
    /// pairing codes it told.
    struct Desk {
        auth: Auth,
        now: Arc<AtomicU64>,
        told: Arc<Mutex<Vec<String>>>,
    }

    fn desk(path: Option<PathBuf>) -> Desk {
        let now = Arc::new(AtomicU64::new(1_000));
        let told = Arc::new(Mutex::new(Vec::new()));
        let counter = Arc::new(AtomicU8::new(0));
        let auth = Auth::new(
            ISSUER.to_string(),
            path,
            {
                let now = Arc::clone(&now);
                move || now.load(Ordering::SeqCst)
            },
            move || [counter.fetch_add(1, Ordering::SeqCst); 32],
            {
                let told = Arc::clone(&told);
                move |_: &str, code: &str| told.lock().unwrap().push(code.to_string())
            },
        );
        Desk { auth, now, told }
    }

    impl Desk {
        /// The code the desk shows when `client` asks.
        fn pairing(&mut self, client: &str) -> String {
            self.auth.authorize(&asking(client), None);
            self.told.lock().unwrap().last().unwrap().clone()
        }

        fn registered(&mut self) -> String {
            self.auth
                .register(&json!({
                    "client_name": "Claude",
                    "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                }))
                .unwrap()["client_id"]
                .as_str()
                .unwrap()
                .to_string()
        }

        fn code(&mut self, client: &str) -> String {
            let pairing = self.pairing(client);
            let Authorized::Redirect(to) = self.auth.authorize(&asking(client), Some(&pairing))
            else {
                panic!("not let in");
            };
            query_of(&to)["code"].clone()
        }

        fn exchanged(&mut self, client: &str, code: &str) -> Result<Value, Value> {
            self.auth.token(&params(&[
                ("grant_type", "authorization_code"),
                ("client_id", client),
                ("code", code),
                ("redirect_uri", "https://claude.ai/api/mcp/auth_callback"),
                ("code_verifier", VERIFIER),
            ]))
        }
    }

    fn params(fields: &[(&str, &str)]) -> Params {
        fields
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect()
    }

    fn asking(client: &str) -> Params {
        params(&[
            ("response_type", "code"),
            ("client_id", client),
            ("redirect_uri", "https://claude.ai/api/mcp/auth_callback"),
            ("code_challenge", &challenge(VERIFIER)),
            ("code_challenge_method", "S256"),
            ("state", "a state&more"),
            ("resource", "https://desk.example/mcp"),
        ])
    }

    fn query_of(uri: &str) -> HashMap<String, String> {
        let (_, query) = uri.split_once('?').unwrap();
        query
            .split('&')
            .map(|field| {
                let (name, value) = field.split_once('=').unwrap();
                let value = value.replace("%20", " ").replace("%26", "&");
                (name.to_string(), value)
            })
            .collect()
    }

    #[test]
    fn metadata_names_its_endpoints_and_only_s256() {
        let desk = desk(None);
        let metadata = desk.auth.metadata();
        assert_eq!(metadata["issuer"], ISSUER);
        assert_eq!(metadata["token_endpoint"], "https://desk.example/token");
        assert_eq!(
            metadata["registration_endpoint"],
            "https://desk.example/register"
        );
        assert_eq!(
            metadata["code_challenge_methods_supported"],
            json!(["S256"])
        );
        assert_eq!(
            desk.auth.resource_metadata()["resource"],
            "https://desk.example/mcp"
        );
    }

    #[test]
    fn a_client_registers_only_https_or_loopback_redirects() {
        let mut desk = desk(None);
        let refused = desk
            .auth
            .register(&json!({"redirect_uris": ["http://evil.example/back"]}))
            .unwrap_err();
        assert_eq!(refused["error"], "invalid_redirect_uri");
        assert!(desk
            .auth
            .register(&json!({"redirect_uris": ["http://localhost.evil.example/back"]}))
            .is_err());
        let registered = desk
            .auth
            .register(&json!({"redirect_uris": ["http://127.0.0.1:4567/callback"]}))
            .unwrap();
        assert_eq!(registered["client_name"], "An agent");
        assert_eq!(registered["token_endpoint_auth_method"], "none");
    }

    #[test]
    fn authorize_refuses_an_unknown_client_or_redirect_without_going_back() {
        let mut desk = desk(None);
        assert!(matches!(
            desk.auth.authorize(&asking("nobody"), None),
            Authorized::Refused(_)
        ));
        let client = desk.registered();
        let mut elsewhere = asking(&client);
        elsewhere.insert("redirect_uri".into(), "https://evil.example/".into());
        assert!(matches!(
            desk.auth.authorize(&elsewhere, None),
            Authorized::Refused(_)
        ));
    }

    #[test]
    fn authorize_sends_a_bad_request_back_with_its_state() {
        let mut desk = desk(None);
        let client = desk.registered();
        let mut plain = asking(&client);
        plain.insert("code_challenge_method".into(), "plain".into());
        let Authorized::Redirect(to) = desk.auth.authorize(&plain, None) else {
            panic!("not sent back");
        };
        assert_eq!(query_of(&to)["error"], "invalid_request");
        assert_eq!(query_of(&to)["state"], "a state&more");
    }

    #[test]
    fn the_pairing_code_lets_one_client_in_once() {
        let mut desk = desk(None);
        let client = desk.registered();
        assert_eq!(
            desk.auth.authorize(&asking(&client), None),
            Authorized::Ask {
                client: "Claude".into(),
                wrong: false
            }
        );
        assert_eq!(
            desk.auth.authorize(&asking(&client), Some("WRNG-CODE")),
            Authorized::Ask {
                client: "Claude".into(),
                wrong: true
            }
        );
        let pairing = desk.pairing(&client);
        let typed = pairing.to_lowercase().replace('-', " ");
        let Authorized::Redirect(to) = desk.auth.authorize(&asking(&client), Some(&typed)) else {
            panic!("not let in");
        };
        assert!(to.starts_with("https://claude.ai/api/mcp/auth_callback?code="));
        assert_eq!(query_of(&to)["state"], "a state&more");
        assert_ne!(desk.pairing(&client), pairing, "a used code changes");
        assert!(matches!(
            desk.auth.authorize(&asking(&client), Some(&pairing)),
            Authorized::Ask { wrong: true, .. }
        ));
    }

    #[test]
    fn too_many_wrong_codes_change_it() {
        let mut desk = desk(None);
        let client = desk.registered();
        let pairing = desk.pairing(&client);
        for _ in 0..MISSES {
            desk.auth.authorize(&asking(&client), Some("WRNG-CODE"));
        }
        assert_ne!(desk.pairing(&client), pairing);
    }

    #[test]
    fn a_code_and_its_verifier_get_tokens_once() {
        let mut desk = desk(None);
        let client = desk.registered();
        let code = desk.code(&client);
        let tokens = desk.exchanged(&client, &code).unwrap();
        assert_eq!(tokens["token_type"], "Bearer");
        assert!(desk.auth.allows(tokens["access_token"].as_str().unwrap()));
        assert!(!desk.auth.allows("made-up"));
        assert_eq!(
            desk.exchanged(&client, &code).unwrap_err()["error"],
            "invalid_grant"
        );
    }

    #[test]
    fn a_code_with_the_wrong_verifier_or_too_late_gets_nothing() {
        let mut desk = desk(None);
        let client = desk.registered();
        let code = desk.code(&client);
        let wrong = desk.auth.token(&params(&[
            ("grant_type", "authorization_code"),
            ("client_id", &client),
            ("code", &code),
            ("redirect_uri", "https://claude.ai/api/mcp/auth_callback"),
            ("code_verifier", "another verifier"),
        ]));
        assert_eq!(wrong.unwrap_err()["error"], "invalid_grant");
        let late = desk.code(&client);
        desk.now.fetch_add(CODE_LIFETIME_MS + 1, Ordering::SeqCst);
        assert_eq!(
            desk.exchanged(&client, &late).unwrap_err()["error"],
            "invalid_grant"
        );
    }

    #[test]
    fn an_access_token_lasts_an_hour() {
        let mut desk = desk(None);
        let client = desk.registered();
        let code = desk.code(&client);
        let tokens = desk.exchanged(&client, &code).unwrap();
        desk.now.fetch_add(ACCESS_LIFETIME_MS, Ordering::SeqCst);
        assert!(!desk.auth.allows(tokens["access_token"].as_str().unwrap()));
    }

    #[test]
    fn a_refresh_token_works_once_and_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("signed-in.json");
        let mut first = desk(Some(path.clone()));
        let client = first.registered();
        let code = first.code(&client);
        let refresh = first.exchanged(&client, &code).unwrap()["refresh_token"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!fs::read_to_string(&path).unwrap().contains(&refresh));

        let mut second = desk(Some(path));
        let refreshing = params(&[
            ("grant_type", "refresh_token"),
            ("client_id", &client),
            ("refresh_token", &refresh),
        ]);
        let tokens = second.auth.token(&refreshing).unwrap();
        assert!(second.auth.allows(tokens["access_token"].as_str().unwrap()));
        assert_eq!(
            second.auth.token(&refreshing).unwrap_err()["error"],
            "invalid_grant"
        );
    }

    #[test]
    fn tokens_for_another_resource_are_refused() {
        let mut desk = desk(None);
        let client = desk.registered();
        let mut elsewhere = asking(&client);
        elsewhere.insert("resource".into(), "https://other.example/mcp".into());
        let Authorized::Redirect(to) = desk.auth.authorize(&elsewhere, None) else {
            panic!("not sent back");
        };
        assert_eq!(query_of(&to)["error"], "invalid_target");
    }
}
