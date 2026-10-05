// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_command_socket.h"

#include <unistd.h>

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/check_op.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/no_destructor.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/bind_post_task.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/types/expected.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/domicile/browser/command_protocol.h"
#include "components/domicile/browser/shell_source.h"
#include "components/domicile/common/domicile_scheme.h"
#include "components/tabs/public/tab_interface.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// One at a time is what this is: a command is typed, answered and over. The
// backlog is what a second `domicile load-shell` racing the first waits in
// rather than being refused by the kernel.
constexpr int kBacklog = 4;

constexpr int kReadBufferSize = 4 * 1024;

// A request is a path and a filename. Anything past this is not one, and a
// peer that never sends a newline must not be able to grow this process's
// heap by holding a socket open.
constexpr size_t kMaxRequestSize = 64 * 1024;

// How long viz may take to read the desk back. Under the supervisor's wait
// for the engine, so a timeout here reaches the terminal as this engine's
// refusal.
constexpr base::TimeDelta kCaptureTimeout = base::Seconds(5);

// Whoever can open the path may command the desktop, and this is the belt to
// that brace: the socket lives in the supervisor's own runtime directory, and
// this says in one line that a process running as somebody else is not the
// supervisor even if it gets there.
bool ConnectedByUs(const net::UnixDomainServerSocket::Credentials& peer) {
  return peer.user_id == getuid();
}

// The shell's window, or null when this browser has none.
//
// By scheme rather than by counting windows: a desktop's shell is the page
// served over domicile://, and a `<webview>` guest is not a window of its own,
// so this names the thing it means. In creation order, so the answer does not
// depend on which window the user touched last.
content::WebContents* FindShellContents() {
  content::WebContents* shell = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&shell](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab != nullptr &&
            tab->GetContents()->GetLastCommittedURL().SchemeIs(
                kDomicileScheme)) {
          shell = tab->GetContents();
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return shell;
}

// Serve this shell from now on, and put it on the screen.
//
// The source first and the navigation second, because the navigation is what
// reads the source: ShellURLLoaderFactory is rebuilt per navigation by the
// embedder and `ServeDocument` reads the module per request, so the document
// this reload gets is written against the shell that was just set.
//
// BYPASSING_CACHE, and that is the case this exists for rather than
// fastidiousness. A rebuilt shell is the same URL -- `domicile://shell/` and
// the `shell.js` under it -- with different bytes behind it, which is exactly
// the shape a cache is entitled to answer from memory.
bool LoadShellIntoTheShellWindow(const base::FilePath& root,
                                 const std::string& module) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  content::WebContents* shell = FindShellContents();
  if (shell == nullptr) {
    return false;
  }

  ShellSource::Get().Set(root, module);
  shell->GetController().Reload(content::ReloadType::BYPASSING_CACHE,
                                /*check_for_repost=*/false);
  LOG(INFO) << "domicile: now serving " << module << " out of " << root;
  return true;
}

// Opens a browser window at `url`, as for a page's target="_blank". The shell
// sees it in its window list. See domicile_browser_windows.h.
bool OpenUrlInABrowserWindow(const GURL& url) {
  return OpenBrowserWindow(url);
}

// Encodes `desk` and writes it to `file`. Blocking, so on the thread pool.
base::expected<void, std::string> WritePng(const base::FilePath& file,
                                           const SkBitmap& desk) {
  const std::optional<std::vector<uint8_t>> png =
      gfx::PNGCodec::EncodeBGRASkBitmap(desk, /*discard_transparency=*/true);
  if (!png) {
    return base::unexpected("the desk could not be encoded as a PNG");
  }
  if (!base::WriteFile(file, *png)) {
    return base::unexpected(
        base::StrCat({"could not write ", file.AsUTF8Unsafe()}));
  }
  return base::ok();
}

