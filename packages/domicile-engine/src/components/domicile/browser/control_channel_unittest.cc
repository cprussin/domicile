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
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "components/domicile/browser/line_framer.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/cursor/domicile/desk_cursor_theme.h"

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
  void AppAppeared(const std::string& app_id,
                   const std::string& title,
                   const std::string& desktop_id,
                   double width,
                   double height,
                   bool dialog,
                   bool client_frame,
                   mojom::WindowOwnerPtr owner,
                   uint32_t frame) override {
    heard_.push_back(base::StringPrintf(
        "appeared %s %s %s %gx%g%s%s%s%s", app_id.c_str(), title.c_str(),
        desktop_id.c_str(), width, height, dialog ? " dialog" : "",
        client_frame ? " client_frame" : "", Owned(owner).c_str(),
        frame ? base::StringPrintf(" frame %u", frame).c_str() : ""));
  }

  // The owner as " owner pid/uid/gid/inode", then its sandbox as
  // " sandbox engine/app/instance" with "-" for an unset one, or "" for none.
  static std::string Owned(const mojom::WindowOwnerPtr& owner) {
    if (!owner) {
      return "";
    }
    const std::string inode =
        owner->pidfd_inode ? base::NumberToString(*owner->pidfd_inode)
                           : "none";
    const std::string sandbox =
        owner->sandbox
            ? base::StringPrintf(" sandbox %s/%s/%s",
                                 owner->sandbox->engine.value_or("-").c_str(),
                                 owner->sandbox->app_id.value_or("-").c_str(),
                                 owner->sandbox->instance_id.value_or("-").c_str())
            : "";
    return base::StringPrintf(" owner %d/%u/%u/%s%s", owner->pid, owner->uid,
                              owner->gid, inode.c_str(), sandbox.c_str());
  }
  void AppResized(const std::string&, double, double) override {}
  void AppMinSize(const std::string&, double, double) override {}
  void AppMaxSize(const std::string&, double, double) override {}
  void PopupPlaced(const std::string& app_id,
                   const std::string& parent,
                   double,
                   double,
                   double,
                   double,
                   bool,
                   std::vector<mojom::AppFramePtr> frames) override {
    std::string heard = "placed " + app_id + " over " + parent;
    for (const mojom::AppFramePtr& frame : frames) {
      heard +=
          base::StringPrintf(" %s@%u", frame->app_id.c_str(), frame->frame);
    }
    heard_.push_back(heard);
  }
  void AppClosed(const std::string& app_id) override {
    heard_.push_back("closed " + app_id);
  }
  void AppCursor(const std::string&, mojom::CursorShape) override {}
  void AppPresented(const std::string& app_id) override {
    heard_.push_back("presented " + app_id);
  }
  void AppSuspended(const std::string& app_id, bool suspended) override {
    heard_.push_back((suspended ? "suspended " : "resumed ") + app_id);
  }
  void AppTransientFor(const std::string& app_id,
                       const std::string& transient_for) override {
    heard_.push_back(base::StringPrintf("transient %s for %s", app_id.c_str(),
                                        transient_for.c_str()));
  }
  void AppUrgent(const std::string& app_id, bool urgent) override {
    heard_.push_back(base::StringPrintf("urgent %s %s", app_id.c_str(),
                                        urgent ? "true" : "false"));
  }
  void AppInhibitsShortcuts(const std::string& app_id, bool inhibits) override {
    heard_.push_back(base::StringPrintf("inhibits %s %s", app_id.c_str(),
                                        inhibits ? "true" : "false"));
  }
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
  void System(const std::string& message) override {
    heard_.push_back("system " + message);
  }
  void CompositorReplaced() override {
    heard_.push_back("replaced");
    replaced_.SetValue();
  }
  void PortalRequests(const std::string&) override {}

  std::vector<std::string> heard_;
  base::test::TestFuture<void> locked_;
  base::test::TestFuture<void> replaced_;

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
                       cursor_theme_.GetRepeatingCallback(), Page{});

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

  // Takes the next compositor's connection, as a compositor started after the
  // last one exited.
  void AcceptTheNextCompositor() {
    base::test::TestFuture<int> accepted;
    ASSERT_EQ(
        Settle(server_.Accept(&compositor_, accepted.GetCallback()), accepted),
        net::OK);
  }

  // The next line the channel wrote, as the compositor reads it.
  std::string Heard() {
    while (lines_.empty()) {
      auto buffer = base::MakeRefCounted<net::IOBufferWithSize>(4096);
      base::test::TestFuture<int> read;
      const int got = Settle(
          compositor_->Read(buffer.get(), buffer->size(), read.GetCallback()),
          read);
      EXPECT_GT(got, 0);
      if (got <= 0) {
        return "";
      }
      for (std::string& line : framer_.Take(
               std::string_view(buffer->data(), static_cast<size_t>(got)))) {
        lines_.push_back(std::move(line));
      }
    }
    std::string line = std::move(lines_.front());
    lines_.erase(lines_.begin());
    return line;
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
  base::test::TestFuture<std::optional<ui::DeskCursorTheme>> cursor_theme_;
  FakeClient client_;
  LineFramer framer_;
  std::vector<std::string> lines_;
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

// A window is announced with its first frame's size and the client's hints,
// which the shell places it by.
TEST_F(ControlChannelTest, AWindowReachesThePageWithItsSizeAndHints) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"app_appeared\",\"app_id\":\"app-1\",\"title\":"
      "\"pinentry\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":true,\"client_frame\":true}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{
                "appeared app-1 pinentry  400x300 dialog client_frame",
                "locked false"}));
}

