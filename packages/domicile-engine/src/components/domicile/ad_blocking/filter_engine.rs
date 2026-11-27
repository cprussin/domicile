// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

//! Brave's filter engine, adblock-rust, as `domicile::AdBlocker` asks it. See
//! docs/architecture/AD-BLOCKING.md.

use std::collections::HashSet;

use adblock::lists::{ExpiresInterval, FilterSet, ParseOptions, RuleTypes};
use adblock::request::Request;
use adblock::resources::{MimeType, Resource, ResourceType};
use adblock::url_parser::{set_domain_resolver, ResolvesDomain};
use adblock::Engine;

#[cxx::bridge(namespace = "domicile::ad_blocking")]
mod ffi {
    /// What one engine says of one request.
    struct Verdict {
        /// A blocking rule matched.
        matched: bool,
        /// The rule is `$important`, which no exception lifts.
        important: bool,
        /// An exception rule (`@@`) matched.
        exception: bool,
        /// The `data:` URL a matched `$redirect` rule answers with instead,
        /// or empty: empty too when the engine has no such stand-in.
        redirect: String,
        /// The URL less what `$removeparam` rules remove, or empty when they
        /// remove nothing.
        rewritten_url: String,
    }

    /// What one engine hides on a page at one address, before the page's
    /// classes and ids are known.
    struct Cosmetics {
        /// CSS selectors to hide, as `display: none !important`: the site's
        /// own rules and the generic ones that aren't a bare class or id.
        hide_selectors: Vec<String>,
        /// Class and id selectors (`.ad`, `#ad`) the site's rules except from
        /// the generic ones. For `hidden_class_id_selectors`.
        exceptions: Vec<String>,
        /// A `$generichide` exception matched: no generic rule applies.
        generichide: bool,
        /// The scriptlets the page's `##+js(...)` rules run, with those they
        /// need, as one script: empty when none do.
        injected_script: String,
        /// The page's procedural filters (`:has-text()`, `:upward()`, and
        /// those with an action such as `:style()` or `:remove()`), each as
        /// adblock-rust's JSON for content_cosmetic.ts. In order.
        procedural_actions: Vec<String>,
    }

    /// One of adblock-rust's resources, as its resources file holds it.
    struct Scriptlet {
        name: String,
        aliases: Vec<String>,
        /// Its MIME type, `application/javascript` or `fn/javascript`.
        kind: String,
        /// Its text, in base64.
        content: String,
        dependencies: Vec<String>,
    }

    unsafe extern "C++" {
        include!("components/domicile/ad_blocking/domains.h");

        /// How long `host`'s registrable domain is, counted from its end:
        /// all of `host` when it has none, as an IP address does.
        fn domain_length(host: &str) -> usize;
        /// Whether `domain` is a public suffix, such as `co.uk`.
        fn is_public_suffix(domain: &str) -> bool;
    }

    extern "Rust" {
        type FilterSetBuilder;
        type FilterEngine;

        fn new_filter_set() -> Box<FilterSetBuilder>;
        /// Adds a filter list's text, in Adblock Plus and uBlock Origin
        /// syntax. Rules it cannot read are left out, as Brave leaves them.
        fn add_list(self: &mut FilterSetBuilder, text: &str);
        /// The engine for every list added. Slow: a few hundred milliseconds
        /// for EasyList and EasyPrivacy.
        fn build(builder: Box<FilterSetBuilder>) -> Box<FilterEngine>;
        /// How long a list says to keep it before fetching it again, by its
        /// `! Expires:`, in hours: 0 when it names none.
        fn list_expires_hours(text: &str) -> u32;
        /// Gives the engine `scriptlets` for its `##+js(...)` rules to run,
        /// in place of any it had.
        fn use_scriptlets(self: &mut FilterEngine, scriptlets: &Vec<Scriptlet>);

        /// Checks a request for `url`, at host `hostname`, of adblock-rust's
        /// type `request_type`, from the page at `page_hostname`.
        /// `third_party` is whether the two are different sites. An exception
        /// is reported even when no blocking rule matched, so another
        /// engine's match can be lifted by it.
        fn check(
            self: &FilterEngine,
            url: &str,
            hostname: &str,
            page_hostname: &str,
            request_type: &str,
            third_party: bool,
            method: &str,
        ) -> Verdict;

        /// The `Content-Security-Policy` the engine's `$csp` rules add to the
        /// response for a document or frame, as `check` takes it, or empty
        /// for none.
        fn csp_directives(
            self: &FilterEngine,
            url: &str,
            hostname: &str,
            page_hostname: &str,
            request_type: &str,
            third_party: bool,
            method: &str,
        ) -> String;

        /// What the engine hides on the page at `url`.
        fn cosmetics(self: &FilterEngine, url: &str) -> Cosmetics;
        /// The generic rules' selectors for the page's `classes` and `ids`
        /// (without `.` or `#`), but those in `exceptions`.
        fn hidden_class_id_selectors(
            self: &FilterEngine,
            classes: &Vec<String>,
            ids: &Vec<String>,
            exceptions: &Vec<String>,
        ) -> Vec<String>;
    }
}

