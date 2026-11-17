// The preload guard-electron-preload.sh gives window 1, as an Electron app's
// sandboxed preload would be written.
// biome-ignore lint/style/noCommonJs: a preload is CommonJS, as Electron runs it.
const { contextBridge, ipcRenderer } = require("electron");

// The preload's own world: the page must not see this.
window.secret = "the preload's";

// ipcRenderer is an EventEmitter: what the preload emits reaches its own
// listeners, with the arguments as given, as Element's preload relies on.
let emitted;
ipcRenderer.once("local", (value) => {
  emitted = value;
});
ipcRenderer.emit("local", 7);

contextBridge.exposeInMainWorld("guard", {
  ask: (n) => ipcRenderer.invoke("double", n),
  askNow: (n) => ipcRenderer.sendSync("triple", n),
  emitted,
  onPing: (callback) =>
    ipcRenderer.on("ping", (_event, value) => callback(value)),
  send: (channel, value) => ipcRenderer.send(channel, value),
});

// A port the app hands over: each number on it comes back one more.
ipcRenderer.on("port", (event) => {
  const [port] = event.ports;
  port.onmessage = (message) => port.postMessage(message.data + 1);
});

// A port handed to the app: each number on it comes back ten times over.
const { port1, port2 } = new MessageChannel();
port1.onmessage = (message) => port1.postMessage(message.data * 10);
ipcRenderer.postMessage("mine", "a port", [port2]);
