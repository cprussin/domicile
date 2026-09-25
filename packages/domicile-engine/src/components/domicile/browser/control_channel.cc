// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/control_channel.h"

#include <string_view>
#include <utility>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/task/bind_post_task.h"
#include "base/values.h"
#include "components/domicile/common/cursor_shape.h"
#include "components/domicile/common/display_transform.h"
#include "components/domicile/common/theme.h"
#include "components/domicile/common/domicile_scheme.h"
#include "net/base/net_errors.h"

namespace domicile {
namespace {

// The read buffer. One message is a line of JSON; this is sized for a batch of
// them rather than for the largest one, because the remainder is carried across
// reads anyway.
constexpr int kReadBufferSize = 16 * 1024;

}  // namespace

ControlChannel::ControlChannel(
    const std::string& socket_path,
    mojo::PendingReceiver<mojom::ControlChannel> receiver,
    KeymapSink keymap_sink,
    PointerWarpSink warp_sink,
    ThemeSink theme_sink,
    const std::string& screen)
    : socket_path_(socket_path),
      keymap_sink_(std::move(keymap_sink)),
      warp_sink_(std::move(warp_sink)),
      theme_sink_(std::move(theme_sink)),
      screen_(screen),
      receiver_(this, std::move(receiver)),
      read_buffer_(base::MakeRefCounted<net::IOBufferWithSize>(
          kReadBufferSize)) {
  // The page going away takes this with it; nothing else owns it.
  receiver_.set_disconnect_handler(
      base::BindOnce([](ControlChannel* self) { delete self; },
                     base::Unretained(this)));
  // Both directions of the shortcut leg, in one place. The registry matches a
  // chord wherever the key arrived -- which for a browser window is the UI
  // thread, in the guest's delegate -- so what it is handed is posted back
  // here, where `client_` is bound and where this object may be touched at all.
  channel_ = ShortcutRegistry::Get().AddChannel(
      base::BindPostTaskToCurrentDefault(base::BindRepeating(
          &ControlChannel::DeliverShortcutNow, weak_factory_.GetWeakPtr())),
      base::BindPostTaskToCurrentDefault(base::BindRepeating(
          &ControlChannel::DeliverModifiersNow, weak_factory_.GetWeakPtr())));
  give_up_at_ = base::TimeTicks::Now() + kReachFor;
  Connect();
}

ControlChannel::~ControlChannel() {
  ShortcutRegistry::Get().RemoveChannel(channel_);
}

void ControlChannel::Connect() {
  socket_ = std::make_unique<net::UnixDomainClientSocket>(
      socket_path_, /*use_abstract_namespace=*/false);
  const int result = socket_->Connect(base::BindOnce(
      &ControlChannel::OnConnect, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnConnect(result);
  }
}

void ControlChannel::OnConnect(int result) {
  if (result != net::OK) {
    OnConnectFailed();
    return;
  }

  connected_ = true;

  // The handshake, which the page used to send and the browser now owns. A
  // compositor that disagrees about the version says so in `welcome`, and that
  // is the check this exists for.
  base::DictValue hello;
  hello.Set("type", "hello");
  hello.Set("protocol_version", kProtocolVersion);
  std::string line;
  if (base::JSONWriter::Write(hello, &line)) {
    pending_.insert(pending_.begin(), line);
  }

  // WHICH WINDOW THIS IS, and the browser owns it for the same reason it owns
  // the handshake: the page does not know which monitor it was put on, and
  // asking it to find out would be asking it to guess. A desk of several
  // monitors is several windows -- one cannot span two CRTCs -- each loading
  // the same shell, and this is the only thing that differs between them.
  //
  // AFTER THE HANDSHAKE AND NOT BEFORE. The compositor puts a connection on
  // its list when it agrees the protocol, and a `set_screen` arriving before
  // that names a window it has no record of. One socket is read in order, so
  // inserting it second is enough to be sure.
  //
  // Empty for a nested run, where the window is the whole desktop and there is
  // no display to name.
  if (!screen_.empty()) {
    // Built here rather than through `Typed`, which is declared further down
    // this file than the handshake that needs it.
    base::DictValue screen;
    screen.Set("type", "set_screen");
    screen.Set("name", screen_);
    std::string named;
    if (base::JSONWriter::Write(screen, &named)) {
      pending_.insert(pending_.begin() + 1, named);
    }
  }

  ReadLoop();
  FlushQueue();
}

void ControlChannel::OnConnectFailed() {
  socket_.reset();
  if (base::TimeTicks::Now() >= give_up_at_) {
    // Say so rather than sit there. A shell whose channel never connected has
    // no desktop behind it, and silence is the failure mode ERRORS.md exists to
    // prevent.
    LOG(ERROR) << "domicile: no compositor on " << socket_path_ << " after "
               << kReachFor.InSeconds()
               << "s. The desktop's control channel will not connect; the "
                  "shell will render but no window will work.";
    client_.reset();
    // Closing the page's end is what makes the failure visible. `this` is
    // destroyed by the disconnect handler, so nothing may touch it after.
    receiver_.reset();
    delete this;
    return;
  }
  retry_timer_.Start(FROM_HERE, kRetryEvery,
                     base::BindOnce(&ControlChannel::Connect,
                                    weak_factory_.GetWeakPtr()));
}

void ControlChannel::SetClient(
    mojo::PendingRemote<mojom::ControlChannelClient> client) {
  client_.Bind(std::move(client));
}

void ControlChannel::Spawn(const std::vector<std::string>& command) {
  // An empty argv is refused here as well as in the renderer, because the
  // renderer's check is advice: this process is the one that must not hand an
  // empty command to the compositor.
  if (command.empty()) {
    return;
  }

  base::ListValue argv;
  for (const std::string& argument : command) {
    argv.Append(argument);
  }
  base::DictValue message;
  message.Set("type", "spawn");
  message.Set("command", std::move(argv));

  std::string line;
  if (!base::JSONWriter::Write(message, &line)) {
    return;
  }
  Send(line);
}

void ControlChannel::SendMessage(base::DictValue message) {
  std::string line;
  if (!base::JSONWriter::Write(message, &line)) {
    return;
  }
  Send(line);
}

namespace {

base::DictValue Typed(const char* type) {
  base::DictValue message;
  message.Set("type", type);
  return message;
}

base::DictValue ForApp(const char* type, const std::string& app_id) {
  base::DictValue message = Typed(type);
  message.Set("app_id", app_id);
  return message;
}

base::ListValue Size(double width, double height) {
  base::ListValue size;
  size.Append(width);
  size.Append(height);
  return size;
}

// A number the compositor wrote, whichever way it wrote it.
//
// Not GetIfInt: the compositor's sizes are f64, and serde renders 800.0 with
// the decimal point, which a JSON reader types as a double. Asking for an int
// gets nothing and the size arrives as zero -- which is exactly the "opened
// windows at nothing at all" failure the absent-size handling above exists to
// prevent, arriving through the type instead of through the absence.
double Number(const base::Value& value) {
  if (std::optional<double> number = value.GetIfDouble()) {
    return *number;
  }
  return 0.0;
}

// Which way up a monitor is, by the name the compositor wrote.
//
// A missing field and a name nothing matches both come out kNormal, and NOT
// because it is the tidy default. A cursor nobody knows is worth dropping the
// message over -- `cursor_shape.h` says why -- but this message is the whole
// desktop, and refusing it over one unreadable field would leave the shell
// with no screens rather than with a monitor the wrong way up. `normal` is
// the arrangement that is right whenever there is nothing to turn, and it is
// what a page produces if it never hears of transforms at all, so it is what
// a page gets when this cannot tell.
mojom::DisplayTransform TransformNamed(const std::string* named) {
  if (!named) {
    return mojom::DisplayTransform::kNormal;
  }
  return DisplayTransformFromWire<mojom::DisplayTransform>(*named).value_or(
      mojom::DisplayTransform::kNormal);
}

}  // namespace

void ControlChannel::FocusApp(const std::string& app_id) {
  SendMessage(ForApp("focus_app", app_id));
}

// Words to match and nothing else: the message asks the compositor what in
// the home matches, and says nothing about where to look.
void ControlChannel::SearchFiles(const std::string& query) {
  base::DictValue message = Typed("search_files");
  message.Set("query", query);
  SendMessage(std::move(message));
}

// A path relative to the home, as a `found_files` answer named it. What makes
// that safe is the compositor's, not this: it answers only for a path in its
// own index of the home -- see ControlChannel::PreviewFile in the mojom.
void ControlChannel::PreviewFile(const std::string& path) {
  base::DictValue message = Typed("preview_file");
  message.Set("path", path);
  SendMessage(std::move(message));
}

// The one member that names a row of the clipboard, and the whole of what a
// page may do to the seat's selection: it says which of the things already
// copied to put back, and cannot say what was copied.
void ControlChannel::CopyClipboardEntry(uint32_t entry) {
  base::DictValue message = Typed("copy_clipboard_entry");
  message.Set("entry", static_cast<int>(entry));
  SendMessage(std::move(message));
}

void ControlChannel::FocusChrome() {
  SendMessage(Typed("focus_chrome"));
}

// NOTHING IS SENT, AND THAT IS THE MEMBER RATHER THAN AN OMISSION. The pointer
// a shell is asking about is the one this process draws -- on the platform
// that scans out it is a cursor plane, and the compositor has never heard of
// it. So this goes up to the UI thread and no further, which is the same shape
// `GrabShortcut` has for the same kind of reason.
void ControlChannel::WarpPointer(double x, double y) {
  warp_sink_.Run(x, y);
}

void ControlChannel::CloseApp(const std::string& app_id) {
  SendMessage(ForApp("close_app", app_id));
}

void ControlChannel::ResizeApp(const std::string& app_id,
                               double width,
                               double height) {
  base::DictValue message = ForApp("resize_app", app_id);
  message.Set("size", Size(width, height));
  SendMessage(std::move(message));
}

void ControlChannel::SetDesktopSize(double width, double height) {
  base::DictValue message = Typed("set_desktop_size");
  message.Set("size", Size(width, height));
  SendMessage(std::move(message));
}

void ControlChannel::SetDevicePixelRatio(double ratio) {
  base::DictValue message = Typed("set_device_pixel_ratio");
  message.Set("ratio", ratio);
  SendMessage(std::move(message));
}

// THE ONE MEMBER THAT RELAYS A DECISION rather than a measurement or a
// request. What goes down this socket is the theme the user just picked, and
// what comes back up is `theme` to every chrome -- including this one, which
// is how a page comes to repaint without believing its own click.
//
// Through the wire name for the reason `AppCursor` goes through one on the way
// in: the only mapping in either direction is the X-macro in
// components/domicile/common/theme.h, so the list stays singular and
// scripts/test-themes-agree.sh can read every writing of it.
void ControlChannel::SetTheme(mojom::Theme theme) {
  base::DictValue message = Typed("set_theme");
  message.Set("theme", std::string(ThemeToWire(theme)));
  SendMessage(std::move(message));
}

void ControlChannel::GrabShortcut(mojom::ShortcutPtr shortcut) {
  // RECORDED HERE RATHER THAN RELAYED, and the compositor no longer has a
  // message for it. It used to hold the claims, and it is the layer that
  // should: it sees a key before the client it belongs to does. It cannot see
  // these ones. A browser window is a `<webview>` whose page is a guest, DOM
  // focus moves into it, and its keys reach neither the shell's document nor
  // -- since the shell is what forwards them -- the compositor. This process is
  // the only layer above a focused guest, so this is where the set lives and
  // `WebViewGuest::PreHandleKeyboardEvent` is what matches against it.
  ShortcutRegistry::Get().Grab(Chord{shortcut->keycode, shortcut->alt,
                                     shortcut->ctrl, shortcut->shift,
                                     shortcut->meta});
}

void ControlChannel::Key(const std::string& app_id,
                         uint32_t keycode,
                         bool pressed) {
  base::DictValue message = ForApp("key", app_id);
  message.Set("keycode", static_cast<int>(keycode));
  message.Set("pressed", pressed);
  SendMessage(std::move(message));
}

void ControlChannel::PointerMotion(const std::string& app_id,
                                   double x,
                                   double y) {
  base::DictValue message = ForApp("pointer_motion", app_id);
  message.Set("x", x);
  message.Set("y", y);
  SendMessage(std::move(message));
}

void ControlChannel::PointerLeave(const std::string& app_id) {
  SendMessage(ForApp("pointer_leave", app_id));
}

void ControlChannel::PointerButton(const std::string& app_id,
                                   uint32_t button,
                                   bool pressed) {
  base::DictValue message = ForApp("pointer_button", app_id);
  message.Set("button", static_cast<int>(button));
  message.Set("pressed", pressed);
  SendMessage(std::move(message));
}

void ControlChannel::PointerAxis(const std::string& app_id,
                                 double dx,
                                 double dy,
                                 int32_t v120_x,
                                 int32_t v120_y) {
  base::DictValue message = ForApp("pointer_axis", app_id);
  message.Set("dx", dx);
  message.Set("dy", dy);
  message.Set("v120_x", v120_x);
  message.Set("v120_y", v120_y);
  SendMessage(std::move(message));
}

void ControlChannel::Send(const std::string& json_line) {
  pending_.push_back(json_line);
  if (connected_) {
    FlushQueue();
  }
}

void ControlChannel::FlushQueue() {
  if (!connected_ || writing_ || pending_.empty()) {
    return;
  }
  WriteNext();
}

void ControlChannel::WriteNext() {
  if (pending_.empty()) {
    writing_ = false;
    return;
  }
  writing_ = true;
  write_buffer_ = pending_.front() + "\n";
  pending_.erase(pending_.begin());
  write_offset_ = 0;
  OnWrite(net::OK);
}

void ControlChannel::OnWrite(int result) {
  if (result < 0) {
    LOG(ERROR) << "domicile: control channel write failed: "
               << net::ErrorToString(result);
    writing_ = false;
    return;
  }
  write_offset_ += static_cast<size_t>(result);
  if (write_offset_ >= write_buffer_.size()) {
    WriteNext();
    return;
  }

  auto remaining = base::MakeRefCounted<net::StringIOBuffer>(
      write_buffer_.substr(write_offset_));
  const int written = socket_->Write(
      remaining.get(), remaining->size(),
      base::BindOnce(&ControlChannel::OnWrite, weak_factory_.GetWeakPtr()),
      MISSING_TRAFFIC_ANNOTATION);
  if (written != net::ERR_IO_PENDING) {
    OnWrite(written);
  }
}

void ControlChannel::DeliverShortcut(Chord chord, base::TimeTicks arrival) {
  if (client_) {
    client_->ShortcutPressed(
        mojom::Shortcut::New(chord.keycode, chord.alt, chord.ctrl, chord.shift,
                             chord.meta),
        arrival);
  }
}

void ControlChannel::DeliverModifiers(Modifiers modifiers,
                                      base::TimeTicks arrival) {
  if (client_) {
    client_->Modifiers(modifiers.alt, modifiers.ctrl, modifiers.shift,
                       modifiers.meta, arrival);
  }
}

// THE REGISTRY'S SIDE OF THOSE TWO, AND THE STAMP IS TAKEN HERE RATHER THAN
// BOUND INTO THE CALLBACK. A chord claimed by the shell is matched on the UI
// thread and posted to this sequence; `base::TimeTicks::Now()` at the far end
// of that post is when this channel had it, which is the quantity the page
// subtracts. Taking it at the match instead would price the post into the hop
// and report a stage that is not the one being measured.
void ControlChannel::DeliverShortcutNow(Chord chord) {
  DeliverShortcut(chord, base::TimeTicks::Now());
}

void ControlChannel::DeliverModifiersNow(Modifiers modifiers) {
  DeliverModifiers(modifiers, base::TimeTicks::Now());
}

void ControlChannel::ReadLoop() {
  const int result = socket_->Read(
      read_buffer_.get(), kReadBufferSize,
      base::BindOnce(&ControlChannel::OnRead, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnRead(result);
  }
}

void ControlChannel::OnRead(int result) {
  if (result <= 0) {
    // Zero is the compositor closing the socket, which on this desktop means
    // it went away. Either way there is nothing more to read and nothing to
    // send it.
    connected_ = false;
    client_.reset();
    return;
  }

  // WHEN THE BROWSER PROCESS TOOK THIS OFF THE COMPOSITOR'S SOCKET. This line
  // is the whole of `arrival`: everything downstream of it -- the JSON parse,
  // the mojo call, the renderer, Blink's dispatch -- is the stage the page
  // prices by subtracting this from `Event.timeStamp`. Before the read's own
  // bookkeeping, so the parse of the first message is inside the measurement
  // rather than outside it.
  const base::TimeTicks arrival = base::TimeTicks::Now();

  for (const std::string& line : framer_.Take(std::string_view(
           read_buffer_->data(), static_cast<size_t>(result)))) {
    DispatchLine(line, arrival);
  }

  ReadLoop();
}

void ControlChannel::DispatchLine(const std::string& line,
                                 base::TimeTicks arrival) {
  if (line.empty()) {
    return;
  }

  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!parsed) {
    LOG(WARNING) << "domicile: control channel sent a line that is not a JSON "
                    "object; dropped.";
    return;
  }
  const base::DictValue& message = *parsed;
  const std::string* type = message.FindString("type");
  if (!type) {
    return;
  }

  // THE ONE MESSAGE ON THIS SOCKET THAT IS NOT THE PAGE'S, and the one that is
  // handled before `client_` is looked at for that reason. What the compositor
  // is describing is how this *process* reads a keyboard: without it the
  // browser's own KeyboardLayoutEngine has no keymap at all, and a shell is a
  // page nobody can type into. See
  // components/domicile/browser/keyboard_layout.h, which is where the whole of
  // why lives.
  //
  // Nothing goes on to the page, and nothing should: the compositor already
  // resolves the modifiers against this keymap before it sends them, so a
  // document holding 40 kilobytes of xkb has nothing to do with it.
  if (*type == "keymap") {
    const std::string* keymap = message.FindString("keymap");
    if (keymap) {
      keymap_sink_.Run(*keymap);
    } else {
      // Said, unlike every other arm here, which drops a malformed message and
      // moves on. Those cost one window or one cursor; this one costs the
      // whole keyboard, and it costs it the way this bug arrived in the first
      // place -- with every log on both sides reporting a desktop that is
      // fine.
      LOG(ERROR) << "domicile: the compositor sent a `keymap` message with no "
                    "keymap in it. The layout engine keeps what it had, which "
                    "on this platform is nothing, and printable keys will "
                    "carry no character.";
    }
    return;
  }

  // Everything below is relayed to the page, so there is nowhere to put it
  // until the page has given this channel somewhere.
  if (!client_) {
    return;
  }

  if (*type == "welcome") {
    const std::optional<int> version = message.FindInt("protocol_version");
    if (version && *version != kProtocolVersion) {
      LOG(ERROR) << "domicile: the compositor speaks protocol version "
                 << *version << " and this engine speaks " << kProtocolVersion
                 << ". They were built from different revisions; the desktop "
                    "will misbehave in ways that look like bugs.";
    }
    return;
  }

  if (*type == "app_titled") {
    const std::string* app_id = message.FindString("app_id");
    if (!app_id) {
      return;
    }
    // A null title is a window saying it has no name, not a malformed message.
    // Requiring the string dropped the whole thing, so a shell went on showing
    // the name a window had stopped using -- and `app_appeared` two branches
    // down already reads the same field the other way, which is the reading
    // that matches the wire.
    const std::string* title = message.FindString("title");
    client_->AppTitled(*app_id, title ? *title : std::string(), arrival);
    return;
  }

  if (*type == "app_appeared") {
    const std::string* app_id = message.FindString("app_id");
    if (!app_id) {
      return;
    }
    const std::string* title = message.FindString("title");
    // Size is absent until the client has committed a buffer. Passing a zero
    // as though it were a size is what opened windows at nothing at all, so
    // absence is carried rather than flattened.
    const base::ListValue* size = message.FindList("size");
    const bool has_size = size && size->size() == 2u;
    client_->AppAppeared(*app_id, title ? *title : std::string(), has_size,
                         has_size ? Number((*size)[0]) : 0.0,
                         has_size ? Number((*size)[1]) : 0.0, arrival);
    return;
  }

  if (*type == "app_resized") {
    const std::string* app_id = message.FindString("app_id");
    const base::ListValue* size = message.FindList("size");
    if (app_id && size && size->size() == 2u) {
      client_->AppResized(*app_id, Number((*size)[0]), Number((*size)[1]),
                          arrival);
    }
    return;
  }

  if (*type == "app_closed") {
    if (const std::string* app_id = message.FindString("app_id")) {
      client_->AppClosed(*app_id, arrival);
    }
    return;
  }

  if (*type == "app_cursor") {
    const std::string* app_id = message.FindString("app_id");
    const std::string* cursor = message.FindString("cursor");
    if (!app_id || !cursor) {
      return;
    }
    // THE CLOSED SET, ASKED ABOUT HERE AND NOWHERE ELSE. This used to copy the
    // string through to the page, where an unknown CSS keyword is a no-op and
    // the symptom is an arrow instead of a hand with nothing said anywhere.
    // See components/domicile/common/cursor_shape.h.
    const std::optional<mojom::CursorShape> shape =
        CursorShapeFromWire<mojom::CursorShape>(*cursor);
    if (!shape) {
      // Dropped with a name, like every other unrecognized message on this
      // channel: a cursor this build does not know is a compositor newer than
      // it rather than a broken stream, and the one thing that must not happen
      // is a shape being invented for it.
      LOG(WARNING) << "domicile: the compositor asked for a cursor named '"
                   << *cursor
                   << "', which is not one of the shapes this engine knows; "
                      "the request was dropped.";
      return;
    }
    client_->AppCursor(*app_id, *shape, arrival);
    return;
  }

  // The compositor's own two, through the same pair of methods the registry
  // reaches -- so that a chord matched in this process and one matched out
  // there arrive at the page as the same thing.
  //
  // A CLAIM CAN NO LONGER BE MADE OUT THERE, so nothing sends `shortcut` today:
  // `grab_shortcut` is gone from the protocol and the browser holds the set.
  // The arm stays because the compositor is still the layer that sees a
  // client's keys, and giving it a chord back is the shape a desktop shortcut
  // over a Wayland window would take. `logo` is what Wayland calls the key the
  // web calls Meta.
  if (*type == "shortcut") {
    const base::DictValue* combination = message.FindDict("shortcut");
    if (!combination) {
      return;
    }
    DeliverShortcut(
        Chord{static_cast<uint32_t>(combination->FindInt("key").value_or(0)),
              combination->FindBool("alt").value_or(false),
              combination->FindBool("ctrl").value_or(false),
              combination->FindBool("shift").value_or(false),
              combination->FindBool("logo").value_or(false)},
        arrival);
    return;
  }

  if (*type == "modifiers") {
    DeliverModifiers(Modifiers{message.FindBool("alt").value_or(false),
                               message.FindBool("ctrl").value_or(false),
                               message.FindBool("shift").value_or(false),
                               message.FindBool("logo").value_or(false)},
                     arrival);
    return;
  }

  if (*type == "displays") {
    const base::ListValue* described = message.FindList("displays");
    if (!described) {
      return;
    }
    std::vector<mojom::DisplayInfoPtr> displays;
    displays.reserve(described->size());
    for (const base::Value& entry : *described) {
      const base::DictValue* display = entry.GetIfDict();
      if (!display) {
        continue;
      }
      const std::string* name = display->FindString("name");
      const base::ListValue* position = display->FindList("position");
      const base::ListValue* size = display->FindList("size");
      if (!name || !position || position->size() != 2u || !size ||
          size->size() != 2u) {
        continue;
      }
      // The mode is OPTIONAL where the rest is required, and the two are
      // required for different reasons. A display with no name or no
      // rectangle is not a display and is dropped; a display with no mode is
      // one from a host that predates the field, and 0x0 is what it gets --
      // harmless, because `fills_the_window` is what decides whether anybody
      // divides by it and that too defaults to the answer for a desktop that
      // had no notion of any of this.
      const base::ListValue* mode = display->FindList("mode");
      const bool moded = mode && mode->size() == 2u;
      const std::string* transform = display->FindString("transform");
      displays.push_back(mojom::DisplayInfo::New(
          *name, static_cast<int32_t>(Number((*position)[0])),
          static_cast<int32_t>(Number((*position)[1])),
          static_cast<uint32_t>(Number((*size)[0])),
          static_cast<uint32_t>(Number((*size)[1])),
          static_cast<uint32_t>(display->FindInt("scale").value_or(1)),
          moded ? static_cast<uint32_t>(Number((*mode)[0])) : 0u,
          moded ? static_cast<uint32_t>(Number((*mode)[1])) : 0u,
          TransformNamed(transform),
          display->FindBool("fills_the_window").value_or(false)));
    }
    // Sent even when every entry was malformed, because an empty desktop is an
    // answer: a page told nothing and a page told there are no screens are
    // different states, and only the second can be rendered.
    client_->Displays(std::move(displays));
    return;
  }

  if (*type == "found_files") {
    const std::string* query = message.FindString("query");
    const base::ListValue* found = message.FindList("files");
    const std::optional<int> matched = message.FindInt("matched");
    const std::optional<bool> indexing = message.FindBool("indexing");
    // All four or nothing, which is what `battery` below does: an answer
    // without its query cannot be told from the answer to a keystroke ago,
    // and one without its count or its flag would be drawn as a claim it did
    // not make.
    if (!query || !found || !matched || *matched < 0 || !indexing) {
      return;
    }
    std::vector<std::string> files;
    files.reserve(found->size());
    for (const base::Value& entry : *found) {
      const std::string* path = entry.GetIfString();
      if (path) {
        files.push_back(*path);
      }
    }
    // Sent even when it is empty, for the reason `displays` above is: a query
    // that matched nothing is an answer, and a launcher that never heard one
    // would wait for a message the compositor has already sent.
    client_->Files(*query, std::move(files), static_cast<uint32_t>(*matched),
                   *indexing, arrival);
    return;
  }

  if (*type == "file_preview") {
    const std::string* path = message.FindString("path");
    const std::string* kind = message.FindString("kind");
    // The path and the kind or nothing, as `found_files` above: an answer
    // without its path cannot be told from the answer to the row before, and a
    // kind that is not one of the four is a word the page would have to guess
    // at. A missing `text` or `entries` is an empty one, which is what every
    // kind but its own carries anyway.
    if (!path || !kind ||
        (*kind != "text" && *kind != "directory" && *kind != "binary" &&
         *kind != "unreadable")) {
      return;
    }
    const std::string* text = message.FindString("text");
    const base::ListValue* listed = message.FindList("entries");
    std::vector<std::string> entries;
    if (listed) {
      entries.reserve(listed->size());
      for (const base::Value& entry : *listed) {
        if (const std::string* name = entry.GetIfString()) {
          entries.push_back(*name);
        }
      }
    }
    client_->FilePreview(*path, *kind, text ? *text : std::string(),
                         std::move(entries), arrival);
    return;
  }

  if (*type == "battery") {
    // DROPPED RATHER THAN DEFAULTED, which is the opposite of what `displays`
    // does two blocks up and is deliberate. A monitor the wrong way up is
    // still a desktop; a charge that defaulted to zero is a reading, and one
    // the bar would draw in red and flash. The whole reason this message
    // exists is that a plausible-looking default is indistinguishable from
    // the truth -- see the note on ControlChannelClient::Battery -- so a
    // message this cannot read is one to say nothing about.
    std::optional<double> charge = message.FindDouble("charge");
    std::optional<bool> charging = message.FindBool("charging");
    if (!charge || !charging) {
      return;
    }
    client_->Battery(*charge, *charging, arrival);
    return;
  }

  if (*type == "theme") {
    // REFUSED RATHER THAN DEFAULTED, which is `battery` above's answer rather
    // than `displays`'s, and for a sharper version of its reason. A theme
    // defaulted to dark is not a missing reading -- it is a *decision*, and one
    // that would repaint a desk somebody had just put into light. The desk is
    // already painting in one of the two, which is a better answer than the
    // other one picked by a name nothing here knows.
    const std::string* named = message.FindString("theme");
    if (!named) {
      return;
    }
    const std::optional<mojom::Theme> theme =
        ThemeFromWire<mojom::Theme>(*named);
    if (!theme) {
      return;
    }
    // The engine's own color scheme as well as the page's: the page repaints
    // the panels, and this is what a site's `prefers-color-scheme` reads.
    theme_sink_.Run(*theme);
    client_->ThemeChanged(*theme, arrival);
    return;
  }

  if (*type == "clipboard") {
    const base::ListValue* history = message.FindList("entries");
    if (!history) {
      return;
    }
    std::vector<mojom::ClipboardEntryPtr> entries;
    entries.reserve(history->size());
    for (const base::Value& row : *history) {
      const base::DictValue* entry = row.GetIfDict();
      if (!entry) {
        continue;
      }
      // A row with no id is one nothing could ask for again, and a row with no
      // preview is one nothing could draw -- so a malformed one is dropped
      // rather than carried with a zero in it, which would be a row that
      // pastes whatever the compositor happens to hold as entry 0.
      std::optional<int> id = entry->FindInt("id");
      const std::string* preview = entry->FindString("preview");
      if (!id || !preview) {
        continue;
      }
      entries.push_back(
          mojom::ClipboardEntry::New(static_cast<uint32_t>(*id), *preview));
    }
    // Sent even when it is empty, for the reason `displays` and `files` are: a
    // desktop nothing has been copied on is an answer, and a panel that never
    // heard one would wait for a message that has already been sent.
    client_->Clipboard(std::move(entries), arrival);
    return;
  }

  if (*type == "idle") {
    // DROPPED RATHER THAN DEFAULTED, for the reason `battery` above is and
    // more sharply: a missing field here has no reading to fall back on that
    // is not a guess about which way the desk went, and a guess that came out
    // false would clear a shell's lock screen over a desk nobody is at. A
    // message this cannot read is one to say nothing about.
    std::optional<bool> idle = message.FindBool("idle");
    if (!idle) {
      return;
    }
    client_->Idle(*idle, arrival);
    return;
  }

  if (*type == "focus_changed") {
    // Empty app_id means the chrome itself has focus, which is a state rather
    // than a missing field.
    const std::string* app_id = message.FindString("app_id");
    client_->FocusChanged(app_id ? *app_id : std::string(), arrival);
    return;
  }

  if (*type == "focus_requested") {
    // Unlike focus_changed, a missing app_id is malformed rather than an
    // answer: nothing but a client asks for the keyboard.
    const std::string* app_id = message.FindString("app_id");
    if (app_id) {
      client_->FocusRequested(*app_id, arrival);
    }
    return;
  }

  // What is left is the bands and copy-path protocol -- place_portal,
  // render_band, app_composited and their kin. Deliberately not implemented:
  // docs/architecture/ENGINE-FORK.md lists them under what the fork scraps,
  // because layout positions the layer now and the page has stopped reporting
  // where its own boxes are. Cementing them here would make a dying protocol
  // cost an engine release to remove.
}

void BindControlChannel(mojo::PendingReceiver<mojom::ControlChannel> receiver,
                        KeymapSink keymap_sink,
                        PointerWarpSink warp_sink,
                        ThemeSink theme_sink,
                        const std::string& screen) {
  const std::string socket_path =
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
          kDomicileControlSocketSwitch);
  if (socket_path.empty()) {
    // No socket means the engine was started without --domicile-control-socket.
    // Dropping the receiver closes the page's end, so a shell finds out rather
    // than talking into a channel that goes nowhere.
    LOG(ERROR) << "domicile: a page asked for the control channel but the "
                  "engine was started without --domicile-control-socket. The "
                  "shell will load and no window will respond.";
    return;
  }
  // Owns itself: it lives until the page drops the pipe or the compositor is
  // declared unreachable.
  new ControlChannel(socket_path, std::move(receiver), std::move(keymap_sink),
                     std::move(warp_sink), std::move(theme_sink), screen);
}

}  // namespace domicile