// The page hears when a window reaches the screen and when the compositor
// suspends it. A line missing a field is dropped.
TEST_F(ControlChannelTest, AWindowsPresentationAndSuspensionReachThePage) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"app_presented\",\"app_id\":\"app-1\"}\n"
      "{\"type\":\"app_presented\"}\n"
      "{\"type\":\"app_suspended\",\"app_id\":\"app-1\",\"suspended\":true}\n"
      "{\"type\":\"app_suspended\",\"app_id\":\"app-1\"}\n"
      "{\"type\":\"app_suspended\",\"app_id\":\"app-1\",\"suspended\":false}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{"presented app-1", "suspended app-1",
                                      "resumed app-1", "locked false"}));
}

TEST_F(ControlChannelTest, AWindowReachesThePageWithItsOwner) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  // A uid past 2^31 does not fit base::Value's int.
  Say("{\"type\":\"app_appeared\",\"app_id\":\"app-1\",\"title\":"
      "\"a\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":false,\"client_frame\":false,\"owner\":{\"pid\":4242,"
      "\"uid\":4294967294,\"gid\":100,\"pidfd_inode\":5021}}\n"
      "{\"type\":\"app_appeared\",\"app_id\":\"app-2\",\"title\":"
      "\"b\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":false,\"client_frame\":false,\"owner\":{\"pid\":7,"
      "\"uid\":1000,\"gid\":1000,\"pidfd_inode\":null,\"sandbox\":"
      "{\"engine\":\"org.flatpak\",\"app_id\":null,\"instance_id\":\"3\"}}}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{
                "appeared app-1 a  400x300 owner 4242/4294967294/100/5021",
                "appeared app-2 b  400x300 owner 7/1000/1000/none sandbox "
                "org.flatpak/-/3",
                "locked false"}));
}

// A move names the synced frames it shows with, and a window that appeared
// before the page names its own. A malformed frame is dropped, not shown as
// frame 0.
TEST_F(ControlChannelTest, TheFramesAMoveShowsWithReachThePage) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"app_appeared\",\"app_id\":\"app-2\",\"title\":"
      "\"a\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":false,\"client_frame\":false,\"frame\":3}\n"
      "{\"type\":\"popup_placed\",\"app_id\":\"app-3\",\"parent\":"
      "\"app-2\",\"position\":[12.0,48.0],\"size\":[180.0,240.0],"
      "\"grab\":false,\"frames\":[{\"app_id\":\"app-2\",\"frame\":4},"
      "{\"app_id\":\"app-3\",\"frame\":1},{\"app_id\":\"app-9\"},"
      "{\"app_id\":\"app-9\",\"frame\":-1}]}\n"
      "{\"type\":\"popup_placed\",\"app_id\":\"app-3\",\"parent\":"
      "\"app-2\",\"position\":[12.0,48.0],\"size\":[180.0,240.0],"
      "\"grab\":false}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{
                "appeared app-2 a  400x300 frame 3",
                "placed app-3 over app-2 app-2@4 app-3@1",
                "placed app-3 over app-2", "locked false"}));
}

// A null parent is a dialog no longer, not a malformed line.
TEST_F(ControlChannelTest, AWindowsParentAndUrgencyReachThePage) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"app_transient_for\",\"app_id\":\"app-4\","
      "\"transient_for\":\"app-2\"}\n"
      "{\"type\":\"app_transient_for\",\"app_id\":\"app-4\","
      "\"transient_for\":null}\n"
      "{\"type\":\"app_urgent\",\"app_id\":\"app-2\",\"urgent\":true}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{"transient app-4 for app-2",
                                      "transient app-4 for ",
                                      "urgent app-2 true", "locked false"}));
}

