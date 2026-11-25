// What guard-extension-commands.sh's and guard-extension-page.sh's shells ran,
// said on the badge, which the tray carries back to them.

// Off `globalThis` because `chrome` is an extension's global, which the
// linter this repository runs over every script does not know.
const { action, commands, contextMenus } = globalThis.chrome;

const say = (text) => {
  action.setBadgeText({ text });
};

// `ready` once the listeners below are registered: a command sent before the
// worker's first run reaches nothing.
contextMenus.removeAll(() => {
  contextMenus.create({ contexts: ["page"], id: "page", title: "Page item" });
  contextMenus.create(
    {
      contexts: ["action"],
      id: "remember",
      title: "Remember",
      type: "checkbox",
    },
    () => {
      say("ready");
    },
  );
});

commands.onCommand.addListener((name) => {
  say(`c:${name}`);
});

contextMenus.onClicked.addListener(({ checked, menuItemId }) => {
  say(`m:${menuItemId}:${checked}`);
});
