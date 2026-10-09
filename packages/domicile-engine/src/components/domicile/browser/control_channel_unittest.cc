// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/control_channel.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/scoped_temp_dir.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/scoped_refptr.h"
#include "base/run_loop.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// The page's end, recording the two members the test sends and nothing else.
class FakeClient : public mojom::ControlChannelClient {
 public:
  mojo::PendingRemote<mojom::ControlChannelClient> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  void Idle(bool idle) override {
    heard_.push_back(idle ? "idle true" : "idle false");
  }
  void Locked(bool locked) override {
    heard_.push_back(locked ? "locked true" : "locked false");
    locked_.SetValue();
  }

  void AppTitled(const std::string&, const std::string&) override {}
  void AppDesktopId(const std::string&, const std::string&) override {}
  void AppAppeared(const std::string&,
                   const std::string&,
                   const std::string&,
                   bool,
                   double,
                   double) override {}
  void AppResized(const std::string&, double, double) override {}
  void AppMinSize(const std::string&, double, double) override {}
  void AppMaxSize(const std::string&, double, double) override {}
  void PopupPlaced(const std::string&,
                   const std::string&,
                   double,
                   double,
                   double,
                   double,
                   bool) override {}
  void AppClosed(const std::string&) override {}
  void AppCursor(const std::string&, mojom::CursorShape) override {}
  void ShortcutPressed(mojom::ShortcutPtr) override {}
  void ShortcutReleased(mojom::ShortcutPtr) override {}
  void Modifiers(bool, bool, bool, bool) override {}
  void Displays(std::vector<mojom::DisplayInfoPtr>) override {}
  void Files(const std::string&,
             const std::vector<std::string>&,
             uint32_t,
             bool) override {}
  void Clipboard(std::vector<mojom::ClipboardEntryPtr>) override {}
  void Tray(std::vector<mojom::TrayItemPtr>) override {}
  void Notifications(std::vector<mojom::NotificationPtr>) override {}
  void ThemeChanged(mojom::Theme) override {}
  void WindowsThemeChanged(mojom::Theme) override {}
  void AppearanceChanged(const std::optional<std::string>&,
                         bool,
                         bool) override {}
  void ShellConfig(const std::string&) override {}
  void FocusChanged(const std::string&) override {}
  void FocusRequested(const std::string&) override {}
  void System(const std::string&) override {}
  void PortalRequests(const std::string&) override {}

  std::vector<std::string> heard_;
  base::test::TestFuture<void> locked_;

 private:
  mojo::Receiver<mojom::ControlChannelClient> receiver_{this};
};

// The result of a net call that may finish now or later.
int Settle(int result, base::test::TestFuture<int>& later) {
  return result == net::ERR_IO_PENDING ? later.Get() : result;
}

class ControlChannelTest : public testing::Test {
 protected:
  void SetUp() override {
    ASSERT_TRUE(dir_.CreateUniqueTempDir());
    const std::string path = dir_.GetPath().Append("control").value();
    ASSERT_EQ(server_.BindAndListen(path, /*backlog=*/1), net::OK);

    // Self-owned, like every channel: dropping `control_` deletes it.
    new ControlChannel(path, control_.BindNewPipeAndPassReceiver(),
                       keymap_.GetRepeatingCallback<const std::string&>(),
                       base::DoNothing(), base::DoNothing(), base::DoNothing(),
                       Page{});

    base::test::TestFuture<int> accepted;
    ASSERT_EQ(
        Settle(server_.Accept(&compositor_, accepted.GetCallback()), accepted),
        net::OK);
  }

  void TearDown() override {
    control_.reset();
    base::RunLoop().RunUntilIdle();
  }

  // Writes `lines` to the channel as the compositor.
  void Say(const std::string& lines) {
    auto buffer = base::MakeRefCounted<net::StringIOBuffer>(lines);
    base::test::TestFuture<int> written;
    ASSERT_EQ(Settle(compositor_->Write(buffer.get(), buffer->size(),
                                        written.GetCallback(),
                                        MISSING_TRAFFIC_ANNOTATION),
                     written),
              buffer->size());
  }

  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::MainThreadType::IO};
  base::ScopedTempDir dir_;
  net::UnixDomainServerSocket server_{
      base::BindRepeating(
          [](const net::UnixDomainServerSocket::Credentials&) { return true; }),
      /*use_abstract_namespace=*/false};
  std::unique_ptr<net::StreamSocket> compositor_;
  mojo::Remote<mojom::ControlChannel> control_;
  base::test::TestFuture<std::string> keymap_;
  FakeClient client_;
};

// The compositor answers `hello` with the desk's state, and that answer can
// reach the browser before the page's SetClient does.
TEST_F(ControlChannelTest, ALineBeforeThePageBindsReachesItAfterInOrder) {
  // The keymap is the browser's own, so its arrival says the line before it
  // was read while no page was bound.
  Say("{\"type\":\"idle\",\"idle\":true}\n"
      "{\"type\":\"keymap\",\"keymap\":\"xkb\"}\n");
  EXPECT_EQ(keymap_.Take(), "xkb");

  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{"idle true", "locked false"}));
}

}  // namespace
}  // namespace domicile
