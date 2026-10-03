import UIKit
import Capacitor

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
        // No Back key on an iPhone: a swipe in from a side edge is Back, sent
        // as the same "backButton" event the Android remote's Back sends.
        backGesture = SMCBackGesture(on: view) { [weak self] in
            self?.bridge?.plugin(withName: "App")?.notifyListeners("backButton", data: ["canGoBack": false])
        }
        fitTvLayout()
    }

    private var backGesture: SMCBackGesture?

    /// The height every SMC screen is designed for (CSS px), as on a TV.
    private static let tvHeightCss: CGFloat = 540

    /// SMC's TV layout on a phone, like Android phones get it (MainActivity
    /// fitTvLayoutOnTouchScreen): sideways, full screen, and the page zoomed
    /// so the screen is 540 CSS px tall. A screen that already has the room
    /// keeps its own size.
    private func fitTvLayout() {
        let screen = UIScreen.main.bounds.size
        let short = min(screen.width, screen.height)
        if short < Self.tvHeightCss { webView?.pageZoom = short / Self.tvHeightCss }
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
