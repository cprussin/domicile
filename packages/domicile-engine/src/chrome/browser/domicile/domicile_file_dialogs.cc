// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_file_dialogs.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/task/single_thread_task_runner.h"
#include "components/domicile/browser/file_choice.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "content/public/browser/web_contents.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_dialog_factory.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"

namespace domicile {
namespace {

// Returns the <webview> guest that is or contains `contents`.
//
// Walks outer WebContents because an inner one, such as the PDF viewer's
// MimeHandlerViewGuest, is attached to the guest rather than part of it.
WebViewGuest* GuestAround(content::WebContents* contents) {
  for (; contents != nullptr; contents = contents->GetOuterWebContents()) {
    if (WebViewGuest* guest = WebViewGuest::FromWebContents(contents)) {
      return guest;
    }
  }
  return nullptr;
}

// A file dialog answered by the shell. See UseTheShellForFileDialogs.
class ShellFileDialog : public ui::SelectFileDialog {
 public:
  ShellFileDialog(Listener* listener,
                  std::unique_ptr<ui::SelectFilePolicy> policy)
      : ui::SelectFileDialog(listener, std::move(policy)) {}

  // ui::BaseShellDialog:
  bool IsRunning(gfx::NativeWindow owning_window) const override {
    return asking_;
  }
  void ListenerDestroyed() override { listener_ = nullptr; }

 protected:
  // ui::SelectFileDialog:
  void SelectFileImpl(Type type,
                      const std::u16string& title,
                      const base::FilePath& default_path,
                      const FileTypeInfo* file_types,
                      int file_type_index,
                      const base::FilePath::StringType& default_extension,
                      gfx::NativeWindow owning_window,
                      const GURL* caller) override {
    const mojom::WebViewFileChooserMode mode = ModeForDialog(type);
    // Without a policy there is no source page, so treat it as in no
    // <webview>.
    WebViewGuest* guest =
        GuestAround(select_file_policy() == nullptr
                        ? nullptr
                        : select_file_policy()->GetSourceContents());
    if (guest == nullptr) {
      LOG(WARNING) << "domicile: refused a file dialog for a page in no "
                      "<webview>; a desk draws no dialog of its own.";
      // Post so the listener hears after SelectFile returns, as Chromium's
      // own refusal in SelectFileDialog::SelectFile does.
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(&ShellFileDialog::Answered, base::WrapRefCounted(this),
                         mode, std::nullopt));
      return;
    }
    // Logged before asking so it appears even if the shell never answers.
    // The save-picker guard greps for it.
    LOG(INFO) << "domicile: a file dialog asked the shell instead of drawing.";
    asking_ = true;
    guest->ChooseFiles(mode, DialogExtensions(file_types), default_path,
                       base::BindOnce(&ShellFileDialog::Answered,
                                      base::WrapRefCounted(this), mode));
  }
  bool HasMultipleFileTypeChoicesImpl() override { return false; }

 private:
  ~ShellFileDialog() override = default;

  void Answered(mojom::WebViewFileChooserMode mode,
                std::optional<std::vector<base::FilePath>> paths) {
    asking_ = false;
    // The caller is gone, for example a page closed with its picker open.
    if (listener_ == nullptr) {
      return;
    }
    if (!paths.has_value()) {
      listener_->FileSelectionCanceled();
      return;
    }
    if (mode == mojom::WebViewFileChooserMode::kOpenMultiple) {
      std::vector<ui::SelectedFileInfo> files;
      for (const base::FilePath& path : *paths) {
        files.emplace_back(path);
      }
      listener_->MultiFilesSelected(files);
      return;
    }
    listener_->FileSelected(ui::SelectedFileInfo(paths->front()), 0);
  }

  bool asking_ = false;
};

class ShellFileDialogs : public ui::SelectFileDialogFactory {
 public:
  ui::SelectFileDialog* Create(
      ui::SelectFileDialog::Listener* listener,
      std::unique_ptr<ui::SelectFilePolicy> policy) override {
    return new ShellFileDialog(listener, std::move(policy));
  }
};

}  // namespace

void UseTheShellForFileDialogs() {
  ui::SelectFileDialog::SetFactory(std::make_unique<ShellFileDialogs>());
}

}  // namespace domicile
