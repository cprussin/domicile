// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/callback_list.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/browser_plugin_guest_delegate.h"
#include "content/public/browser/file_select_listener.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/host_zoom_map.h"
#include "content/public/browser/invalidate_type.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/common/tokens/tokens.h"
#include "third_party/blink/public/mojom/choosers/file_chooser.mojom-forward.h"
#include "third_party/blink/public/mojom/favicon/favicon_url.mojom-forward.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

namespace domicile {

// The page behind a <webview>, and the fork's whole guest-view layer.
//
// It is one object wearing three of content's hats, the way
// components/guest_view's GuestViewBase does -- and deliberately NOT that
// class: this fork depends on neither //extensions nor //components/guest_view,
// and the four virtuals of BrowserPluginGuestDelegate are almost the entire
// cost of staying that way.
//
// AND THE REST OF THAT COST IS A GUEST MANAGER THERE IS NOT. //components/
// guest_view is what installs one, so `ProfileImpl::GetGuestManager()` answers
// null here -- and content is not uniformly ready for that even though its own
// profile can return it. Attaching a guest builds a BrowserPluginEmbedder on
// the OWNER's WebContents, and two of that class's four methods walk the guest
// manager without checking: a plain Escape anywhere in the shell reached one of
// them and took the desktop down. Patch 0037 is the check, and
// `upstream/browser-plugin-embedder-null-guest-manager.md` is the bug it is.
// Expect the same shape from anything else in content that assumes a guest
// implies a manager.
//
//   BrowserPluginGuestDelegate  makes the inner WebContents a *guest*, which
//                               is what gives it a WebContentsViewChildFrame
//                               and no platform window of its own
//   WebContentsDelegate         everything a page can ask of its embedder --
//                               new windows, dialogs, permissions. Refusals
//                               for now, opened one at a time against a guard
//   WebContentsObserver         the guest's lifetime, which after attaching is
//                               this object's own
//
// WHY A GUEST AND NOT A FRAME. A <webview> is a frame owner, so before this
// existed the page inside it was a subframe: X-Frame-Options and CSP
// frame-ancestors applied and most of the web refused to load. A guest's main
// frame is a main frame -- AncestorThrottle walks GetParentOrOuterDocument(),
// which by contract does not cross the boundary into an embedder -- so both
// checks pass, back and forward work across a process change, and storage is
// first-party rather than partitioned as a third party. `guard-webview-
// framing.sh` is the assertion that a site refusing framing loads in one.
//
// NOT AttachGuestPage/GuestPageHolder, which is the nicer API and is unusable
// here: web_contents_impl.cc CHECKs features::kGuestViewMPArch, which is
// FEATURE_DISABLED_BY_DEFAULT at our pin. AttachInnerWebContents is what
// shipping <webview> and PDF use today; the migration is upstream's to lead.
//
// NO GUEST SiteInstance, and that is a decision rather than an omission. A
// guest SiteInstance requires a non-default StoragePartition -- extensions'
// <webview> is isolated on purpose -- and a browser window in a separate
// partition is a browser window where the user is logged out of everything.
// The cost is that content CHECKs a guest's SiteInstance agrees with its
// WebContents in WebContentsImpl::CreateNewWindow, which is why
// IsWebContentsCreationOverridden below returns true unconditionally: refusing
// the window is what keeps that CHECK unreached.
// What the embedder hangs on a guest's WebContents as it is made, before it is
// attached.
//
// A CALLBACK RATHER THAN THE HELPERS THEMSELVES, because the helpers are
// //chrome's -- SessionTabHelper's factory and extensions::TabHelper -- and
// this target must not depend on //chrome. The binder in //chrome hands one in
// with the WebViewGuestHost it binds; see //chrome/browser/domicile/
// domicile_tab_helpers.h for what it attaches and why.
using GuestCreatedCallback =
    base::RepeatingCallback<void(content::WebContents&)>;

class WebViewGuest : public mojom::WebViewGuest,
                     public content::BrowserPluginGuestDelegate,
                     public content::WebContentsDelegate,
                     public content::WebContentsObserver {
 public:
  // Create a guest for `placeholder`, a child frame of `owner`, and start
  // attaching it. `placeholder` is swapped out and destroyed by the attach.
  //
  // The guest exists from here on whether or not the attach completes: an
  // attach that is refused destroys it again, which is why this hands
  // ownership through the callback rather than keeping it anywhere.
  //
  // `created` runs once, on the guest's WebContents, before anything is
  // attached or navigated -- the moment a tab's helpers are attached in
  // Chrome, and for the same reason: a helper that keys on the tab's id has to
  // be there before the first navigation it would record.
  //
  // `popup_window` and `extension_popup` are the element's, from
  // CreateGuest: see popup_window() and extension_popup().
  static void CreateAndAttach(
      content::RenderFrameHost& owner,
      content::RenderFrameHost& placeholder,
      mojo::PendingReceiver<mojom::WebViewGuest> receiver,
      mojo::PendingRemote<mojom::WebViewGuestClient> client,
      std::optional<int> popup_window,
      bool extension_popup,
      const GuestCreatedCallback& created);

  WebViewGuest(const WebViewGuest&) = delete;
  WebViewGuest& operator=(const WebViewGuest&) = delete;

  ~WebViewGuest() override;

  // The guest behind `contents`, or null when `contents` is not one -- the
  // shell's own page, say. How //chrome finds its way here from a download,
  // which knows its WebContents and nothing about <webview>.
  static WebViewGuest* FromWebContents(content::WebContents* contents);

  // Ask the shell where a download from this guest's page goes.
  //
  // WHY A DOWNLOAD ASKS AT ALL. Chrome's own answer is a save dialog it draws
  // -- see RunFileChooser below for why that is not this desktop's -- so every
  // download is a question to the shell, the same one a page's
  // `<input type="file">` asks, in `kSave` mode. The profile prompts for every
  // one; see the patch that routes ChromeDownloadManagerDelegate here.
  //
  // `chosen` gets the absolute path, or nothing for a download the shell
  // canceled or never answered.
  void ChooseDownloadPath(
      const base::FilePath& suggested_path,
      base::OnceCallback<void(std::optional<base::FilePath>)> chosen);

  // Ask the shell for files on behalf of a dialog the browser would have
  // drawn for this guest's page -- the PDF viewer's save, a page's
  // showSaveFilePicker(). See
  // //chrome/browser/domicile/domicile_file_dialogs.h.
  //
  // `chosen` gets the absolute paths, as many as `mode` takes, or nothing for
  // a question the shell canceled or never answered.
  void ChooseFiles(
      mojom::WebViewFileChooserMode mode,
      const std::vector<std::string>& accept,
      const base::FilePath& suggested_path,
      base::OnceCallback<void(std::optional<std::vector<base::FilePath>>)>
          chosen);

  // WHAT chrome.tabs ASKS OF A BROWSER WINDOW, which is the shell's to carry
  // out: a window in front, a window closed, a second window opened. Each is
  // the element's event -- `domicile-focus-request`, `domicile-close`,
  // `domicile-new-window` -- exactly as if the page had asked. See
  // //chrome/browser/domicile/domicile_desk.h.
  void RequestFocus();
  void RequestClose();
  void RequestWindow(const GURL& url);

  // And a popup window opened, which is the element's
  // `domicile-popup-window`: chrome.windows.create's, for popup window
  // `window_id`. `width` and `height` are 0 where the extension asked for
  // none.
  void RequestPopupWindow(int window_id,
                          const GURL& url,
                          int width,
                          int height);

  // The popup window the element named this guest the tab of -- its
  // `popupwindow` attribute -- or nothing for every other <webview>. Read by
  // the desk as the guest becomes a tab, which is before it is attached.
  std::optional<int> popup_window() const { return popup_window_; }

  // Whether the element is an extension's action popup -- its
  // `extensionpopup` attribute -- which a guest is in place of a tab: what
  // Chrome's toolbar bubble is. Read as the guest is made, like
  // popup_window(). See //chrome/browser/domicile/domicile_tab_helpers.h.
  bool extension_popup() const { return extension_popup_; }

  // Hear the element take focus, for as long as the subscription is held.
  // What makes this guest the active tab.
  base::CallbackListSubscription AddFocusedCallback(
      base::RepeatingClosure focused);

  // THE PAGE'S ZOOM, as a factor, for chrome.tabs: what SetZoom below sets and
  // WebViewGuestClient.ZoomChanged reports, read and set by the browser rather
  // than the element. ZoomTo takes a factor already inside blink's range --
  // the desk refuses the rest (//components/domicile:desk_tabs's
  // DeskZoomFactor) -- and the element hears it as it would its own.
  double GetZoomFactor() const;
  void ZoomTo(double factor);

  // Hear the zoom the element is told change, from what it was to what it is,
  // for as long as the subscription is held. tabs.onZoomChange.
  using ZoomChangedCallback =
      base::RepeatingCallback<void(double old_factor, double new_factor)>;
  base::CallbackListSubscription AddZoomChangedCallback(
      ZoomChangedCallback changed);

  // mojom::WebViewGuest:
  void Navigate(const GURL& url) override;
  void Focused() override;

  // THE HISTORY A BROWSER WINDOW'S ADDRESS BAR DRIVES, and the reason it has
  // to be driven from here. `<webview>` is a frame owner, so the element has a
  // nested browsing context and a `History` in the renderer -- and that frame
  // is the placeholder, which has been on about:blank since it was made and
  // which the attach swapped out. The page the user sees is this guest, and
  // its history is a NavigationController in this process. So the four calls
  // travel, and the guest's own controller is what answers them.
  //
  // What that buys, beyond working at all: a guest's history is a page's, kept
  // across the process changes a cross-site navigation makes, where the
  // placeholder's was one frame's inside the shell's own session.
  void GoBack() override;
  void GoForward() override;
  void Stop() override;
  void Reload() override;
  void SetZoom(double factor) override;

  // FIND IN PAGE, on the guest's own WebContents -- so it is the guest's
  // FindRequestManager that runs it, every frame in the guest is searched, and
  // the replies come back to this observer's DidReceiveFindReply below rather
  // than to the shell's.
  void Find(const std::string& text, bool forward) override;
  void StopFinding(bool keep_selection) override;
  void ListDirectory(const std::string& path,
                     ListDirectoryCallback callback) override;

  // content::BrowserPluginGuestDelegate:
  content::WebContents* GetOwnerWebContents() override;
  content::RenderFrameHost* GetProspectiveOuterDocument() override;
  base::WeakPtr<content::BrowserPluginGuestDelegate> GetGuestDelegateWeakPtr()
      override;

  // content::WebContentsDelegate:
  //
  // WHERE A DESKTOP CHORD IS CAUGHT WHEN A BROWSER WINDOW HAS THE KEYBOARD,
  // and the reason there has to be somewhere. Both of the shell's own paths
  // die at once here: `<domicile-app>` is a portal element in the chrome's
  // document, so the shell sees every key a Wayland window is sent, but a
  // `<webview>` is a page of its own and `view.focus()` moves DOM focus into
  // it -- the shell's document is then told nothing, and neither is the
  // compositor, because the shell is what forwards keys to it. This runs for
  // the focused widget whichever frame owns it, which over a browser window is
  // the guest's, and it is the last layer above that page. On a match the key
  // is swallowed and the press goes back down the control channel; the
  // modifiers go every time, because a page that hears no keys hears no
  // modifier changes either and Alt is what a window is dragged with.
  //
  // A KEY NOBODY CLAIMED STOPS AT THE GUEST, which is measured rather than
  // assumed: `guard-webview-keyboard.sh` presses one before the window takes
  // the keyboard and one after, and the shell's document hears the first and
  // not the second. It is what content does with an unhandled key -- it comes
  // back to *this* WebContents' delegate in
  // WebContentsImpl::HandleKeyboardEvent, and there is no path from there into
  // the embedder's renderer. So this hook is not one of two ways a claimed
  // chord reaches the shell over a browser window. It is the only one. An
  // UNCLAIMED chord the page left alone comes back too, later and by another
  // door -- HandleKeyboardEvent below -- which is how a browser window's
  // chrome binds Ctrl+R.
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      content::WebContents* source,
      const input::NativeWebKeyboardEvent& event) override;

