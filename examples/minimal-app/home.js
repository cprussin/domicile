// Lists the home directory. Domicile calls `main` with the window's root
// element and the app's host; a call's answers arrive as `system` events.

export const main = (root, host) => {
  host.addEventListener("system", (event) => {
    const answer = JSON.parse(event.data);
    const reply = answer.reply;
    root.textContent =
      reply.kind === "entries"
        ? reply.entries.map((entry) => entry.name).join("\n")
        : `could not list the home directory: ${reply.error.message}`;
  });
  root.style.whiteSpace = "pre";
  root.style.font = "14px/1.5 monospace";
  // A relative path is read from the home directory.
  host.callSystem(1, JSON.stringify({ call: "read_dir", path: "." }));
};
