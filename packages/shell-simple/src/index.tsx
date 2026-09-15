// The shell's entry point: the SDK wired to whatever host this page was opened
// under, and the React desktop mounted on top of it.

import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import { createRoot } from "react-dom/client";

import { Shell } from "./Shell";

import "./shell.css";

// Under the fork this is `window.domicile`, the control channel the engine
// puts on a document it served. In a plain browser there is none, and
// `connectToHost` says so on the console and hands back a stand-in, so the
// desktop still opens against windows that will never arrive.
const domicile = new DomicileClient(connectToHost(window));
registerElements(domicile);

// A container of our own: Domicile writes the document, and the body it writes
// holds the script tag that loaded this — which a React root on the body owns.
const mount = document.createElement("div");
document.body.append(mount);
createRoot(mount).render(<Shell domicile={domicile} />);

// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// configured `nested_size` however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