  // AND WHERE A KEY THE PAGE LEFT ALONE GOES NEXT, which is the shell. Content
  // calls this only for a press the page did not preventDefault, which is
  // Chrome's own order: a site binds a chord first, and the browser's command
  // runs only if it did not. Chords only -- see UnhandledKeyDown in
  // components/domicile/mojom/web_view_guest.mojom for why a plain key is not
  // sent. Returns false, because this process did nothing with the key: what
  // the shell does is its own, and asynchronous.
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override;

  // Ctrl and the wheel over the page, which the page did not take. Reported
  // rather than applied -- see ZoomRequested in the mojom.
  void ContentsZoomChange(bool zoom_in) override;

  // A RIGHT CLICK IS THE PAGE'S AND THE SHELL'S, NEVER THE BROWSER'S. The
  // page's own `contextmenu` event has already fired by the time this runs,
  // so a site's menu still works; claiming the rest is what stops content
  // drawing Chrome's menu -- back, reload, inspect -- over a desktop.
  bool HandleContextMenu(content::RenderFrameHost& render_frame_host,
                         const content::ContextMenuParams& params) override;

  // WHERE AN ADDRESS BAR'S DEAD BUTTON IS NOTICED. `CanGoBack()` and
  // `CanGoForward()` are the guest's NavigationController's to answer and this
  // process is the only one that can ask, so the renderer is told instead --
  // and this is the hook that says when to tell it. Chrome's own back and
  // forward buttons are driven from the same call: NavigationControllerImpl
  // reports INVALIDATE_TYPE_ALL from NotifyNavigationEntryCommitted and from
  // every other mutation of the entry list, so a commit, a prune and a
  // replacement all arrive here.
  //
  // THE FLAGS ARE NOT READ, deliberately. A title, a favicon and an audio
  // state come through this same call, and none of them says whether the
  // history moved; what decides that is comparing the pair against the last
  // one sent, which ReportHistory does. Reading the flags instead would be
  // trusting a signal that means "some browser UI is stale" to mean something
  // narrower than it does.
  void NavigationStateChanged(content::WebContents* source,
                              content::InvalidateTypes changed_flags) override;

