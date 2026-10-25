// The shell guard-domicile-fetch.sh drives. It fetches a file beside it and
// the same file from domicile://home/, then shows `?src=` in a <webview>, whose
// page tries to read both. See guard-domicile-fetch-server.py.
//
//   GUARD shell own=<read|empty|refused> home=<read|empty|refused>
//
// Domicile calls `HostShell` once the module loads.

const FIXTURE = "guard-domicile-fetch-file.txt";

export const HostShell = (root) => {
  Promise.all([
    reading(() => fetch(FIXTURE)),
    reading(() => fetch(`domicile://home/${FIXTURE}`)),
  ])
    .then(([own, home]) => {
      console.log(`GUARD shell own=${own} home=${home}`);
      showPage(root);
    })
    .catch((error) => {
      console.error("guard-domicile-fetch: the shell could not report", error);
    });
};

/** Whether `read` answered the fixture, answered without it, or failed. */
const reading = (read) =>
  read()
    .then((response) => response.text())
    .then(
      (text) => (text.includes("domicile-fetch-fixture") ? "read" : "empty"),
      () => "refused",
    );

const showPage = (root) => {
  const src = new URLSearchParams(location.search).get("src");
  if (src === null) {
    throw new Error("guard-domicile-fetch: ?src= is required");
  } else {
    const view = document.createElement("webview");
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    // Set `src` after attaching: it requests the guest, which needs a frame.
    root.append(view);
    view.setAttribute("src", src);
  }
};
