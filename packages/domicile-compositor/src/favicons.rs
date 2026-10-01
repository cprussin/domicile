//! The icons the desk's bookmarks' sites name for themselves, found off the
//! Wayland thread and kept for as long as the compositor runs.
//!
//! Glue: which icon a site names is [`domicile_host::favicons`]. This is the
//! network under it and the thread it runs on, because a site can take seconds
//! to answer and a search must not wait for one — it sends what has been found
//! so far, and a bookmark whose icon is still on its way is drawn with none.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_host::favicons::{favicon, Page};
use ureq::tls::{RootCerts, TlsConfig};
use ureq::ResponseExt;

/// How long a site has to answer one request. A page or an icon, not a site
/// that is down: the next one in the list is waiting on it.
const PATIENCE: Duration = Duration::from_secs(10);

/// The most of a page or an icon read. A page's `<head>` is near its start,
/// and an icon past `domicile_host::favicons`'s limit is not sent anyway.
const READ_AT_MOST: u64 = 1024 * 1024;

/// What a browser says it is, because some sites answer anything else with a
/// page that is not the one a person sees.
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/// How long a site that had no icon waits before it is asked again: a desk
/// comes up before its network does, and a home server can be down for a
/// minute, but a site with none is not asked on every keystroke.
const RETRY_AFTER: Duration = Duration::from_secs(60);

/// What is known of one bookmark URL's icon.
enum Looked {
    /// A thread is asking its site now.
    InFlight,
    Found(String),
    /// Its site gave none, or did not answer, at this moment.
    Missed(Instant),
}

/// How a URL's icon is found: [`favicon`] over the network, in the compositor.
type Resolve = dyn Fn(&str) -> Option<String> + Send + Sync;

/// Icons by the bookmark URL they were found for.
#[derive(Clone)]
pub struct Favicons {
    looked: Arc<Mutex<HashMap<String, Looked>>>,
    retry_after: Duration,
    resolve: Arc<Resolve>,
}

impl Default for Favicons {
    /// Found over the network, as a browser would.
    fn default() -> Self {
        let agent = agent();
        Favicons::new(RETRY_AFTER, move |url| {
            favicon(url, |asked| fetch(&agent, asked))
        })
    }
}

impl Favicons {
    /// Icons `resolve` finds, a miss asked again once `retry_after` has passed.
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

    /// Look for the icons of whichever of `urls` are due — never looked for, or
    /// missed long enough ago — on a thread of their own, one after another.
    /// One already being looked for is left to the thread doing it.
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

/// How every request is made: a browser's name, a deadline, and the
/// machine's own certificates, which is where a home server's CA is.
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

/// `url`, after any redirects, or nothing for a site that did not answer with
/// it. An unreachable site, a refusal and an error page are all the same here:
/// a bookmark with no icon, which is drawn with a glyph.
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

    /// Wait for `done`, which a lookup thread makes true.
    fn until(done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done() {
            assert!(Instant::now() < deadline, "the lookup never finished");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_site_that_had_no_icon_is_asked_again_once_it_is_due() {
        // A desk comes up before its network does: a miss then is not a miss
        // for good.
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