  // AND WHERE AN ADDRESS BAR LEARNS A PAGE IS STILL ARRIVING. This is the call
  // Chrome drives its own throbber from, and `should_show_loading_ui` is the
  // reason it rather than WebContentsObserver::DidStartLoading: the flag is
  // false for a same-document navigation -- a fragment, a pushState -- which
  // is a load no browser spins for, and the observer pair cannot tell one from
  // an ordinary navigation.
  //
  // READ TOGETHER WITH IsLoading(), the way Chrome's own browser window reads
  // them: the flag says whether this kind of load is worth showing and
  // IsLoading() says whether one is happening, and a spinner wants both.
  void LoadingStateChanged(content::WebContents* source,
                           bool should_show_loading_ui) override;

  // A page in a browser window asking for a second one -- target="_blank", a
  // window.open, a form at an unopened target name.
  //
  // THE WINDOW IS STILL REFUSED HERE, AND THE ELEMENT IS TOLD. Overridden
  // rather than left to the default because the default is content creating the
  // window itself, and for a guest with no guest SiteInstance that path CHECKs
  // -- see the class comment. So CreateCustomWebContents returns null as it
  // always did, and sends NewWindowRequested on the way: the shell opens a
  // browser window of its own at that address, which is the layer that knows
  // where a window goes. What that costs -- the opener, the handle, a POST body
  // -- is written down beside the message in
  // components/domicile/mojom/web_view_guest.mojom.
  bool IsWebContentsCreationOverridden(
      content::RenderFrameHost* opener,
      content::SiteInstance* source_site_instance,
      content::mojom::WindowContainerType window_container_type,
      const GURL& opener_url,
      const std::string& frame_name,
      const GURL& target_url) override;
  content::WebContents* CreateCustomWebContents(
      content::RenderFrameHost* opener,
      content::SiteInstance* source_site_instance,
      bool is_new_browsing_instance,
      const GURL& opener_url,
      const std::string& frame_name,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      const content::StoragePartitionConfig& partition_config,
      content::SessionStorageNamespaceHandle* session_storage_namespace) override;

