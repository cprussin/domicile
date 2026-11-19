// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SPELLCHECK_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SPELLCHECK_H_

#include <string>

namespace content {
class BrowserContext;
}  // namespace content

namespace domicile {

// Spell checking in pages, with Chrome's SpellcheckService and the Hunspell
// dictionaries that ship beside the engine (patch 0246: never downloaded).
//
// - The config's `spellcheck` comes on the control channel and goes into
//   every profile's prefs, and every profile loaded after.
// - A context menu's misspelling, its suggestions and "Add to dictionary" are
//   the shell's: see WebViewGuest::ReplaceMisspelling.

// Takes the desk's spell checking from the control channel, and adds words
// for <webview> context menus. Once, from StartDesk.
void StartSpellcheck();

// Adds `word` to `context`'s own dictionary. WebViewGuest's
// AddToDictionaryCallback.
void AddToDictionary(content::BrowserContext& context, const std::string& word);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SPELLCHECK_H_
