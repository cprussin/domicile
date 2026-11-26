// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

//! Brave's filter engine, adblock-rust, as `domicile::AdBlocker` asks it. See
//! docs/architecture/AD-BLOCKING.md.

use adblock::lists::{FilterSet, ParseOptions, RuleTypes};
use adblock::request::Request;
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
        // Network rules only, for now: nothing applies cosmetic ones yet.
        let options = ParseOptions { rule_types: RuleTypes::NetworkOnly, ..ParseOptions::default() };
        self.0.add_filter_list(text.to_owned(), options);
    }
}

fn build(builder: Box<FilterSetBuilder>) -> Box<FilterEngine> {
    Box::new(FilterEngine(Engine::new_with_filter_set(builder.0)))
}

impl FilterEngine {
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
        }
    }
}