  // A NAVIGATION THE PAGE COULD NOT PERFORM ITSELF, handed to the browser to
  // do on its behalf.
  //
  // Not every navigation a page asks for is its own renderer's to make. A link
  // inside a frame from another site lives in another process, and
  // `target="_top"` asks it to navigate the page around it -- which it cannot
  // touch. Blink hands that to the browser, which arrives here. The same call
  // carries a middle or Ctrl click, and a `window.open` naming a context that
  // already exists.
  //
  // CONTENT'S DEFAULT IS TO DO NOTHING AND RETURN NULL, which is why this is
  // here at all: for as long as it was not overridden, every one of those was a
  // click that did nothing whatsoever -- no window, no error, nothing in any
  // page to notice. Sign-in flows are full of them, which is how it was found.
  //
  // A CURRENT-TAB DISPOSITION IS THIS GUEST'S TO PERFORM, and it performs it:
  // the address goes to the guest's own NavigationController, which is the
  // thing the page was asking to move. Everything that asks for a SECOND window
  // is reported to the shell instead, exactly as CreateCustomWebContents does
  // -- see ReportNewWindow.
  //
  // WHAT THE SHELL IS NOT TOLD is that the window went somewhere: an address
  // bar still shows where the shell SENT the window rather than where its page
  // then went, which is ROADMAP.md's standing gap about the address bar and not
  // this one. Nothing here makes it worse; a routed navigation is exactly as
  // invisible as a link the page followed by itself.
  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override;

