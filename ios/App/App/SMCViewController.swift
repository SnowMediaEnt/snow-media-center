import UIKit
import Capacitor
import WebKit

/// The app's one screen: Capacitor's WebView plus our own native plugins.
/// Capacitor 7 doesn't discover plugins compiled into the app target, so each
/// one is registered here (Android does the same in MainActivity).
class SMCViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        // The native player draws under the page, like the Android TextureView:
        // the WebView has to be see-through for the picture to show.
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
        // No background on `view`: Capacitor's `view` IS the WebView, and
        // WebKit copies its background onto the page's content view, which
        // then covers the picture. The black behind the see-through page is
        // the player's host view instead (SnowPlayerPlugin.slotHostView).
        // The native player (VLC). Its picture goes under the page, inside
        // the WebView below its scroll view.
        bridge?.registerPluginInstance(SnowPlayerPlugin())
        // No Back key on an iPhone: a swipe in from a side edge is Back.
        backGesture = SMCBackGesture(on: view) { [weak self] in self?.pressBack() }
        fitTvLayout()
    }

    private var backGesture: SMCBackGesture?

    /// The page's Back key, as the phone remote sends it on the web
    /// (phoneRemote.ts syntheticKey): an Escape keydown/keyup at the focused
    /// element. True when a handler took it (preventDefault).
    private static let backKeyJs = """
    (function () {
      var t = document.activeElement || document.body;
      function key(type) {
        var e = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        try {
          Object.defineProperty(e, 'keyCode', { get: function () { return 27; } });
          Object.defineProperty(e, 'which', { get: function () { return 27; } });
        } catch (x) {}
        return e;
      }
      var handled = !t.dispatchEvent(key('keydown'));
      t.dispatchEvent(key('keyup'));
      return handled;
    })()
    """

    /// One press of the remote's Back, the way Android delivers it: the key
    /// goes to the page first (popups, the Player's ladder and most screens
    /// listen for the key), and only a press nobody took becomes the system
    /// Back, Capacitor's "backButton" event (useNavigation and the screens
    /// that listen for that).
    private func pressBack() {
        guard let web = webView else { return }
        web.evaluateJavaScript(Self.backKeyJs) { [weak self] result, _ in
            if (result as? Bool) == true { return }
            self?.bridge?.plugin(withName: "App")?.notifyListeners("backButton", data: ["canGoBack": false])
        }
    }

    /// The height every SMC screen is designed for (CSS px), as on a TV.
    private static let tvHeightCss: CGFloat = 540

    /// SMC's TV layout on a phone, like Android phones get it (MainActivity
    /// fitTvLayoutOnTouchScreen): sideways, full screen, and the page laid out
    /// so the screen is 540 CSS px tall. A screen that already has the room
    /// keeps its own size. Done with the page's viewport (a wider layout
    /// viewport at a fixed scale, as in Safari): WKWebView's pageZoom only
    /// shrinks the picture into a corner, it doesn't lay the page out wider.
    /// Runs before the first load (capacitorDidLoad comes before loadWebView).
    private func fitTvLayout() {
        let screen = UIScreen.main.bounds.size
        let short = min(screen.width, screen.height)
        let long = max(screen.width, screen.height)
        guard short < Self.tvHeightCss else { return }
        let scale = short / Self.tvHeightCss
        let width = Int((long / scale).rounded())
        let content = "width=\(width), initial-scale=\(scale), minimum-scale=\(scale), maximum-scale=\(scale), user-scalable=no, viewport-fit=cover"
        let js = """
        (function () {
          var m = document.querySelector('meta[name="viewport"]');
          if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
          m.content = '\(content)';
        })();
        """
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
