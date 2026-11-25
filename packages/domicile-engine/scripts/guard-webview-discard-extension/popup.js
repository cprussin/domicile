// The extension page for guard-webview-discard.sh. It mutes the subject's tab,
// opens a popup window, and then says which tab events it hears.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD extension-ready          the subject is muted and the popup window
//                                  is open
//   GUARD tab-created, tab-removed tabs.onCreated and tabs.onRemoved
//   GUARD tab-replaced old=… muted=… index=…
//                                  tabs.onReplaced: whether the old id is the
//                                  subject's, whether the new tab is muted, and
//                                  whether its index is the subject's
//
// Read off `globalThis` because the linter does not know the `chrome` global.
const { tabs, windows } = globalThis.chrome;

const say = (what) => {
  console.log(`GUARD ${what}`);
};

// The query of the subject's page. The guard's shell shows it there.
const SUBJECT = "/page?subject-2";

const start = async () => {
  const subject = (await tabs.query({})).find((tab) =>
    tab.url.endsWith(SUBJECT),
  );
  if (subject === undefined) {
    throw new Error("guard-webview-discard: no tab shows the subject");
  }
  await tabs.update(subject.id, { muted: true });
  await windows.create({ type: "popup", url: "window.html" });
  tabs.onCreated.addListener(() => {
    say("tab-created");
  });
  tabs.onRemoved.addListener(() => {
    say("tab-removed");
  });
  tabs.onReplaced.addListener((added, removed) => {
    tabs.get(added).then(
      (tab) => {
        say(
          `tab-replaced old=${removed === subject.id}` +
            ` muted=${tab.mutedInfo.muted} index=${tab.index === subject.index}`,
        );
      },
      (error) => {
        say(`tab-replaced error=${error.message}`);
      },
    );
  });
  say("extension-ready");
};

start().catch((error) => {
  say(`extension-failed ${error.message}`);
});
