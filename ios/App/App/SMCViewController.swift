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
    }

    private var backGesture: SMCBackGesture?
}
