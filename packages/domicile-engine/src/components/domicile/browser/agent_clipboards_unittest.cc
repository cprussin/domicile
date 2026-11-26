// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/agent_clipboards.h"

#include <optional>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/clipboard/test/test_clipboard.h"

namespace domicile {
namespace {

// The text on `clipboard`'s Ctrl-C buffer.
std::u16string TextOn(const ui::Clipboard& clipboard) {
  base::test::TestFuture<std::u16string> text;
  clipboard.ReadText(ui::ClipboardBuffer::kCopyPaste, std::nullopt,
                     text.GetCallback());
  return text.Take();
}

// Copies `text` as a page does: through a writer, to whatever
// ui::Clipboard::GetForCurrentThread() answers.
void Copy(const std::u16string& text) {
  ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste).WriteText(text);
}

class AgentClipboardsTest : public testing::Test {
 protected:
  AgentClipboardsTest()
      : desktop_(ui::TestClipboard::CreateForCurrentThread()) {}

  ~AgentClipboardsTest() override {
    desktop_ = nullptr;
    ui::Clipboard::DestroyClipboardForCurrentThread();
  }

  base::test::TaskEnvironment task_environment_;
  raw_ptr<ui::TestClipboard> desktop_;
  AgentClipboards agents_;
};

TEST_F(AgentClipboardsTest, AnAgentsCopyStaysOffTheDesktopsClipboard) {
  Copy(u"the user's");
  {
    const ui::ScopedClipboardRedirect redirect(agents_.For("agent-1"));
    Copy(u"the agent's");
  }
  EXPECT_EQ(TextOn(*desktop_), u"the user's");
  EXPECT_EQ(TextOn(*agents_.For("agent-1")), u"the agent's");
}

TEST_F(AgentClipboardsTest, AnAgentPastesItsOwnCopy) {
  {
    const ui::ScopedClipboardRedirect redirect(agents_.For("agent-1"));
    Copy(u"the agent's");
  }
  Copy(u"the user's");
  const ui::ScopedClipboardRedirect redirect(agents_.For("agent-1"));
  EXPECT_EQ(TextOn(*ui::Clipboard::GetForCurrentThread()), u"the agent's");
}

TEST_F(AgentClipboardsTest, EachAgentHasItsOwn) {
  {
    const ui::ScopedClipboardRedirect redirect(agents_.For("agent-1"));
    Copy(u"the first agent's");
  }
  EXPECT_EQ(TextOn(*agents_.For("agent-2")), u"");
}

TEST_F(AgentClipboardsTest, AnAgentsCopiesGoWithIt) {
  {
    const ui::ScopedClipboardRedirect redirect(agents_.For("agent-1"));
    Copy(u"the agent's");
  }
  agents_.Gone("agent-1");
  EXPECT_EQ(TextOn(*agents_.For("agent-1")), u"");
}

TEST_F(AgentClipboardsTest, APageNoAgentDroveUsesTheDesktops) {
  EXPECT_EQ(agents_.ForPage(std::nullopt), nullptr);
}

TEST_F(AgentClipboardsTest, APageAnAgentDroveUsesItsAgents) {
  EXPECT_EQ(agents_.ForPage("agent-1"), agents_.For("agent-1"));
}

}  // namespace
}  // namespace domicile