void OnDeskCopied(const base::FilePath& file,
                  ScreenshotDone done,
                  const content::CopyFromSurfaceResult& copied) {
  if (!copied.has_value()) {
    std::move(done).Run(base::unexpected(base::StrCat(
        {"the display compositor did not read the desk back (",
         "content::CopyFromSurfaceError ",
         base::NumberToString(static_cast<int>(copied.error())), ")"})));
    return;
  }
  // `done` ends in a reply bound to the IO thread, so it may run here.
  base::ThreadPool::PostTask(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(
          [](const base::FilePath& file, const SkBitmap& desk,
             ScreenshotDone done) {
            std::move(done).Run(WritePng(file, desk));
          },
          file, copied->bitmap, std::move(done)));
}

// Writes a PNG of the shell page to `file`.
//
// The page is the whole desk: on a tty it spans every monitor
// (docs/architecture/ONE-PAGE-FOR-THE-DESK.md), and a copy of its surface is
// aggregated with every `<app>` embedded in it. It is copied at the page's
// own scale, unrotated.
void ScreenshotTheDesk(const base::FilePath& file, ScreenshotDone done) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  content::WebContents* shell = FindShellContents();
  content::RenderWidgetHostView* view =
      shell == nullptr ? nullptr : shell->GetRenderWidgetHostView();
  if (view == nullptr) {
    std::move(done).Run(
        base::unexpected("this engine has no shell page to capture"));
    return;
  }
  view->CopyFromSurface(gfx::Rect(), gfx::Size(), kCaptureTimeout,
                        base::BindOnce(&OnDeskCopied, file, std::move(done)));
}

// One request line, answered from the UI thread.
//
// THE HOP IS HERE BECAUSE THE SEQUENCE IS. `ShellSource` takes no lock: it is
// read where the shell's URLLoaderFactory is built and asked, which is the UI
// thread, and applying a shell has to navigate a window, which is the UI
// thread's too. So whatever carries a command in is what posts -- and this
// posts the line rather than the parse, which costs a JSON read of one short
// line on the UI thread and buys one function that is the whole protocol.
// `reply` is bound to the IO thread, so a screenshot may answer from any.
void AnswerOnUIThread(const std::string& line, CommandReply reply) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  AnswerCommand(line, &LoadShellIntoTheShellWindow, &OpenUrlInABrowserWindow,
                &ScreenshotTheDesk, std::move(reply));
}

// The socket the supervisor dials, on the browser's IO thread.
//
// One connection at a time, because one connection is one request: a second
// client waits in the backlog rather than interleaving with the first. Built
// once and never torn down -- a desktop that stopped taking commands halfway
// through its life would be a state nothing here can report.
class CommandSocket {
 public:
  CommandSocket()
      : listener_(base::BindRepeating(&ConnectedByUs),
                  /*use_abstract_namespace=*/false),
        read_buffer_(
            base::MakeRefCounted<net::IOBufferWithSize>(kReadBufferSize)) {}

  CommandSocket(const CommandSocket&) = delete;
  CommandSocket& operator=(const CommandSocket&) = delete;

  ~CommandSocket() = default;

  void Listen(const std::string& path) {
    CHECK_CURRENTLY_ON(content::BrowserThread::IO);
    // Loudly, rather than logging and carrying on. --domicile-command-socket
    // is explicit: somebody asked for a socket at this path, and a desktop
    // that quietly has not got one looks from the outside exactly like a
    // `load-shell` that did nothing, which is the wrong thing to go and debug.
    // A leftover file from a dead engine lands here too -- the path belongs to
    // the supervisor, which makes a fresh one per run.
    const int result = listener_.BindAndListen(path, kBacklog);
    CHECK_EQ(result, net::OK)
        << "domicile: could not listen on " << path << ": "
        << net::ErrorToString(result);
    LOG(INFO) << "domicile: taking commands on " << path;
    Accept();
  }

 private:
  void Accept() {
    const int result = listener_.Accept(
        &connection_,
        base::BindOnce(&CommandSocket::OnAccept, base::Unretained(this)));
    if (result != net::ERR_IO_PENDING) {
      OnAccept(result);
    }
  }