  // A PAGE ASKING FOR A FILE, AND THE SHELL IS WHAT ANSWERS.
  //
  // Content's default cancels every one, which made `<input type="file">` a
  // button that did nothing. Chrome's answer is FileSelectHelper, which opens
  // a dialog through the desktop portal -- a GTK window the shell did not draw
  // and cannot place, over a desktop whose rule is that the browser draws no
  // UI of its own. So the question goes to the element as FileChooserRequested
  // and the shell draws the picker.
  //
  // WHAT CONTENT DOES WITH THE ANSWER is its own: FileChooserImpl grants the
  // renderer read access to each path -- write, for a save -- when the
  // listener is told. A folder upload is the one mode this has to finish by
  // hand, because the page wants the files under the folder and not the folder.
  void RunFileChooser(content::RenderFrameHost* render_frame_host,
                      scoped_refptr<content::FileSelectListener> listener,
                      const blink::mojom::FileChooserParams& params) override;

  // THE PAGE CALLED window.close(), and its renderer let it. Content's
  // default does nothing, so a popup that closed itself -- an extension's,
  // which is how every one of them says it is done -- sat open until the user
  // clicked away. The element is told instead, and removing it is the shell's
  // answer: the guest's WebContents is owned by the outer one it is attached
  // to, and destroying it from here would pull a frame out from under the
  // shell's document. See CloseRequested in the mojom.
  void CloseContents(content::WebContents* source) override;

  // Asks the guest's current page to report its content's size.
  void EnablePreferredSize();

  // The page's content changed size. PrimaryPageChanged asks each page's
  // renderer to report it, and content forwards only a change. See
  // ContentSizeChanged in the mojom.
  void UpdatePreferredSize(content::WebContents* web_contents,
                           const gfx::Size& pref_size) override;

  // content::WebContentsObserver:
  void WebContentsDestroyed() override;

  // What a Find above found, in as many replies as the count takes to settle.
  // A reply to a find that has since been stopped, or replaced by a search for
  // other text, is dropped: it describes a search the element is no longer
  // showing. Chrome's FindTabHelper drops the same ones.
  void DidReceiveFindReply(int request_id,
                           int number_of_matches,
                           const gfx::Rect& selection_rect,
                           int active_match_ordinal,
                           bool final_update) override;

  // WHERE A LOCK STOPS BEING A GUESS. This is the call Chrome's own
  // SecurityStateTabHelper is driven by: content fires it when the certificate,
  // the mixed-content status or anything else the omnibox draws from changes,
  // including on a page that never navigated -- a subresource with a cert error
  // arriving after the commit is exactly that, and it is the case a chrome
  // reading only navigations would show a clean lock over.
  //
  // PAIRED WITH NavigationStateChanged ABOVE RATHER THAN REPLACING IT. The
  // address moves on a navigation and the level moves on either, so both hooks
  // funnel into ReportPage and the comparison there is what keeps one message
  // per real change.
  void DidChangeVisibleSecurityState() override;

  // The icons the page links, which the renderer reports once its head is
  // parsed and again whenever a script changes them. Reduced to the one a
  // launcher draws best and reported to the element -- see FaviconChanged in
  // the mojom.
  void DidUpdateFaviconURL(
      content::RenderFrameHost* render_frame_host,
      const std::vector<blink::mojom::FaviconURLPtr>& candidates,
      blink::mojom::FaviconUpdateReason reason) override;

