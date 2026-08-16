// A minimal headless stand-in for the chrome, used by scripts/e2e-chrome.sh:
// connect to the compositor's chrome socket, do the handshake, and print every
// message the host pushes to us. (The real chrome is the Electron app.)
const net = require("net");
const sock = process.env.LOOM_CHROME_SOCK;

const c = net.connect(sock, () => c.write('{"type":"hello","protocol_version":1}\n'));
let buf = "";
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) console.log(line);
  }
});
c.on("error", () => {});
setTimeout(() => process.exit(0), 6000);
