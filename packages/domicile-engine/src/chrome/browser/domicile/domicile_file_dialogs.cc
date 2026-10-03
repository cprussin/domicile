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

// The <webview> guest `contents` is, or is inside.
//
// INSIDE as well as is: a page's own frames are the guest's WebContents, but
// an inner WebContents -- a MimeHandlerViewGuest, which is how the PDF viewer
// is embedded where it is not an out-of-process frame -- is a WebContents of
// its own, attached to the guest's.
WebViewGuest* GuestAround(content::WebContents* contents) {
  for (; contents != nullptr; contents = contents->GetOuterWebContents()) {
    if (WebViewGuest* guest = WebViewGuest::FromWebContents(contents)) {
      return guest;
    }
  }
  return nullptr;
}

// A file dialog as a question to the shell. See UseTheShellForFileDialogs.
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
    // No policy is a dialog nobody said a page for, which is a dialog for no
    // <webview> as surely as one for the shell's own page.
    WebViewGuest* guest =
        GuestAround(select_file_policy() == nullptr
                        ? nullptr
                        : select_file_policy()->GetSourceContents());
    if (guest == nullptr) {
      LOG(WARNING) << "domicile: refused a file dialog for a page in no "
                      "<webview>; a desk draws no dialog of its own.";
      // Posted: a listener is told after SelectFile returns, as Chromium's
      // own refusal in SelectFileDialog::SelectFile tells it.
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(&ShellFileDialog::Answered, base::WrapRefCounted(this),
                         mode, std::nullopt));
      return;
    }
    // Before the ask, so the line means "the shell was asked" whether or not
    // it answers. The save-picker guard greps for it.
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
    // The caller went away while the shell was deciding -- a page closed with
    // its picker open -- and there is nobody left to tell.
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