  // A new page, which has named no icon yet: the last page's is withdrawn, so
  // it is not taken for this one's -- and a page that never names one (the
  // renderer reports nothing then) is not left wearing it. And a find ends,
  // which is Chrome's rule: the matches it counted were the last page's. And
  // its renderer is asked to report its content's size, which a renderer the
  // navigation swapped in has not been asked yet.
  void PrimaryPageChanged(content::Page& page) override;

 private:
  WebViewGuest(content::RenderFrameHost& owner,
               mojo::PendingReceiver<mojom::WebViewGuest> receiver,
               mojo::PendingRemote<mojom::WebViewGuestClient> client,
               std::optional<int> popup_window,
               bool extension_popup);

  // Tell the element a page asked for a window of its own, at `target_url`.
  //
  // ONE PLACE, because two different questions arrive at the same answer: a
  // page asking content to CREATE a window (CreateCustomWebContents) and a
  // navigation routed here with a disposition that wants one (OpenURLFromTab).
  // Both are refused in this process and both are the shell's to open, so the
  // rule about what is worth reporting -- an address, and never a window with
  // none -- is written once.
  void ReportNewWindow(const GURL& target_url);

  // Tell the element what back and forward can do, if it has changed.
  //
  // `CanGoBack()` RATHER THAN `ShouldEnableBackButton()`, which is the other
  // answer the controller offers and the wrong one here. They differ over a
  // history whose only remaining entries are skippable: Chrome lights the
  // button anyway, because a long press there opens a menu the user can pick
  // an entry out of, while a plain click does nothing. A Domicile shell has no
  // such menu -- it has `goBack()`, which is `NavigationController::GoBack`,
  // which returns without navigating exactly when `CanGoBack()` is false. So
  // reporting ShouldEnableBackButton() would light the one button this whole
  // interface exists to gray out.
  void ReportHistory();

  // Tell the element where the page is and what the browser says about the
  // connection behind it, if either has changed.
  //
  // ONE READ OF ONE ENTRY, and that is the correctness property rather than an
  // efficiency one. `GetVisibleEntry()` is what Chrome's own omnibox shows and
  // what `GetVisibleSecurityState` computes its level from, so taking both from
  // it means the address and the lock always describe the same page. Reading
  // them from different places -- the committed URL beside a visible level, say
  // -- is how an address bar comes to draw a padlock next to an address it does
  // not belong to.
  void ReportPage();

  // Tell the element whether a page is on its way, if that has changed.
  //
  // THE SAME DEDUPLICATION ReportHistory does, and it earns it twice over
  // here: LoadingStateChanged is called for a load starting, for one
  // finishing, and for navigations that change neither answer, so an
  // unfiltered forward would put a DOM event in the shell's page for each of
  // them.
  void ReportLoading(bool should_show_loading_ui);

  // Tell the element the page's zoom, if it has changed.
  //
  // THREE THINGS MOVE IT and all three land here: the shell setting it, the
  // site's zoom changing under another window -- HostZoomMap keys it by host,
  // so a second window on the same site moves this one -- and a navigation to
  // a site zoomed differently. The comparison is what keeps that to one
  // message per real change.
  void ReportZoom();

  // Tell the element what the find has found, if that has changed. `0, 0` is
  // no find at all, which is where a fresh guest starts.
  void ReportFind(int matches, int active_match);

  // Forget the find in progress, so that replies still on their way to it are
  // dropped and the next Find is a new search, and tell the element.
  void EndFind();

  // `answer`, held open: counted in `open_choosers_` until it runs. Static
  // over a weak pointer, because the answer must run whether or not the guest
  // is still here -- see FilesChosen.
  mojom::WebViewGuestClient::FileChooserRequestedCallback HeldOpen(
      mojom::WebViewGuestClient::FileChooserRequestedCallback answer);
  static void ChooserAnswered(
      base::WeakPtr<WebViewGuest> guest,
      mojom::WebViewGuestClient::FileChooserRequestedCallback answer,
      const std::optional<std::vector<std::string>>& paths);

