// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_DETAILS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_DETAILS_H_

namespace content {
class WebContents;
}  // namespace content

namespace domicile {

// Hides the device's details from each website page `guest` commits, in a
// profile that hides them (`protections.hide_device_details`) and where its
// page's protections are on (its ad blocking isn't Off): sends each frame,
// before it commits, a seed for its page's top site, which Blink farbles
// what the page reads of the device with (DeviceDetailsAgent in the
// renderer). The seed is the site's for the profile's session: a key made
// at random when the profile first needs one, never kept, and the site, so
// a site sees the same each visit until the desktop starts again, and two
// sites, or two profiles, never see the same. Not an Electron app's pages.
// From AttachTabHelpers. See docs/architecture/AD-BLOCKING.md.
void AttachDeviceDetailsHiding(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DEVICE_DETAILS_H_
