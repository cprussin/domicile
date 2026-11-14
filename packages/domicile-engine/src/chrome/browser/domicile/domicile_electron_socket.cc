// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_electron_socket.h"

#include <unistd.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/callback_list.h"
#include "base/check.h"
#include "base/check_op.h"
#include "base/command_line.h"
#include "base/containers/circular_deque.h"
#include "base/containers/flat_set.h"
#include "base/containers/unique_ptr_adapters.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/task/bind_post_task.h"
#include "base/threading/sequence_bound.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "components/domicile/browser/browser_window_listing.h"
#include "components/domicile/browser/electron_app.h"
#include "components/domicile/browser/electron_protocol.h"
#include "components/domicile/browser/line_framer.h"
#include "components/domicile/common/domicile_scheme.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// Apps dial at login together, so let several wait.
constexpr int kBacklog = 16;

constexpr int kReadBufferSize = 16 * 1024;

// Accepts only peers running as this user. The socket's directory already
// limits access; this is a second check.
bool ConnectedByUs(const net::UnixDomainServerSocket::Credentials& peer) {
  return peer.user_id == getuid();
}

// The desk as an Electron app sees it: the shell profile's browser windows.
class ChromeElectronDesk final : public ElectronDesk {
 public:
  std::optional<std::string> Open(const GURL& url,
                                  const ElectronHello& hello,
                                  const std::string& preload,
                                  ElectronPageCalls calls) override {
    return OpenElectronWindow(url, hello.app_id, hello.partition, preload,
                              std::move(calls));
  }
  void Load(const std::string& id, const GURL& url) override {
    LoadBrowserWindow(id, url);
  }
  void Focus(const std::string& id) override { FocusBrowserWindow(id); }
  void AskToClose(const std::string& id) override {
    AskToCloseBrowserWindow(id);
  }
  void Close(const std::string& id) override { CloseBrowserWindow(id); }
  void SendToPage(const std::string& id,
                  const std::string& channel,
                  const std::string& args_json) override {
    SendToElectronWindow(id, channel, args_json);
  }
};

// One app on the UI thread: its ElectronApp, told of the desk's windows.
class AppOnUIThread {
 public:
  explicit AppOnUIThread(ElectronApp::Send send)
      : app_(desk_, std::move(send)),
        listing_(WatchBrowserWindowListing(
            base::BindRepeating(&AppOnUIThread::Listed,
                                base::Unretained(this)))),
        loads_(WatchBrowserWindowLoads(
            base::BindRepeating(&ElectronApp::Loaded,
                                base::Unretained(&app_)))) {
    CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  }

  void Take(const std::string& line) { app_.Take(line); }

 private:
  void Listed() { app_.Listed(ListedBrowserWindows()); }

  ChromeElectronDesk desk_;
  ElectronApp app_;
  base::CallbackListSubscription listing_;
  base::CallbackListSubscription loads_;
};

// One connection on the IO thread: reads its lines, writes its events, and
// keeps its app on the UI thread for as long as it is open.
class Connection {
 public:
  Connection(std::unique_ptr<net::StreamSocket> socket,
             base::OnceCallback<void(Connection*)> closed)
      : socket_(std::move(socket)),
        closed_(std::move(closed)),
        read_buffer_(
            base::MakeRefCounted<net::IOBufferWithSize>(kReadBufferSize)) {
    app_ = base::SequenceBound<AppOnUIThread>(
        content::GetUIThreadTaskRunner({}),
        base::BindPostTask(content::GetIOThreadTaskRunner({}),
                           base::BindRepeating(&Connection::Send,
                                               weak_factory_.GetWeakPtr())));
  }
  Connection(const Connection&) = delete;
  Connection& operator=(const Connection&) = delete;
  // Destroys its app on the UI thread, which closes the app's windows.
  ~Connection() = default;

  // Starts reading. Not in the constructor: a read that ends at once closes
  // the connection, which its socket must own by then.
  void Start() { Read(); }

 private:
  void Read() {
    const int result = socket_->Read(
        read_buffer_.get(), kReadBufferSize,
        base::BindOnce(&Connection::OnRead, weak_factory_.GetWeakPtr()));
    if (result != net::ERR_IO_PENDING) {
      OnRead(result);
    }
  }

  void OnRead(int result) {
    if (result <= 0) {
      // The app's main process ended, or its socket failed.
      if (result < 0) {
        LOG(ERROR) << "domicile: lost an Electron app: "
                   << net::ErrorToString(result);
      }
      Close();
      return;
    }
    for (std::string& line : framer_.Take(std::string_view(
             read_buffer_->data(), static_cast<size_t>(result)))) {
      app_.AsyncCall(&AppOnUIThread::Take).WithArgs(std::move(line));
    }
    Read();
  }

