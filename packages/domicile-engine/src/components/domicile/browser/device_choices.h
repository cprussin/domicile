// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DEVICE_CHOICES_H_
#define COMPONENTS_DOMICILE_BROWSER_DEVICE_CHOICES_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

namespace domicile {

// Ids for the devices a chooser offers the shell.
//
// Chrome's ChooserController numbers its devices by index, and an index moves
// when a device before it is unplugged. The shell answers with ids from the
// last list it was sent, so each device gets an id that stays its own until it
// is removed, and is never reused. See DevicesOffered in
// components/domicile/mojom/web_view_guest.mojom.
//
// Mirrors ChooserController::View: call each method from the matching
// notification.
class DeviceChoices {
 public:
  DeviceChoices();
  DeviceChoices(const DeviceChoices&) = delete;
  DeviceChoices& operator=(const DeviceChoices&) = delete;
  ~DeviceChoices();

  // The controller listed `count` devices, replacing any before.
  void Listed(size_t count);
  // A device was inserted at `index`.
  void Added(size_t index);
  // The device at `index` was removed; later ones moved down by one.
  void Removed(size_t index);

  // Each device's id, in the controller's order.
  const std::vector<int32_t>& ids() const { return ids_; }

  // The current indices of the devices `chosen` names, in the controller's
  // order. Devices removed since the shell was sent them are left out, so the
  // result can be empty.
  //
  // Nothing when `chosen` is not an answer: empty, more than one when not
  // `multiple`, an id twice, or an id never given. The element rejects each of
  // these, so one arriving here is a bad message.
  std::optional<std::vector<size_t>> IndicesOf(
      const std::vector<int32_t>& chosen,
      bool multiple) const;

 private:
  std::vector<int32_t> ids_;
  // The id the next device gets. Ids start at 1.
  int32_t next_id_ = 1;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DEVICE_CHOICES_H_
