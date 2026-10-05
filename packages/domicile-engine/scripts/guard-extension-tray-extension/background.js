// The badge guard-extension-tray.sh reads off the shell's `extensions`:
// set by the service worker rather than the manifest, because a manifest has
// no badge -- so the event carrying it is ExtensionActionDispatcher's change
// reaching the page, not the list read once at load.
//
// The text and the color are the guard's BADGE and BADGE_COLOR, and
// scripts/test-extension-tray-guard.sh holds the three together.
//
// Off `globalThis` because `chrome` is an extension's global, which the
// linter this repository runs over every script does not know.
const { action } = globalThis.chrome;
action.setBadgeText({ text: "7" });
action.setBadgeBackgroundColor({ color: "#8E24AA" });