  void Send(std::string line) {
    pending_.push_back(std::move(line));
    if (!writing_) {
      Write();
    }
  }

  void Write() {
    if (pending_.empty()) {
      writing_ = false;
      return;
    }
    writing_ = true;
    std::string line = std::move(pending_.front());
    pending_.pop_front();
    const size_t size = line.size();
    auto buffer = base::MakeRefCounted<net::DrainableIOBuffer>(
        base::MakeRefCounted<net::StringIOBuffer>(std::move(line)), size);
    WriteSome(std::move(buffer));
  }

  void WriteSome(scoped_refptr<net::DrainableIOBuffer> buffer) {
    const int result =
        socket_->Write(buffer.get(), buffer->BytesRemaining(),
                       base::BindOnce(&Connection::OnWrite,
                                      weak_factory_.GetWeakPtr(), buffer),
                       MISSING_TRAFFIC_ANNOTATION);
    if (result != net::ERR_IO_PENDING) {
      OnWrite(std::move(buffer), result);
    }
  }

  void OnWrite(scoped_refptr<net::DrainableIOBuffer> buffer, int result) {
    if (result < 0) {
      LOG(ERROR) << "domicile: could not write to an Electron app: "
                 << net::ErrorToString(result);
      Close();
      return;
    }
    buffer->DidConsume(result);
    if (buffer->BytesRemaining() > 0) {
      WriteSome(std::move(buffer));
    } else {
      Write();
    }
  }

  // Ends this connection. Destroys it, so nothing may follow.
  void Close() { std::move(closed_).Run(this); }

  std::unique_ptr<net::StreamSocket> socket_;
  base::OnceCallback<void(Connection*)> closed_;
  scoped_refptr<net::IOBufferWithSize> read_buffer_;
  LineFramer framer_;
  base::circular_deque<std::string> pending_;
  bool writing_ = false;
  base::SequenceBound<AppOnUIThread> app_;
  base::WeakPtrFactory<Connection> weak_factory_{this};
};

// The listening socket and its open connections, on the IO thread.
class ElectronSocket {
 public:
  ElectronSocket()
      : listener_(base::BindRepeating(&ConnectedByUs),
                  /*use_abstract_namespace=*/false) {}
  ElectronSocket(const ElectronSocket&) = delete;
  ElectronSocket& operator=(const ElectronSocket&) = delete;

  void Listen(const std::string& path) {
    CHECK_CURRENTLY_ON(content::BrowserThread::IO);
    const int result = listener_.BindAndListen(path, kBacklog);
    CHECK_EQ(result, net::OK) << "domicile: could not listen on " << path
                              << ": " << net::ErrorToString(result);
    LOG(INFO) << "domicile: taking Electron apps on " << path;
    Accept();
  }

 private:
  void Accept() {
    const int result = listener_.Accept(
        &accepted_,
        base::BindOnce(&ElectronSocket::OnAccept, base::Unretained(this)));
    if (result != net::ERR_IO_PENDING) {
      OnAccept(result);
    }
  }

  void OnAccept(int result) {
    if (result != net::OK) {
      LOG(ERROR) << "domicile: the Electron socket stopped accepting: "
                 << net::ErrorToString(result)
                 << ". No further Electron apps will open.";
      return;
    }
    auto connection = std::make_unique<Connection>(
        std::move(accepted_),
        base::BindOnce(&ElectronSocket::Closed, base::Unretained(this)));
    Connection& started = *connection;
    connections_.insert(std::move(connection));
    started.Start();
    Accept();
  }

  void Closed(Connection* connection) {
    connections_.erase(connections_.find(connection));
  }

  net::UnixDomainServerSocket listener_;
  std::unique_ptr<net::StreamSocket> accepted_;
  base::flat_set<std::unique_ptr<Connection>, base::UniquePtrComparator>
      connections_;
};

void ListenOnIOThread(const std::string& path) {
  static base::NoDestructor<ElectronSocket> socket;
  socket->Listen(path);
}

}  // namespace

void StartElectronSocket() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  if (!command_line.HasSwitch(kDomicileElectronSocketSwitch)) {
    return;
  }
  content::GetIOThreadTaskRunner({})->PostTask(
      FROM_HERE,
      base::BindOnce(&ListenOnIOThread, command_line.GetSwitchValueASCII(
                                            kDomicileElectronSocketSwitch)));
}

}  // namespace domicile
