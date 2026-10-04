//! Fetches bookmark favicons on a background thread and caches them for the
//! compositor's lifetime.
//!
//! [`domicile_host::favicons`] picks the icon; this module does the network
//! I/O. A site can take seconds to answer, so a search sends the icons found so
//! far and draws pending bookmarks without one.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_host::favicons::{favicon, Page};
use ureq::tls::{RootCerts, TlsConfig};
use ureq::ResponseExt;

/// Timeout for one request. Lookups are sequential, so a slow site delays the
/// rest.
const PATIENCE: Duration = Duration::from_secs(10);

/// Maximum bytes read from a page or icon. A page's `<head>` is near its start,
/// and `domicile_host::favicons` drops larger icons anyway.
const READ_AT_MOST: u64 = 1024 * 1024;

/// A browser's user agent, since some sites serve a different page to other
/// clients.
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/// How long to wait before retrying a site that gave no icon. The network may
/// come up after the compositor, but retrying on every keystroke is wasteful.
const RETRY_AFTER: Duration = Duration::from_secs(60);

/// The lookup state of one bookmark URL's icon.
enum Looked {
    /// A lookup is running.
    InFlight,
    Found(String),
    /// The site gave no icon or did not answer at this time.
    Missed(Instant),
}

/// Finds a URL's icon. The compositor uses [`favicon`] over the network.
type Resolve = dyn Fn(&str) -> Option<String> + Send + Sync;

/// Icons keyed by bookmark URL.
#[derive(Clone)]
pub struct Favicons {
    looked: Arc<Mutex<HashMap<String, Looked>>>,
    retry_after: Duration,
    resolve: Arc<Resolve>,
}

impl Default for Favicons {
    /// Fetches icons over the network.
    fn default() -> Self {
        let agent = agent();
        Favicons::new(RETRY_AFTER, move |url| {
            favicon(url, |asked| fetch(&agent, asked))
        })
    }
}

impl Favicons {
    /// Icons found by `resolve`, retrying a miss after `retry_after`.
    pub fn new(
        retry_after: Duration,
        resolve: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        Favicons {
            looked: Arc::new(Mutex::new(HashMap::new())),
            retry_after,
            resolve: Arc::new(resolve),
        }
    }

    /// The icon found for `url`, if one has been.
    pub fn icon(&self, url: &str) -> Option<String> {
        match self.looked.lock().unwrap().get(url) {
            Some(Looked::Found(icon)) => Some(icon.clone()),
            _ => None,
        }
    }

    /// Looks up, on a new thread, each of `urls` that is new or whose miss is
    /// due for a retry. URLs already in flight are skipped.
    pub fn look_for(&self, urls: impl IntoIterator<Item = String>) {
        let wanted: Vec<String> = {
            let mut looked = self.looked.lock().unwrap();
            urls.into_iter()
                .filter(|url| match looked.get(url) {
                    None => true,
                    Some(Looked::Missed(at)) => at.elapsed() >= self.retry_after,
                    Some(Looked::InFlight | Looked::Found(_)) => false,
                })
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .inspect(|url| {
                    looked.insert(url.clone(), Looked::InFlight);
                })
                .collect()
        };
        if wanted.is_empty() {
            return;
        }
        let favicons = self.clone();
        std::thread::Builder::new()
            .name("favicons".into())
            .spawn(move || {
                for url in wanted {
                    let icon = (favicons.resolve)(&url);
                    tracing::debug!(%url, found = icon.is_some(), "looked for a bookmark's icon");
                    favicons.looked.lock().unwrap().insert(
                        url,
                        icon.map_or_else(|| Looked::Missed(Instant::now()), Looked::Found),
                    );
                }
            })
            .expect("a thread to look for bookmarks' icons on");
    }

    #[cfg(test)]
    fn in_flight(&self, url: &str) -> bool {
        matches!(self.looked.lock().unwrap().get(url), Some(Looked::InFlight))
    }
}

/// The HTTP agent. It uses the platform certificate store so a home server's
/// local CA is trusted.
fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(PATIENCE))
        .user_agent(USER_AGENT)
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .into()
}

/// Fetches `url`, following redirects. Returns `None` on any failure; the
/// bookmark is then drawn with a glyph.
fn fetch(agent: &ureq::Agent, url: &str) -> Option<Page> {
    let mut response = agent
        .get(url)
        .call()
        .map_err(|error| tracing::debug!(%url, %error, "a bookmark's site did not answer"))
        .ok()?;
    let landed = response.get_uri().to_string();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|kind| kind.to_str().ok())
        .map(str::to_string);
    let mut body = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(READ_AT_MOST)
        .read_to_end(&mut body)
        .ok()?;
    Some(Page {
        url: landed,
        content_type,
        body,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    use super::*;

    /// Waits for a lookup thread to make `done` true.
    fn until(done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done() {
            assert!(Instant::now() < deadline, "the lookup never finished");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_site_that_had_no_icon_is_asked_again_once_it_is_due() {
        // The network may come up after the compositor.
        let asked = Arc::new(AtomicUsize::new(0));
        let counted = asked.clone();
        let favicons = Favicons::new(Duration::ZERO, move |_: &str| {
            (counted.fetch_add(1, Ordering::SeqCst) > 0).then(|| "data:icon".to_string())
        });

        favicons.look_for(["https://a.example".to_string()]);
        until(|| asked.load(Ordering::SeqCst) == 1 && !favicons.in_flight("https://a.example"));
        assert_eq!(favicons.icon("https://a.example"), None);
        favicons.look_for(["https://a.example".to_string()]);
        until(|| favicons.icon("https://a.example").is_some());
    }

    #[test]
    fn a_site_being_looked_at_is_not_looked_at_twice() {
        let asked = Arc::new(AtomicUsize::new(0));
        let counted = asked.clone();
        let (release, held) = mpsc::channel::<()>();
        let held = Mutex::new(held);
        let favicons = Favicons::new(Duration::ZERO, move |_: &str| {
            counted.fetch_add(1, Ordering::SeqCst);
            held.lock().unwrap().recv().ok();
            Some("data:icon".to_string())
        });

        favicons.look_for(["https://b.example".to_string()]);
        favicons.look_for(["https://b.example".to_string()]);
        release.send(()).unwrap();
        until(|| favicons.icon("https://b.example").is_some());
        assert_eq!(asked.load(Ordering::SeqCst), 1);
    }
}
