// Sets the badge that guard-extension-tray.sh reads from the `extensions`
// event. Set at runtime, since a manifest has no badge, so the event proves a
// change reaches the page.
//
// Text and color must match the guard's BADGE and BADGE_COLOR;
// scripts/test-extension-tray-guard.sh checks this.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { action } = globalThis.chrome;
action.setBadgeText({ text: "7" });
action.setBadgeBackgroundColor({ color: "#8E24AA" });