// A window taking and giving back a shortcuts inhibitor reaches the page,
// which lets the desktop's chords through to it meanwhile.
TEST_F(ControlChannelTest, AWindowInhibitingShortcutsReachesThePage) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  Say("{\"type\":\"app_inhibits_shortcuts\",\"app_id\":\"app-1\","
      "\"inhibits\":true}\n"
      "{\"type\":\"app_inhibits_shortcuts\",\"app_id\":\"app-1\","
      "\"inhibits\":false}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());

  EXPECT_EQ(client_.heard_,
            (std::vector<std::string>{"inhibits app-1 true",
                                      "inhibits app-1 false", "locked false"}));
}

// The browser process draws the pointer on a tty, so the theme stops there.
TEST_F(ControlChannelTest, TheDesksPointerThemeReachesTheBrowser) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();

  Say("{\"type\":\"appearance\",\"high_contrast\":false,"
      "\"reduced_motion\":false,\"cursor\":{\"name\":\"Amber\",\"size\":64}}"
      "\n");
  EXPECT_EQ(cursor_theme_.Take(),
            (ui::DeskCursorTheme{.name = "Amber", .size = 64}));

  // A theme with no size is refused, not drawn at some size.
  Say("{\"type\":\"appearance\",\"high_contrast\":false,"
      "\"reduced_motion\":false,\"cursor\":{\"name\":\"Amber\"}}\n"
      "{\"type\":\"appearance\",\"high_contrast\":false,"
      "\"reduced_motion\":false,\"cursor\":{\"name\":\"Base\",\"size\":24}}"
      "\n");
  EXPECT_EQ(cursor_theme_.Take(),
            (ui::DeskCursorTheme{.name = "Base", .size = 24}));

  Say("{\"type\":\"appearance\",\"high_contrast\":false,"
      "\"reduced_motion\":false}\n");
  EXPECT_EQ(cursor_theme_.Take(), std::nullopt);
}

// A compositor that exits takes its windows and the page's system calls with
// it. The page hears each window close and each call end, then dials the next
// compositor and hears that it changed. See "A compositor restart" in
// docs/architecture/ENGINE-FORK.md.
TEST_F(ControlChannelTest, ACompositorThatHangsUpEndsWhatItHadAndIsReplaced) {
  control_->SetClient(client_.BindRemote());
  control_->CallSystem(3, R"({"call":"watch","path":"/tmp"})");
  control_->CallSystem(4, R"({"call":"stat","path":"/tmp"})");
  control_->CallSystem(5, R"({"call":"stat","path":"/"})");
  // Driving call 3 is not a new call.
  control_->CallSystem(3, R"({"call":"unwatch"})");
  control_.FlushForTesting();
  Say("{\"type\":\"app_appeared\",\"app_id\":\"app-1\",\"title\":"
      "\"a\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":false,\"client_frame\":false}\n"
      "{\"type\":\"app_appeared\",\"app_id\":\"app-2\",\"title\":"
      "\"b\",\"desktop_id\":null,\"size\":[400.0,300.0],"
      "\"dialog\":false,\"client_frame\":false}\n"
      "{\"type\":\"app_closed\",\"app_id\":\"app-2\"}\n"
      "{\"type\":\"system_reply\",\"id\":3,\"reply\":"
      "{\"kind\":\"started\"}}\n"
      "{\"type\":\"system_reply\",\"id\":5,\"reply\":{\"kind\":"
      "\"stat\",\"file_type\":\"directory\",\"size\":0}}\n"
      "{\"type\":\"locked\",\"locked\":false}\n");
  EXPECT_TRUE(client_.locked_.Wait());
  client_.heard_.clear();

  compositor_.reset();
  AcceptTheNextCompositor();

  EXPECT_EQ(Heard(), R"({"protocol_version":1,"type":"hello"})");
  EXPECT_TRUE(client_.replaced_.Wait());
  EXPECT_EQ(
      client_.heard_,
      (std::vector<std::string>{
          "system "
          R"({"end":{"error":{"kind":"compositor_gone","message":"the )"
          R"(compositor exited"},"kind":"failed"},"id":3,"type":"system_end"})",
          "system "
          R"({"id":4,"reply":{"error":{"kind":"compositor_gone","message":)"
          R"("the compositor exited"},"kind":"failed"},"type":"system_reply"})",
          "closed app-1", "replaced"}));
}

// What the page says while no compositor is up reaches the next one, after
// its hello.
TEST_F(ControlChannelTest, APageLineWithNoCompositorUpReachesTheNextOne) {
  control_->SetClient(client_.BindRemote());
  control_.FlushForTesting();
  EXPECT_EQ(Heard(), R"({"protocol_version":1,"type":"hello"})");

  compositor_.reset();
  control_->FocusChrome();
  control_.FlushForTesting();
  AcceptTheNextCompositor();

  EXPECT_EQ(Heard(), R"({"protocol_version":1,"type":"hello"})");
  EXPECT_EQ(Heard(), R"({"type":"focus_chrome"})");
}

}  // namespace
}  // namespace domicile
