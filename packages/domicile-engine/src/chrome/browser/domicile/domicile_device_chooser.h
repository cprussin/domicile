// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_CHOOSER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_CHOOSER_H_

namespace domicile {

// Device choosers for WebHID, WebUSB, Web Serial and Web Bluetooth, answered
// by the shell.
//
// Chrome draws a chooser as a bubble anchored to a browser window. A <webview>
// guest has no browser window, so the page was given no device. This sets
// Chrome's override (patch 0110) to ask the guest's element through
// DeviceRequested (see components/domicile/mojom/web_view_guest.mojom).
// Chrome's controllers still list the devices and grant the one picked.
//
// A page outside any guest gets no device, and Web Bluetooth's scanning
// prompt is refused, as before.
//
// Called once from StartDesk, before any guest exists.
void UseTheShellForDeviceChoosers();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_CHOOSER_H_
