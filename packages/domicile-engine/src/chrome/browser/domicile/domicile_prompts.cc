// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_prompts.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/logging.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/bluetooth/chrome_bluetooth_delegate_impl_client.h"
#include "chrome/browser/extensions/extension_install_prompt.h"
#include "chrome/browser/extensions/extension_install_prompt_show_params.h"
#include "chrome/browser/file_system_access/chrome_file_system_access_permission_context.h"
#include "chrome/browser/ssl/ssl_client_certificate_selector.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/permissions/permission_uma_constants.h"
#include "content/public/browser/bluetooth_delegate.h"
#include "content/public/browser/client_certificate_delegate.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/install_prompt_data.h"
#include "extensions/common/extension.h"
#include "net/cert/x509_certificate.h"
#include "net/ssl/client_cert_identity.h"
#include "net/ssl/ssl_cert_request_info.h"
#include "net/ssl/ssl_private_key.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {
namespace {

using Kind = mojom::WebViewPromptKind;
using FileContext = ChromeFileSystemAccessPermissionContext;
using SensitiveEntryResult = FileContext::SensitiveEntryResult;

mojom::WebViewPromptPtr MakePrompt(Kind kind,
                                   const GURL& origin,
                                   std::string subject,
                                   std::vector<std::string> details = {},
                                   std::string pin = {}) {
  auto prompt = mojom::WebViewPrompt::New();
  prompt->kind = kind;
  prompt->origin = origin;
  prompt->subject = std::move(subject);
  prompt->details = std::move(details);
  prompt->pin = std::move(pin);
  return prompt;
}

// The guest `web_contents` shows, or null (logged) for a page outside any.
WebViewGuest* GuestFor(content::WebContents* web_contents, Kind kind) {
  WebViewGuest* guest =
      web_contents ? WebViewGuest::FromWebContents(web_contents) : nullptr;
  if (!guest) {
    LOG(WARNING) << "domicile: a page outside any <webview> needs an answer "
                    "to a "
                 << kind << " prompt; it is refused.";
  }
  return guest;
}

// File System Access ----------------------------------------------------------

void AskFileAccess(
    content::WebContents* web_contents,
    const url::Origin& origin,
    const base::FilePath& path,
    FileContext::HandleType handle_type,
    bool write,
    base::OnceCallback<void(permissions::PermissionAction)> callback) {
  const Kind kind = write ? Kind::kFileEdit : Kind::kFileView;
  WebViewGuest* guest = GuestFor(web_contents, kind);
  if (!guest) {
    std::move(callback).Run(permissions::PermissionAction::DISMISSED);
    return;
  }
  guest->AskPrompt(
      MakePrompt(kind, origin.GetURL(), path.BaseName().AsUTF8Unsafe(),
                 {path.AsUTF8Unsafe()}),
      base::BindOnce(
          [](base::OnceCallback<void(permissions::PermissionAction)> callback,
             bool accepted, int, std::string) {
            std::move(callback).Run(
                accepted ? permissions::PermissionAction::GRANTED
                         : permissions::PermissionAction::DENIED);
          },
          std::move(callback)));
}

void AskRestrictedFolder(
    content::WebContents* web_contents,
    const url::Origin& origin,
    FileContext::HandleType handle_type,
    base::OnceCallback<void(SensitiveEntryResult)> callback) {
  WebViewGuest* guest = GuestFor(web_contents, Kind::kFileRestricted);
  if (!guest) {
    std::move(callback).Run(SensitiveEntryResult::kAbort);
    return;
  }
  guest->AskPrompt(
      MakePrompt(Kind::kFileRestricted, origin.GetURL(), std::string()),
      base::BindOnce(
          [](base::OnceCallback<void(SensitiveEntryResult)> callback,
             bool accepted, int, std::string) {
            std::move(callback).Run(accepted ? SensitiveEntryResult::kTryAgain
                                             : SensitiveEntryResult::kAbort);
          },
          std::move(callback)));
}

void AskDangerousFile(content::WebContents* web_contents,
                      const url::Origin& origin,
                      const base::FilePath& path,
                      base::OnceCallback<void(SensitiveEntryResult)> callback) {
  WebViewGuest* guest = GuestFor(web_contents, Kind::kFileDangerous);
  if (!guest) {
    std::move(callback).Run(SensitiveEntryResult::kAbort);
    return;
  }
  guest->AskPrompt(
      MakePrompt(Kind::kFileDangerous, origin.GetURL(),
                 path.BaseName().AsUTF8Unsafe(), {path.AsUTF8Unsafe()}),
      base::BindOnce(
          [](base::OnceCallback<void(SensitiveEntryResult)> callback,
             bool accepted, int, std::string) {
            std::move(callback).Run(accepted ? SensitiveEntryResult::kAllowed
                                             : SensitiveEntryResult::kAbort);
          },
          std::move(callback)));
}

// Client certificates ---------------------------------------------------------

// One certificate request: what Chrome handed over, until it is answered or
// Chrome cancels it.
struct CertificateAsk {
  net::ClientCertIdentityList certs;
  // Null once Chrome canceled the request: then nothing is continued.
  std::unique_ptr<content::ClientCertificateDelegate> delegate;
  base::WeakPtrFactory<CertificateAsk> weak_factory{this};
};

void CertificateAnswered(std::unique_ptr<CertificateAsk> ask,
                         bool accepted,
                         int choice,
                         std::string) {
  if (!ask->delegate) {
    return;
  }
  if (!accepted || choice < 0 ||
      static_cast<size_t>(choice) >= ask->certs.size()) {
    // Continues without one, as Chrome's dialog's Cancel does.
    ask->delegate->ContinueWithCertificate(nullptr, nullptr);
    return;
  }
  std::unique_ptr<net::ClientCertIdentity> identity =
      std::move(ask->certs[choice]);
  scoped_refptr<net::X509Certificate> cert = identity->certificate();
  std::unique_ptr<content::ClientCertificateDelegate> delegate =
      std::move(ask->delegate);
  net::ClientCertIdentity::SelfOwningAcquirePrivateKey(
      std::move(identity),
      base::BindOnce(
          [](std::unique_ptr<content::ClientCertificateDelegate> delegate,
             scoped_refptr<net::X509Certificate> cert,
             scoped_refptr<net::SSLPrivateKey> key) {
            delegate->ContinueWithCertificate(std::move(cert), std::move(key));
          },
          std::move(delegate), std::move(cert)));
}

// Chrome's ShowSSLClientCertificateSelector hook. Returns what cancels it.
base::OnceClosure AskForCertificate(
    content::WebContents* web_contents,
    net::SSLCertRequestInfo* cert_request_info,
    net::ClientCertIdentityList client_certs,
    std::unique_ptr<content::ClientCertificateDelegate> delegate) {
  // As in Chrome: with none to pick, continue without one.
  if (client_certs.empty()) {
    delegate->ContinueWithCertificate(nullptr, nullptr);
    return base::OnceClosure();
  }
  WebViewGuest* guest = GuestFor(web_contents, Kind::kClientCertificate);
  if (!guest) {
    // Dropped unanswered, as Chrome does where it cannot show its dialog.
    return base::OnceClosure();
  }
  std::vector<std::string> details;
  for (const auto& identity : client_certs) {
    const net::X509Certificate* cert = identity->certificate();
    details.push_back(base::StrCat({cert->subject().GetDisplayName(), "\n",
                                    cert->issuer().GetDisplayName()}));
  }
  auto ask = std::make_unique<CertificateAsk>();
  ask->certs = std::move(client_certs);
  ask->delegate = std::move(delegate);
  base::WeakPtr<CertificateAsk> weak_ask = ask->weak_factory.GetWeakPtr();
  const int id = guest->AskPrompt(
      MakePrompt(Kind::kClientCertificate,
                 GURL(base::StrCat(
                     {"https://",
                      cert_request_info->host_and_port.ToString()})),
                 std::string(), std::move(details)),
      base::BindOnce(&CertificateAnswered, std::move(ask)));
  return base::BindOnce(
      [](base::WeakPtr<WebViewGuest> guest, int id,
         base::WeakPtr<CertificateAsk> ask) {
        if (ask) {
          ask->delegate.reset();
        }
        if (guest) {
          guest->WithdrawPrompt(id);
        }
      },
      guest->GetWeakPtr(), id, weak_ask);
}

// Bluetooth -------------------------------------------------------------------

void AskToPair(content::RenderFrameHost* frame,
               const std::u16string& device_identifier,
               content::BluetoothDelegate::PairPromptCallback callback,
               content::BluetoothDelegate::PairingKind pairing_kind,
               const std::optional<std::u16string>& pin) {
  using PairingKind = content::BluetoothDelegate::PairingKind;
  using Result = content::BluetoothDelegate::PairPromptResult;
  using Status = content::BluetoothDelegate::PairPromptStatus;
  Kind kind;
  switch (pairing_kind) {
    case PairingKind::kProvidePin:
      kind = Kind::kBluetoothPin;
      break;
    case PairingKind::kConfirmOnly:
    case PairingKind::kConfirmPinMatch:
      kind = Kind::kBluetoothConfirm;
      break;
    default:
      // Chrome asks for no other kind.
      std::move(callback).Run(Result(Status::kCancelled));
      return;
  }
  WebViewGuest* guest =
      GuestFor(content::WebContents::FromRenderFrameHost(frame), kind);
  if (!guest) {
    std::move(callback).Run(Result(Status::kCancelled));
    return;
  }
  guest->AskPrompt(
      MakePrompt(kind, frame->GetLastCommittedOrigin().GetURL(),
                 base::UTF16ToUTF8(device_identifier), {},
                 pin ? base::UTF16ToUTF8(*pin) : std::string()),
      base::BindOnce(
          [](content::BluetoothDelegate::PairPromptCallback callback,
             bool accepted, int, std::string text) {
            Result result(accepted ? Status::kSuccess : Status::kCancelled);
            if (accepted) {
              result.pin = std::move(text);
            }
            std::move(callback).Run(result);
          },
          std::move(callback)));
}

// Extensions ------------------------------------------------------------------

// Chrome's ExtensionInstallPrompt default ShowDialogCallback.
void AskAboutExtension(
    std::unique_ptr<ExtensionInstallPromptShowParams> show_params,
    ExtensionInstallPrompt::DoneCallback done,
    std::unique_ptr<extensions::InstallPromptData> prompt) {
  using Payload = ExtensionInstallPrompt::DoneCallbackPayload;
  using Result = ExtensionInstallPrompt::Result;
  using Type = extensions::InstallPromptData::PromptType;
  std::optional<Kind> kind;
  switch (prompt->type()) {
    case Type::INSTALL_PROMPT:
    case Type::EXTERNAL_INSTALL_PROMPT:
    case Type::REMOTE_INSTALL_PROMPT:
    case Type::REPAIR_PROMPT:
      kind = Kind::kExtensionInstall;
      break;
    case Type::RE_ENABLE_PROMPT:
      kind = Kind::kExtensionReEnable;
      break;
    case Type::PERMISSIONS_PROMPT:
      kind = Kind::kExtensionPermissions;
      break;
    default:
      break;
  }
  if (!kind || !prompt->extension()) {
    LOG(WARNING) << "domicile: an extension prompt of type " << prompt->type()
                 << " has no shell prompt; it is refused.";
    std::move(done).Run(Payload(Result::ABORTED));
    return;
  }
  content::WebContents* web_contents = show_params->GetParentWebContents();
  WebViewGuest* guest = GuestFor(web_contents, *kind);
  if (!guest) {
    std::move(done).Run(Payload(Result::ABORTED));
    return;
  }
  std::vector<std::string> details;
  for (size_t i = 0; i < prompt->GetPermissionCount(); ++i) {
    details.push_back(base::UTF16ToUTF8(prompt->GetPermission(i)));
  }
  guest->AskPrompt(
      MakePrompt(*kind,
                 web_contents->GetPrimaryMainFrame()
                     ->GetLastCommittedOrigin()
                     .GetURL(),
                 prompt->extension()->name(), std::move(details)),
      base::BindOnce(
          [](ExtensionInstallPrompt::DoneCallback done, bool accepted, int,
             std::string) {
            std::move(done).Run(Payload(accepted ? Result::ACCEPTED
                                                 : Result::USER_CANCELED));
          },
          std::move(done)));
}

}  // namespace

void UseTheShellForPrompts() {
  FileContext::DomicilePrompts files;
  files.ask_access = &AskFileAccess;
  files.ask_restricted = &AskRestrictedFolder;
  files.ask_dangerous = &AskDangerousFile;
  FileContext::SetDomicilePrompts(files);
  SetShowSSLClientCertificateSelectorHookForTest(
      base::BindRepeating(&AskForCertificate));
  ChromeBluetoothDelegateImplClient::SetPairPromptOverride(&AskToPair);
  ExtensionInstallPrompt::SetDefaultShowDialogOverride(
      base::BindRepeating(&AskAboutExtension));
}

}  // namespace domicile