pub struct FilterSetBuilder(FilterSet);
pub struct FilterEngine(Engine);

/// Domains from Chromium's copy of the public suffix list, which updates with
/// the engine, rather than the `addr` crate's.
struct ChromiumDomains;

impl ResolvesDomain for ChromiumDomains {
    fn get_host_domain(&self, host: &str) -> (usize, usize) {
        let length = ffi::domain_length(host).min(host.len());
        (host.len() - length, host.len())
    }

    fn is_public_suffix(&self, domain: &str) -> bool {
        ffi::is_public_suffix(domain)
    }
}

fn new_filter_set() -> Box<FilterSetBuilder> {
    // Once per process; a later call hands the new resolver back, unused.
    let _ = set_domain_resolver(Box::new(ChromiumDomains));
    Box::new(FilterSetBuilder(FilterSet::new(false)))
}

impl FilterSetBuilder {
    fn add_list(&mut self, text: &str) {
        let options = ParseOptions { rule_types: RuleTypes::All, ..ParseOptions::default() };
        self.0.add_filter_list(text.to_owned(), options);
    }
}

fn build(builder: Box<FilterSetBuilder>) -> Box<FilterEngine> {
    Box::new(FilterEngine(Engine::new_with_filter_set(builder.0)))
}

fn list_expires_hours(text: &str) -> u32 {
    match adblock::lists::read_list_metadata(text).expires {
        Some(ExpiresInterval::Hours(hours)) => hours.into(),
        Some(ExpiresInterval::Days(days)) => u32::from(days) * 24,
        None => 0,
    }
}

impl FilterEngine {
    fn use_scriptlets(&mut self, scriptlets: &Vec<ffi::Scriptlet>) {
        self.0.use_resources(scriptlets.iter().map(|scriptlet| Resource {
            name: scriptlet.name.clone(),
            aliases: scriptlet.aliases.clone(),
            kind: ResourceType::Mime(MimeType::from(scriptlet.kind.as_str())),
            content: scriptlet.content.clone(),
            dependencies: scriptlet.dependencies.clone(),
            permission: Default::default(),
        }));
    }

    fn check(
        &self,
        url: &str,
        hostname: &str,
        page_hostname: &str,
        request_type: &str,
        third_party: bool,
        method: &str,
    ) -> ffi::Verdict {
        let request =
            Request::preparsed(url, hostname, page_hostname, request_type, third_party, method);
        let result = self.0.check_network_request_subset(&request, false, true);
        ffi::Verdict {
            matched: result.filter.is_some(),
            important: result.important,
            exception: result.exception.is_some(),
            redirect: result.redirect.unwrap_or_default(),
            rewritten_url: result.rewritten_url.unwrap_or_default(),
        }
    }

    fn csp_directives(
        &self,
        url: &str,
        hostname: &str,
        page_hostname: &str,
        request_type: &str,
        third_party: bool,
        method: &str,
    ) -> String {
        let request =
            Request::preparsed(url, hostname, page_hostname, request_type, third_party, method);
        self.0.get_csp_directives(&request).unwrap_or_default()
    }

    fn cosmetics(&self, url: &str) -> ffi::Cosmetics {
        let resources = self.0.url_cosmetic_resources(url);
        let mut hide_selectors: Vec<String> = resources.hide_selectors.into_iter().collect();
        let mut exceptions: Vec<String> = resources.exceptions.into_iter().collect();
        let mut procedural_actions: Vec<String> =
            resources.procedural_actions.into_iter().collect();
        // In order, so a page gets the same stylesheet each time.
        hide_selectors.sort_unstable();
        exceptions.sort_unstable();
        procedural_actions.sort_unstable();
        ffi::Cosmetics {
            hide_selectors,
            exceptions,
            generichide: resources.generichide,
            injected_script: resources.injected_script,
            procedural_actions,
        }
    }

    fn hidden_class_id_selectors(
        &self,
        classes: &Vec<String>,
        ids: &Vec<String>,
        exceptions: &Vec<String>,
    ) -> Vec<String> {
        let exceptions: HashSet<String> = exceptions.iter().cloned().collect();
        self.0.hidden_class_id_selectors(classes, ids, &exceptions)
    }
}