  // The second half of CreateAndAttach, once content has produced a frame that
  // is safe to swap. `outer_contents_frame` is null when the frame went away
  // or a beforeunload handler under it said no, and dropping `guest` is then
  // the whole of the cleanup.
  static void Attach(std::unique_ptr<WebViewGuest> guest,
                     content::RenderFrameHost* outer_contents_frame);

  // Ours until Attach hands it to the outer WebContents, which is also the
  // moment this object stops being owned and starts owning itself.
  std::unique_ptr<content::WebContents> owned_guest_contents_;
  raw_ptr<content::WebContents> guest_contents_ = nullptr;

  // The <webview>'s document. An id rather than a pointer because a guest
  // outlives nothing and this must not be the reason it does.
  content::GlobalRenderFrameHostId owner_rfh_id_;

  // Set by Attach. Self-destruction in WebContentsDestroyed is only correct
  // once nobody else holds a unique_ptr to this.
  bool self_owned_ = false;

  // See popup_window().
  const std::optional<int> popup_window_;

  // See extension_popup().
  const bool extension_popup_;

  mojo::Receiver<mojom::WebViewGuest> receiver_;
  // How many of this guest's file choosers the shell has yet to answer, which
  // is when ListDirectory answers at all.
  size_t open_choosers_ = 0;

  // The element, for as long as it lives. Bound from the CreateGuest that made
  // this guest, so there is no moment at which the guest has a history and
  // nothing to report it to.
  mojo::Remote<mojom::WebViewGuestClient> client_;

  // The last pair sent, so that a call reporting a title change does not
  // become a message and then a DOM event. False both, because that is what a
  // guest with no entries behind or ahead of it can do and what the element
  // starts out holding -- so a fresh guest's first page changes nothing and
  // sends nothing, which is correct rather than a dropped first message.
  bool reported_can_go_back_ = false;
  bool reported_can_go_forward_ = false;

  // And the last loading answer sent, false for the reason the pair above are:
  // a guest that has not been asked for a page is not fetching one, and
  // neither is the element that has not heard from it.
  bool reported_loading_ = false;

  // And the last address and security sent. Empty and neutral to start, which
  // is what a guest showing its initial entry is: GetVisibleSecurityState
  // declines to describe that entry at all, so a fresh guest's first read is
  // this pair and it does not spend a message saying so.
  GURL reported_url_;
  mojom::WebViewSecurity reported_security_ =
      mojom::WebViewSecurity::kNeutral;

  // And the last zoom sent, as a factor. 100%, because that is where a fresh
  // guest is and what the element starts out holding.
  double reported_zoom_ = 1.0;

  // And the last icon sent. Empty, which is a page that has named none yet.
  GURL reported_favicon_;

  // The text the find in progress is searching for, empty while there is
  // none. What decides whether a Find is the next match or a new search.
  std::u16string find_text_;

  // The id of the find request that began the search in progress: a reply
  // older than that is about a search the element has moved on from. Content
  // hands out the ids, counting up for the guest's life.
  int find_session_id_ = 0;

  // And the last count sent. Zero and zero, which is no find, for the reason
  // the pair above starts false.
  int reported_find_matches_ = 0;
  int reported_find_active_match_ = 0;

  // HostZoomMap's word that a site's zoom changed, which is how a second
  // window on the same site moves this one. Dropped with the guest's
  // WebContents, because a report is read off that.
  base::CallbackListSubscription zoom_subscription_;

  // Who hears the element take focus. See AddFocusedCallback.
  base::RepeatingClosureList focused_callbacks_;

  // Who hears the zoom change. See AddZoomChangedCallback.
  base::RepeatingCallbackList<void(double, double)> zoom_callbacks_;

  base::WeakPtrFactory<WebViewGuest> weak_factory_{this};
};

// Bind WebViewGuestHost for `frame`: the interface a <webview> asks for a
// guest over.
//
// THIS IS NOT THE ACCESS CONTROL, for the same reason BindControlChannel is
// not. The caller decides who may reach it -- registering it only for a
// document whose origin is domicile:// -- and that decision is the whole of
// the security property. See PopulateChromeFrameBinders.
//
// `created` is run on every guest this host makes -- see GuestCreatedCallback.
void BindWebViewGuestHost(
    content::RenderFrameHost* frame,
    mojo::PendingReceiver<mojom::WebViewGuestHost> receiver,
    GuestCreatedCallback created);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_