  void OnAccept(int result) {
    if (result != net::OK) {
      // Not a retry, and that is deliberate. `Accept` fails here only when the
      // listener itself is broken, and an error that repeats synchronously
      // would spin this thread for the life of the browser -- which is worse
      // than a socket that says, once, that it has stopped.
      LOG(ERROR) << "domicile: the command socket stopped accepting: "
                 << net::ErrorToString(result)
                 << ". This desktop will not take further commands.";
      return;
    }
    request_.clear();
    Read();
  }

  void Read() {
    const int result = connection_->Read(
        read_buffer_.get(), kReadBufferSize,
        base::BindOnce(&CommandSocket::OnRead, base::Unretained(this)));
    if (result != net::ERR_IO_PENDING) {
      OnRead(result);
    }
  }

  void OnRead(int result) {
    if (result <= 0) {
      // Zero is the peer closing before it finished a line. There is nothing
      // to answer and nobody to answer to.
      Close();
      return;
    }

    request_.append(read_buffer_->data(), static_cast<size_t>(result));

    const size_t newline = request_.find('\n');
    if (newline == std::string::npos) {
      if (request_.size() > kMaxRequestSize) {
        Reply(RefusedCommand(
            "a request is one line of JSON, and this one has not ended"));
        return;
      }
      Read();
      return;
    }

    // ONE CONNECTION IS ONE REQUEST, so whatever follows the first newline is
    // not a second command -- it is a client that does not speak this
    // protocol, and it is dropped with the connection.
    content::GetUIThreadTaskRunner({})->PostTask(
        FROM_HERE,
        base::BindOnce(
            &AnswerOnUIThread, request_.substr(0, newline),
            base::BindPostTask(content::GetIOThreadTaskRunner({}),
                               base::BindOnce(&CommandSocket::Reply,
                                              base::Unretained(this)))));
  }

  void Reply(std::string line) {
    write_buffer_ = std::move(line);
    write_offset_ = 0;
    OnWrite(net::OK);
  }

  void OnWrite(int result) {
    if (result < 0) {
      LOG(ERROR) << "domicile: could not answer a command: "
                 << net::ErrorToString(result);
      Close();
      return;
    }
    write_offset_ += static_cast<size_t>(result);
    if (write_offset_ >= write_buffer_.size()) {
      Close();
      return;
    }

    auto remaining = base::MakeRefCounted<net::StringIOBuffer>(
        write_buffer_.substr(write_offset_));
    const int written = connection_->Write(
        remaining.get(), remaining->size(),
        base::BindOnce(&CommandSocket::OnWrite, base::Unretained(this)),
        MISSING_TRAFFIC_ANNOTATION);
    if (written != net::ERR_IO_PENDING) {
      OnWrite(written);
    }
  }

  // The answer is over when the reply is on the wire: the supervisor reads
  // until end of stream, so closing is how it learns the line was the whole
  // answer.
  void Close() {
    connection_.reset();
    request_.clear();
    write_buffer_.clear();
    Accept();
  }

  net::UnixDomainServerSocket listener_;
  std::unique_ptr<net::StreamSocket> connection_;

  scoped_refptr<net::IOBufferWithSize> read_buffer_;
  std::string request_;

  std::string write_buffer_;
  size_t write_offset_ = 0;
};

void ListenOnIOThread(const std::string& path) {
  static base::NoDestructor<CommandSocket> socket;
  socket->Listen(path);
}

}  // namespace

void StartCommandSocket() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  if (!command_line.HasSwitch(kDomicileCommandSocketSwitch)) {
    return;
  }

  // The IO thread, because a net socket needs a sequence with an IO message
  // pump and the browser already has one. A thread of its own would be more
  // machinery than the traffic justifies: one bind at startup, and one short
  // line per command a person types.
  content::GetIOThreadTaskRunner({})->PostTask(
      FROM_HERE,
      base::BindOnce(&ListenOnIOThread, command_line.GetSwitchValueASCII(
                                            kDomicileCommandSocketSwitch)));
}

}  // namespace domicile
