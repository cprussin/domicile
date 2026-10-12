// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/guest_dialogs.h"

#include <utility>

#include "base/functional/bind.h"

namespace domicile {

GuestDialogs::GuestDialogs() = default;

GuestDialogs::~GuestDialogs() = default;

bool GuestDialogs::Open(Closed closed, Show show) {
  if (open_) {
    return false;
  }
  open_ = std::move(closed);
  ++open_id_;
  std::move(show).Run(base::BindOnce(&GuestDialogs::Answered,
                                     weak_factory_.GetWeakPtr(), open_id_));
  return true;
}

bool GuestDialogs::Cancel() {
  if (!open_) {
    return false;
  }
  std::move(open_).Run(false, std::u16string());
  return true;
}

void GuestDialogs::Answered(int id,
                            bool accepted,
                            const std::u16string& user_input) {
  if (id == open_id_ && open_) {
    std::move(open_).Run(accepted, user_input);
  }
}

}  // namespace domicile
