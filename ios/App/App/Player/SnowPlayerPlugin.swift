import UIKit
import AVFoundation
import Capacitor
import MobileVLCKit

/// The native player, iOS edition: the same "SnowPlayer" plugin the Android
/// app has (SnowPlayerPlugin.kt, Media3/ExoPlayer), here on VLC (MobileVLCKit),
/// which plays the raw MPEG-TS channels and MKV films AVPlayer can't. The
/// contract is src/capacitor/SnowPlayer.ts: the same methods, events, units
/// (seconds) and slots keyed by `screenId` ("main" unless said).
///
/// The picture goes under the page. Capacitor makes the WKWebView the view
/// controller's own view, so there is nothing beside it to go under: the
/// players' host view is the WebView's bottom-most subview instead, below its
/// scroll view, and the see-through page draws its controls over the picture
/// exactly as over Android's TextureView.
///
/// Compiled into the app target, so SMCViewController registers it.
@objc(SnowPlayerPlugin)
public class SnowPlayerPlugin: CAPPlugin, CAPBridgedPlugin, SnowSlotOwner {
    public let identifier = "SnowPlayerPlugin"
    public let jsName = "SnowPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setResizeMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getResizeMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioTracks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSubtitleTracks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSubtitleTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDecoderInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEngines", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftWipe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftSeek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftGoLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "timeshiftUsage", returnType: CAPPluginReturnPromise),
    ]

    private static let main = SnowPlayerSlot.mainId

    // Main thread only, like every slot.
    private var slots: [String: SnowPlayerSlot] = [:]
    private var hostView: UIView?
    private var ticker: DispatchSourceTimer?
    private var observers: [NSObjectProtocol] = []
    private var vlcReady = false

    override public func load() {
        // Sound with the silent switch on, like any video app.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
        SnowPlayerSlot.clearSubtitleFolder()
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.slots.values.forEach { $0.pauseForBackground() }
        })
        observers.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.slots.values.forEach { $0.resumeFromBackground() }
        })
        // The black under the see-through page from the first frame (no
        // white flash), before anything has played.
        _ = slotHostView()
    }


    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        ticker?.cancel()
    }

    // MARK: - Playback

    @objc func load(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("url required")
            return
        }
        let live = call.getBool("live") ?? call.getBool("isLive") ?? true
        let start = number(call, "startPosition") ?? 0
        let engine = call.getString("engine") ?? "exo"
        let subs = sidecars(call.getArray("subtitles"))
        let id = screenId(call)
        DispatchQueue.main.async {
            // mpv is an Android owner-build engine; asked for on a channel,
            // say it isn't here (EngineChoice.NOT_IN_BUILD) and play on.
            if engine == "mpv" && id == Self.main && live {
                self.notifyListeners("engineFallback", data: ["screenId": id, "reason": "not-in-build"])
            }
            self.prepareVLC()
            try? AVAudioSession.sharedInstance().setActive(true)
            if let reason = self.slot(id).load(url: url, live: live, subtitles: subs, startSec: start) {
                call.reject(reason)
                return
            }
            self.streamingChanged()
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            self.slots[id]?.play()
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            self.slots[id]?.pause()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            if let s = self.slots[id] {
                // A tile gives everything back; the main player keeps its box.
                if id == Self.main { s.stop() } else { s.release() }
            }
            self.streamingChanged()
            call.resolve()
        }
    }

    @objc func stopAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            for (id, s) in self.slots {
                if id == Self.main { s.stop() } else { s.release() }
            }
            self.streamingChanged()
            call.resolve()
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let id = screenId(call)
        let pos = number(call, "position") ?? 0
        DispatchQueue.main.async {
            self.slots[id]?.seek(toSec: max(0, pos))
            call.resolve()
        }
    }

    @objc func getPosition(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            let p = self.slots[id]?.position() ?? (position: 0, duration: 0, playing: false)
            call.resolve(["position": p.position, "duration": p.duration, "playing": p.playing])
        }
    }

    @objc func setRect(_ call: CAPPluginCall) {
        let id = screenId(call)
        let x = number(call, "x") ?? 0
        let y = number(call, "y") ?? 0
        let w = number(call, "width") ?? 0
        let h = number(call, "height") ?? 0
        let cssW = number(call, "cssW") ?? 0
        let cssH = number(call, "cssH") ?? 0
        let fullscreen = call.getBool("fullscreen") ?? false
        let blank = call.getBool("blank") ?? false
        DispatchQueue.main.async {
            self.slot(id).setRect(x: x, y: y, width: w, height: h, cssW: cssW, cssH: cssH, fullscreen: fullscreen, blank: blank)
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let id = screenId(call)
        let v = number(call, "volume") ?? 1
        DispatchQueue.main.async {
            self.slot(id).setVolume(v)
            call.resolve()
        }
    }

    @objc func setResizeMode(_ call: CAPPluginCall) {
        let id = screenId(call)
        let mode = (call.getString("mode") ?? "fit").lowercased()
        guard SnowPlayerSlot.formats.contains(mode) else {
            call.reject("Unknown mode '\(mode)'. Expected one of: \(SnowPlayerSlot.formats.joined(separator: ", "))")
            return
        }
        DispatchQueue.main.async {
            self.slot(id).setFormat(mode)
            call.resolve(["mode": mode])
        }
    }

    @objc func getResizeMode(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            call.resolve(["mode": self.slot(id).format])
        }
    }

    @objc func setAudioEnabled(_ call: CAPPluginCall) {
        let id = screenId(call)
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            self.slot(id).setAudioEnabled(enabled)
            call.resolve()
        }
    }

    // MARK: - Tracks

    @objc func getAudioTracks(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            call.resolve(["tracks": self.slots[id]?.audioTracks() ?? []])
        }
    }

    @objc func setAudioTrack(_ call: CAPPluginCall) {
        let id = screenId(call)
        let track = call.getString("id")
        DispatchQueue.main.async {
            if let track = track { self.slots[id]?.selectAudio(track) }
            call.resolve()
        }
    }

    @objc func getSubtitleTracks(_ call: CAPPluginCall) {
        let id = screenId(call)
        DispatchQueue.main.async {
            call.resolve(["tracks": self.slots[id]?.subtitleTracks() ?? []])
        }
    }

    @objc func setSubtitleTrack(_ call: CAPPluginCall) {
        let id = screenId(call)
        let track = call.getString("id")
        DispatchQueue.main.async {
            if let track = track { self.slots[id]?.selectSubtitle(track) }
            call.resolve()
        }
    }

    // MARK: - Diagnostics

    /// VLC decodes Dolby (AC-3/E-AC-3), DTS and TrueHD in software, which is
    /// what the Android FFmpeg extension is there for.
    @objc func getDecoderInfo(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.prepareVLC()
            let version = VLCLibrary.shared().version.split(separator: " ").first.map(String.init) ?? ""
            #if arch(arm64)
            let abis = ["arm64"]
            #else
            let abis = ["x86_64"]
            #endif
            call.resolve([
                "ffmpegAvailable": true,
                "ffmpegVersion": "LibVLC \(version)",
                "abis": abis,
                "device": "Apple \(SnowProcess.machine)",
                "sdk": ProcessInfo.processInfo.operatingSystemVersion.majorVersion,
            ])
        }
    }

    @objc func getStats(_ call: CAPPluginCall) {
        let id = screenId(call)
        let memory = call.getBool("memory") ?? false
        DispatchQueue.main.async {
            call.resolve(self.slots[id]?.stats(memory: memory) ?? SnowPlayerSlot.emptyStats(memory: memory))
        }
    }

    /// mpv is an Android owner-build engine; never here.
    @objc func getEngines(_ call: CAPPluginCall) {
        call.resolve(["mpv": ["available": false, "reason": "not-in-build"]])
    }

    // MARK: - Rewind live TV: not on iPhone yet

    private func timeshiftUnavailable() -> [String: Any] {
        // No reason: the WebView shows its own "not available" words.
        return ["state": "unavailable", "mode": "live", "availableSec": 0.0, "behindSec": 0.0, "usedBytes": 0]
    }

    @objc func timeshiftStart(_ call: CAPPluginCall) { call.resolve() }
    @objc func timeshiftStop(_ call: CAPPluginCall) { call.resolve() }
    @objc func timeshiftWipe(_ call: CAPPluginCall) { call.resolve() }
    @objc func timeshiftStatus(_ call: CAPPluginCall) { call.resolve(timeshiftUnavailable()) }
    @objc func timeshiftSeek(_ call: CAPPluginCall) { call.resolve(timeshiftUnavailable()) }
    @objc func timeshiftGoLive(_ call: CAPPluginCall) { call.resolve(timeshiftUnavailable()) }

    @objc func timeshiftUsage(_ call: CAPPluginCall) {
        var free: Int64 = 0
        var total: Int64 = 0
        if let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
           let v = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]) {
            free = v.volumeAvailableCapacityForImportantUsage ?? 0
            total = Int64(v.volumeTotalCapacity ?? 0)
        }
        call.resolve(["usedBytes": 0, "freeBytes": free, "totalBytes": total])
    }

    // MARK: - SnowSlotOwner

    func slot(_ slot: SnowPlayerSlot, emit event: String, _ data: [String: Any]) {
        notifyListeners(event, data: data)
    }

    /// The host of every slot's box: the WebView's bottom-most subview, under
    /// its scroll view (and so under the page), the WebView's full size. It
    /// is what the see-through page shows black over when nothing plays.
    func slotHostView() -> UIView? {
        guard let webView = bridge?.webView else { return nil }
        let host: UIView
        if let h = hostView {
            host = h
        } else {
            host = UIView(frame: webView.bounds)
            host.backgroundColor = .black
            host.isUserInteractionEnabled = false
            host.clipsToBounds = true
            host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            hostView = host
        }
        if host.superview !== webView {
            host.frame = webView.bounds
            webView.insertSubview(host, at: 0)
        } else if webView.subviews.first !== host {
            webView.sendSubviewToBack(host)
        }
        return host
    }

    // MARK: - Helpers

    private func slot(_ id: String) -> SnowPlayerSlot {
        if let s = slots[id] { return s }
        let s = SnowPlayerSlot(screenId: id, owner: self)
        slots[id] = s
        return s
    }

    private func screenId(_ call: CAPPluginCall) -> String {
        return call.getString("screenId") ?? Self.main
    }

    /// A number however the bridge hands it over (an Int or a Double).
    private func number(_ call: CAPPluginCall, _ key: String) -> Double? {
        return (call.options[key] as? NSNumber)?.doubleValue
    }

    private func sidecars(_ list: JSArray?) -> [SnowSidecarRequest] {
        guard let list = list else { return [] }
        return list.compactMap { value -> SnowSidecarRequest? in
            guard let o = value as? JSObject, let s = o["url"] as? String,
                  !s.trimmingCharacters(in: .whitespaces).isEmpty, let url = URL(string: s) else { return nil }
            return SnowSidecarRequest(
                url: url,
                lang: o["lang"] as? String ?? "",
                label: o["label"] as? String ?? "",
                mime: o["mime"] as? String ?? ""
            )
        }
    }

    /// VLCMedia is made on VLC's shared library: silence its log too.
    private func prepareVLC() {
        guard !vlcReady else { return }
        vlcReady = true
        SnowVLCSilentLogger.silence(VLCLibrary.shared())
    }

    /// Screen kept awake while anything streams (Android FLAG_KEEP_SCREEN_ON),
    /// and the slots looked at while anything does.
    private func streamingChanged() {
        let streaming = slots.values.contains { $0.isStreaming }
        UIApplication.shared.isIdleTimerDisabled = streaming
        if streaming {
            guard ticker == nil else { return }
            let t = DispatchSource.makeTimerSource(queue: .main)
            t.schedule(deadline: .now() + SnowTuning.tick, repeating: SnowTuning.tick)
            t.setEventHandler { [weak self] in
                guard let self = self else { return }
                let now = CACurrentMediaTime()
                self.slots.values.forEach { $0.tick(now) }
            }
            t.resume()
            ticker = t
        } else {
            ticker?.cancel()
            ticker = nil
        }
    }
}
