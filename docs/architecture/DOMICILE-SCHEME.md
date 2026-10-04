# `domicile://`: serving the shell without a port

The engine serves the shell page from a custom scheme, `domicile://`, and the
page reaches the compositor through the desktop handed to its `Shell`. No TCP
port is open.
Patches `0008` and `0009`.

## Why

- The shell's JavaScript needs a real origin. `file:` has none (no WebSocket,
  restricted `fetch`), and JavaScript cannot open a unix socket.
- The compositor's control channel is the desktop's control plane. It accepts
  `Spawn { command }` (run any command) and synthetic `Key` and
  `PointerButton` events into any window. It reports every window title and
  every keystroke (`AppTitled`, `Displays`, `Modifiers`).
- A loopback port exposes that to every process on the machine. An `Origin`
  check stops other browser pages but not `curl`, which forges any header. With
  no port, the only way in is the compositor's socket under
  `XDG_RUNTIME_DIR`, which is mode 700 and owned by the user.

Do not add a loopback server for a page that needs a channel. Use this scheme
and the binding.

## `domicile://shell/`

- A standard scheme that is neither web-safe nor CORS-enabled. It has a real
  origin, and web content can neither navigate to it nor fetch from it.
- Registered through `ContentClient::AddAdditionalSchemes`.
- Loaded through `ContentBrowserClient::CreateNonNetworkNavigationURLLoaderFactory`
  (navigation) and `RegisterNonNetworkSubresourceURLLoaderFactories`
  (subresources).
- `--domicile-shell-root` and `--domicile-shell-module` say what to serve.
- Requests must resolve inside the shell root. Directory listings are off.

The fork writes the shell's HTML document
(`components/domicile/browser/shell_url_loader_factory.cc`). It sets:

- a charset, so the page is not decoded by guesswork
- a viewport, so the engine does not lay out for a phone
- a root with no margin, so the page fills the area the compositor assigned it
- a `domicile-shell-module` meta naming the shell module. The document runs no
  script: Blink's `DomicileShell` imports the module once the document is
  parsed and calls `Shell(document.body, domicile)`

## `domicile://home/`

The user's home directory, for launcher previews (an `<img>`, `<video>` or PDF
of a file search found). Beyond the shell root's containment it refuses:

- any path containing a dotfile (the file index uses the same rule)
- any request whose initiator is not `domicile://shell`. The subresource
  factory serves every frame, so without this a site in a `<webview>` could
  probe which files exist.
- every request while the desk is locked

## The control channel

- `--domicile-control-socket` names the compositor's socket. The engine holds
  it, not the page.
- `components/domicile/mojom/control_channel.mojom` defines the protocol.
- [CONTROL-CHANNEL.md](/packages/domicile-engine/docs/CONTROL-CHANNEL.md) has
  the details.
