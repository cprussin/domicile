// Test helper: connect to the compositor's chrome socket and, when an app
// appears, forward a focus + pointer + keyboard sequence to it. Used by
// scripts/e2e-input.sh to prove input injection reaches a real client.
//
// The sequence is sent immediately and again after a short delay, because a
// one-shot pointer enter can be missed before the client has a mapped buffer
// (in real use the mouse moves after the window is up).
const net = require("net");
const sock = process.env.DOMICILE_CHROME_SOCK;

const c = net.connect(sock, () => c.write(JSON.stringify({ type: "hello", protocol_version: 1 }) + "\n"));
const send = (m) => c.write(JSON.stringify(m) + "\n");

function forward(id) {
  send({ type: "focus_app", app_id: id });
  send({ type: "pointer_motion", app_id: id, x: 10, y: 10 });
  send({ type: "pointer_motion", app_id: id, x: 20, y: 20 });
  send({ type: "pointer_button", app_id: id, button: 0x110, pressed: true });
  send({ type: "pointer_button", app_id: id, button: 0x110, pressed: false });
  send({ type: "key", app_id: id, keycode: 30, pressed: true }); // KeyA
  send({ type: "key", app_id: id, keycode: 30, pressed: false });
}

let buf = "";
let started = false;
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "app_appeared" && !started) {
      started = true;
      const id = msg.app_id;
      forward(id);
      setTimeout(() => forward(id), 1500); // second wave once mapped
    }
  }
});
c.on("error", () => {});
setTimeout(() => process.exit(0), 5000);
