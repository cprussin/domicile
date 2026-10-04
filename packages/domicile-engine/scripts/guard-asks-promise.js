// The shell guard-asks-promise.sh drives. It asks for `old` files and at once
// for `new` ones, previews a file and searches the applications, then reports
// how each promise settled:
//
//   GUARD listening                   the channel is bound
//   GUARD asks old=<…> new=<…> preview=<kind>:<text> apps=<names>

const settled = (promise, read) =>
  promise.then(read, (error) => error?.name ?? String(error));

export const Shell = () => {
  const host = window.domicile;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-asks-promise: window.domicile is absent, so this document" +
        " was not served by the forked engine",
    );
  }
  // Reading binds the channel, which is what has the compositor speak.
  void host.windows;
  console.log("GUARD listening");

  // Asked once the compositor has welcomed the channel.
  setTimeout(async () => {
    const old = host.searchFiles("old");
    const fresh = host.searchFiles("new");
    const [oldSays, newSays, previewSays, appsSay] = await Promise.all([
      settled(old, (found) => found.files.join(",")),
      settled(fresh, (found) => found.files.join(",")),
      settled(
        host.previewFile("notes.txt"),
        (preview) => `${preview.kind}:${preview.text}`,
      ),
      settled(host.searchApps("ed"), (found) =>
        found.apps.map((app) => app.name).join(","),
      ),
    ]);
    console.log(
      `GUARD asks old=${oldSays} new=${newSays} preview=${previewSays} apps=${appsSay}`,
    );
  }, 1000);
};
