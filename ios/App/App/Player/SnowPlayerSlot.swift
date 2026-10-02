import UIKit
import MobileVLCKit

/// The black box one slot's picture sits in (the Android container
/// FrameLayout). It tells the slot when its size changes, because "fill" and
/// "zoom" are worked out against the box's shape.
final class SnowVideoBox: UIView {
    var onResize: (() -> Void)?
    private var laidOutSize = CGSize.zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laidOutSize else { return }
        laidOutSize = bounds.size
        onResize?()
    }
}

/// What a slot needs from the plugin.
protocol SnowSlotOwner: AnyObject {
    func slot(_ slot: SnowPlayerSlot, emit event: String, _ data: [String: Any])
    /// The view every slot's box goes in: under the page, inside the WebView.
    func slotHostView() -> UIView?
}

/// A sidecar subtitle asked for at load (Plex external subtitles).
struct SnowSidecarRequest {
    let url: URL
    let lang: String
    let label: String
    let mime: String
}

/// One player slot, keyed by screenId ("main", or a Multi-Screen tile), the
/// iOS twin of the Android PlayerSlot. It owns a box under the page, a VLC
/// library (its log goes nowhere), and for each start of a stream a fresh
/// VLCMediaPlayer drawing into a fresh view, so nothing a stream that has
/// been replaced still reports can reach the next one.
///
/// Everything here runs on the main thread. VLC's own callbacks are moved
/// there first.
final class SnowPlayerSlot: NSObject, VLCMediaPlayerDelegate {
    static let mainId = "main"
    static let formats = ["fit", "fill", "zoom", "wide"]

    private static let ioBadHttp = "ERROR_CODE_IO_BAD_HTTP_STATUS"
    private static let ioConnFailed = "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED"
    private static let ioTimeout = "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT"
    private static let ioUnspecified = "ERROR_CODE_IO_UNSPECIFIED"

    /// Old players are stopped here: VLC's stop waits for its input thread,
    /// which can sit in a network read for a while, and must never hold up
    /// the screen.
    private static let teardownQueue = DispatchQueue(label: "SnowPlayer.teardown", qos: .userInitiated, attributes: .concurrent)

    let screenId: String
    private weak var owner: SnowSlotOwner?
    var isMain: Bool { screenId == Self.mainId }

    // MARK: Views
    private var box: SnowVideoBox?
    /// Black over the picture until this stream's first frame (Android's
    /// shutterView): the last stream's picture never shows under the next.
    private var shutter: UIView?
    /// The current player's drawable. VLC adds its own video view inside it.
    private var drawable: UIView?
    private enum RectMode { case fullscreen, frame(CGRect) }
    /// Where the box goes; nil until the WebView has said (Android pendingRect).
    private var rectMode: RectMode?

    // MARK: Engine
    private var library: VLCLibrary?
    private let capture = SnowVLCErrorCapture()
    private var player: VLCMediaPlayer?
    private var media: VLCMedia?
    /// The picture size the drawable was last shaped for (applyFormat), and
    /// the layout it got: a new picture size or box re-shapes it.
    private var fittedVideoSize = CGSize.zero
    private var fittedLayout = ""

    // MARK: Settings that outlive a stream
    /// 0...1.5, like Android; VLC itself goes to 2.0, so past 1 is VLC's own boost.
    private(set) var volume: Double = 1
    /// setAudioEnabled(false), or the audio track "-1": no audio decoded at all.
    private var audioOff = false
    private(set) var format = "fit"

    // MARK: The stream
    private(set) var currentUrl: String?
    private var isLive = true
    /// A new load() or a stop: sidecar downloads of an older one are dropped.
    private var titleGen = 0
    /// Every start of the engine (load, reconnect): timers of an older one are dropped.
    private var loadGen = 0
    private var lastPositionMs = 0
    private var reconnectAttempts = 0
    private var transcodeHttpFails = 0
    private var chosenAudioId: Int32?
    private var chosenSubId: Int32?
    private var ended = false
    /// The viewer wants it playing (play/pause), as against what it is doing.
    private var wantPlaying = true
    private var reportedPaused = false
    private var backgroundPaused = false
    private struct SidecarFile { let url: URL; let token: String; let label: String; let lang: String }
    private var sidecars: [SidecarFile] = []
    private var sidecarFiles: [URL] = []

    // MARK: What JS has been told
    private var lastState: String?
    private var lastPlaying: Bool?

    // MARK: Progress (VLC has no "frame drawn" or "stalled" callback; its counters say)
    private var firstFrameSeen = false
    private var audioOnly = false
    private var progressing = false
    private var shownCount: Int32 = 0
    private var heardCount: Int32 = 0
    private var lastProgressAt: CFTimeInterval = 0
    private var ignoreProgressUntil: CFTimeInterval = 0

    // MARK: Timers
    private var watchdog: DispatchWorkItem?
    private var reconnectItem: DispatchWorkItem?
    private var tracksItem: DispatchWorkItem?

    // MARK: Stats (getStats), as the Android plugin keeps them
    private var statsUrl: String?
    private var restarts = 0
    private var lastRestartReason: String?
    private var lastError: String?
    private var lastHttpStatus: Int?
    private var loadStartAt: CFTimeInterval = 0
    private var loadStartCpuMs: Double = 0
    private var firstFrameMs: Int?
    private var stalls = 0
    private var stallSec: Double = 0
    private var stallStartedAt: CFTimeInterval = 0
    private var lastKbps = -1
    private var kbpsMin = -1
    private var kbpsMax = -1
    private var kbpsSum = 0
    private var kbpsSamples = 0
    private var bwLastBytes: UInt32 = 0
    private var bwLastDemuxBytes: UInt32 = 0
    private var bwLastAt: CFTimeInterval = 0

    init(screenId: String, owner: SnowSlotOwner) {
        self.screenId = screenId
        self.owner = owner
        super.init()
    }

    var isStreaming: Bool { currentUrl != nil }

    // MARK: - Commands

    /// Starts `url` here. Returns a reason when it can't (never the address).
    func load(url: String, live: Bool, subtitles: [SnowSidecarRequest], startSec: Double) -> String? {
        guard URL(string: url) != nil else { return "invalid url" }
        guard let b = ensureBox() else { return "no webview" }
        cancelTimers()
        let newTitle = url != statsUrl
        resetStats(url)
        titleGen += 1
        removeSidecars()
        currentUrl = url
        isLive = live
        let startMs = startSec > 0 ? Int(startSec * 1000) : 0
        lastPositionMs = startMs
        reconnectAttempts = 0
        transcodeHttpFails = 0
        ended = false
        wantPlaying = true
        reportedPaused = false
        backgroundPaused = false
        lastKbps = -1
        if newTitle {
            chosenAudioId = nil
            chosenSubId = nil
        }
        // A slot about to stream is always visible: a tile with no rect yet
        // fills the screen until one arrives (Android applyPendingRect).
        if rectMode == nil && !isMain { rectMode = .fullscreen }
        layoutBox()
        b.isHidden = false
        // Black until this stream's first frame.
        shutter?.isHidden = false
        setState("buffering")
        setPlaying(false)
        startEngine(atMs: startMs, paused: false)
        fetchSidecars(subtitles)
        return nil
    }

    func play() {
        guard let p = player, currentUrl != nil, !ended else { return }
        wantPlaying = true
        backgroundPaused = false
        lastProgressAt = CACurrentMediaTime()
        if p.state == .stopped {
            // VLC stops a live stream it can't pause instead of pausing it.
            startEngine(atMs: isLive ? 0 : lastPositionMs, paused: false)
        } else {
            p.play()
        }
        reportPaused()
    }

    func pause() {
        guard let p = player, currentUrl != nil else { return }
        wantPlaying = false
        if !ended { p.pause() }
        setPlaying(false)
        reportPaused()
    }

    /// The app went to the background. The WebView stops the stream itself;
    /// this only makes sure nothing decodes meanwhile.
    func pauseForBackground() {
        guard let p = player, currentUrl != nil, wantPlaying, !ended else { return }
        backgroundPaused = true
        p.pause()
    }

    /// Back in front with the stream still loaded (the WebView usually stops
    /// and reloads it instead): a channel starts again at its live edge.
    func resumeFromBackground() {
        guard backgroundPaused, let p = player, currentUrl != nil else { return }
        backgroundPaused = false
        lastProgressAt = CACurrentMediaTime()
        if isLive { startEngine(atMs: 0, paused: false) } else { p.play() }
    }

    func stop() {
        let hadStream = currentUrl != nil || player != nil
        cancelTimers()
        titleGen += 1
        loadGen += 1
        currentUrl = nil
        clearStats()
        lastPositionMs = 0
        reconnectAttempts = 0
        transcodeHttpFails = 0
        firstFrameSeen = false
        audioOnly = false
        progressing = false
        ended = false
        backgroundPaused = false
        retireEngine()
        removeSidecars()
        shutter?.isHidden = false
        box?.isHidden = true
        rectMode = nil
        if hadStream {
            setState("idle")
            setPlaying(false)
        }
    }

    /// A Multi-Screen tile that has stopped gives everything back (Android
    /// releaseSlot); load() builds it again.
    func release() {
        stop()
        box?.removeFromSuperview()
        box = nil
        shutter = nil
        library = nil
        audioOff = false
        lastState = nil
        lastPlaying = nil
    }

    func seek(toSec sec: Double) {
        guard let p = player, currentUrl != nil else { return }
        let ms = max(0, Int(sec * 1000))
        lastPositionMs = ms
        let now = CACurrentMediaTime()
        if ended || !p.isSeekable {
            // Ended (the file is closed) or not open yet: start it there.
            ended = false
            startEngine(atMs: ms, paused: !wantPlaying)
        } else {
            p.time = VLCTime(int: Int32(clamping: ms))
        }
        progressing = false
        ignoreProgressUntil = now + 0.4
        lastProgressAt = now
        if firstFrameSeen && stallStartedAt == 0 {
            stalls += 1
            stallStartedAt = now
        }
        setState("buffering")
        setPlaying(false)
    }

    /// Seconds, like Android: the playhead, the length (0 for a channel), and
    /// whether it is actually playing.
    func position() -> (position: Double, duration: Double, playing: Bool) {
        guard let p = player, currentUrl != nil else { return (0, 0, false) }
        let t = Int(p.time.intValue)
        // Before its first frame a resumed film is where it was asked to start.
        let ms = t > 0 ? t : (firstFrameSeen ? 0 : lastPositionMs)
        return (Double(max(0, ms)) / 1000, Double(mediaLengthMs()) / 1000, lastPlaying == true)
    }

    // MARK: - Place on screen

    func setRect(x: Double, y: Double, width: Double, height: Double, cssW: Double, cssH: Double, fullscreen: Bool, blank: Bool) {
        // A new stream is about to load here: cover the old picture now.
        if blank { shutter?.isHidden = false }
        // Only an explicit fullscreen may fill the screen; a degenerate tile
        // rect must never cover the others.
        if !fullscreen && (width <= 0 || height <= 0) { return }
        guard let b = ensureBox(), let host = b.superview else { return }
        if fullscreen {
            rectMode = .fullscreen
        } else {
            // CSS px of the page to points of the WebView it fills.
            let size = host.bounds.size
            let sx = cssW > 0 && size.width > 0 ? size.width / CGFloat(cssW) : 1
            let sy = cssH > 0 && size.height > 0 ? size.height / CGFloat(cssH) : 1
            rectMode = .frame(CGRect(x: CGFloat(x) * sx, y: CGFloat(y) * sy, width: CGFloat(width) * sx, height: CGFloat(height) * sy))
        }
        layoutBox()
        if !isMain && currentUrl != nil { b.isHidden = false }
        applyFormat()
    }

    func setFormat(_ mode: String) {
        format = mode
        applyFormat()
    }

    // MARK: - Sound

    func setVolume(_ v: Double) {
        volume = min(max(v, 0), 1.5)
        applyVolume()
    }

    func setAudioEnabled(_ enabled: Bool) {
        audioOff = !enabled
        guard let p = player else { return }
        if !enabled {
            if p.currentAudioTrackIndex != -1 { p.currentAudioTrackIndex = -1 }
        } else if p.currentAudioTrackIndex == -1 {
            let ids = Self.ids(p.audioTrackIndexes)
            if let want = chosenAudioId, ids.contains(want) { p.currentAudioTrackIndex = want } else if let first = ids.first { p.currentAudioTrackIndex = first }
        }
    }

    // MARK: - Tracks (ids are VLC's own stream ids, as strings; "-1" = off)

    func audioTracks() -> [[String: Any]] {
        guard let p = player else { return [] }
        let ids = Self.rawIds(p.audioTrackIndexes)
        let names = p.audioTrackNames.map { ($0 as? String) ?? "" }
        let infos = SnowTrackInfo.all(of: media)
        let current = p.currentAudioTrackIndex
        var out: [[String: Any]] = []
        for (i, id) in ids.enumerated() where id >= 0 {
            let info = infos.first { $0.id == id && $0.isAudio }
            let fourcc = info?.fourcc ?? ""
            let fallback = info?.title ?? info?.language ?? (fourcc.isEmpty ? "Track \(out.count + 1)" : SnowCodec.name(fourcc))
            out.append([
                "id": String(id),
                "label": Self.cleanLabel(i < names.count ? names[i] : "", fallback: fallback),
                "language": info?.language ?? "",
                "codec": SnowCodec.codecs(fourcc),
                "selected": id == current,
                // VLC decodes every audio format in software: nothing is ever
                // left silent for want of a decoder.
                "supported": true,
                "mimeType": SnowCodec.mime(fourcc, video: false, audio: true),
                "channels": info?.channels ?? 0,
            ])
        }
        return out
    }

    func subtitleTracks() -> [[String: Any]] {
        guard let p = player else { return [] }
        let ids = Self.rawIds(p.videoSubTitlesIndexes)
        let names = p.videoSubTitlesNames.map { ($0 as? String) ?? "" }
        let infos = SnowTrackInfo.all(of: media)
        let current = p.currentVideoSubTitleIndex
        var out: [[String: Any]] = []
        var ccCount = 0
        for (i, id) in ids.enumerated() where id >= 0 {
            let name = i < names.count ? names[i] : ""
            let info = infos.first { $0.id == id && !$0.isAudio && !$0.isVideo }
            let fourcc = info?.fourcc ?? ""
            let mime = SnowCodec.mime(fourcc, video: false, audio: false)
            var language = info?.language ?? ""
            let label: String
            if let side = sidecars.first(where: { name.contains("~" + $0.token) }) {
                // One of the load's sidecar files: its own name.
                label = !side.label.isEmpty ? side.label : (!side.lang.isEmpty ? side.lang : "Subtitles \(out.count + 1)")
                if language.isEmpty { language = side.lang }
            } else if mime == "application/cea-608" {
                // VLC lists a stream's caption channels CC1 to CC4 in order.
                ccCount += 1
                label = "Closed Captions (CC\(ccCount))"
            } else if mime == "application/cea-708" {
                label = "Closed Captions (708)"
            } else {
                label = Self.cleanLabel(name, fallback: info?.title ?? info?.language ?? "Track \(out.count + 1)")
            }
            out.append([
                "id": String(id),
                "label": label,
                "language": language,
                "codec": SnowCodec.codecs(fourcc),
                "selected": id == current,
                "supported": true,
                "mimeType": mime,
                "channels": 0,
            ])
        }
        return out
    }

    func selectAudio(_ id: String) {
        guard let p = player else { return }
        if id == "-1" {
            audioOff = true
            p.currentAudioTrackIndex = -1
            return
        }
        guard let n = Int32(id) else { return }
        audioOff = false
        chosenAudioId = n
        p.currentAudioTrackIndex = n
    }

    func selectSubtitle(_ id: String) {
        guard let p = player, let n = Int32(id) else { return }
        chosenSubId = n
        p.currentVideoSubTitleIndex = n
    }

    // MARK: - Ticks

    /// Every SnowTuning.tick on the main thread. VLC reports neither a first
    /// frame nor a stall, so both are read off its counters: pictures shown
    /// and audio buffers played since this stream started. Main slot: the
    /// 'bandwidth' event every 3 s from the bytes read.
    func tick(_ now: CFTimeInterval) {
        guard currentUrl != nil, let p = player, let m = media, !ended else { return }
        let st = m.statistics
        let shown = st.displayedPictures
        let heard = st.playedAudioBuffers
        let moved = shown > shownCount || heard > heardCount
        shownCount = max(shownCount, shown)
        heardCount = max(heardCount, heard)

        if p.videoSize != fittedVideoSize { applyFormat() }
        if !firstFrameSeen && shown > 0 { onFirstFrame(now) }
        if !firstFrameSeen && !audioOnly && heard > 0 && shown == 0 && p.numberOfVideoTracks == 0 {
            // A radio channel: it never draws a picture, so no watchdog for one.
            audioOnly = true
            reconnectAttempts = 0
            watchdog?.cancel()
            watchdog = nil
        }
        let t = Int(p.time.intValue)
        if t > 0 && (firstFrameSeen || audioOnly) { lastPositionMs = t }

        if !backgroundPaused {
            let caching = Double(cachingMs) / 1000
            if moved && now >= ignoreProgressUntil {
                lastProgressAt = now
                if !progressing {
                    progressing = true
                    if stallStartedAt > 0 {
                        stallSec += now - stallStartedAt
                        stallStartedAt = 0
                    }
                    setState("ready")
                }
                if wantPlaying { setPlaying(true) }
            } else if progressing && wantPlaying && now - lastProgressAt > caching + SnowTuning.stallGrace {
                progressing = false
                if firstFrameSeen && stallStartedAt == 0 {
                    stalls += 1
                    stallStartedAt = now
                }
                setState("buffering")
                setPlaying(false)
            }
            // The server stopped sending and VLC would wait for ever: what
            // ExoPlayer's read timeout does on Android.
            let limit = isLive ? SnowTuning.liveStallRestart : SnowTuning.vodStallRestart
            if wantPlaying && (firstFrameSeen || audioOnly) && now - lastProgressAt > limit {
                lastProgressAt = now
                fail(code: Self.ioTimeout, reason: "server stopped responding")
                return
            }
        }

        if isMain && now - bwLastAt >= SnowTuning.bandwidthTick {
            // What came in: a plain HTTP stream's bytes are counted where
            // they are read, an HLS stream's (playlists aside) where its
            // segments reach the demuxer. Counters wrap at 4 GiB.
            let bytes = UInt32(bitPattern: st.readBytes)
            let demuxBytes = UInt32(bitPattern: st.demuxReadBytes)
            let delta = max(bytes &- bwLastBytes, demuxBytes &- bwLastDemuxBytes)
            let ms = (now - bwLastAt) * 1000
            let kbps = ms > 0 ? Int(Double(delta) * 8 / ms) : 0
            if kbps > 0 || lastKbps != 0 {
                emit("bandwidth", ["kbps": kbps])
            }
            lastKbps = kbps
            if kbps > 0 {
                if kbpsMin < 0 || kbps < kbpsMin { kbpsMin = kbps }
                if kbps > kbpsMax { kbpsMax = kbps }
                kbpsSum += kbps
                kbpsSamples += 1
            }
            bwLastBytes = bytes
            bwLastDemuxBytes = demuxBytes
            bwLastAt = now
        }
    }

    // MARK: - Stats

    /// The stats panel's figures (PlayerStats in SnowPlayer.ts): VLC's own
    /// counters, and null for what VLC can't tell (the buffer ahead, the heaps).
    func stats(memory: Bool) -> [String: Any] {
        var o = Self.emptyStats(memory: memory)
        let streaming = currentUrl != nil && player != nil
        let state: String
        if !streaming { state = "idle" } else if ended { state = "ended" } else if lastState == "ready" { state = "ready" } else { state = "buffering" }
        o["state"] = state
        o["playing"] = streaming && lastPlaying == true
        let pos = position()
        o["positionSec"] = pos.position
        o["durationSec"] = pos.duration
        o["nowKbps"] = orNull(lastKbps >= 0 ? lastKbps : nil)
        o["arrivalKbps"] = orNull(lastKbps >= 0 ? lastKbps : nil)
        if kbpsSamples > 0 {
            o["avgKbps"] = kbpsSum / kbpsSamples
            o["minKbps"] = kbpsMin
            o["maxKbps"] = kbpsMax
        }
        if streaming, let p = player {
            let infos = SnowTrackInfo.all(of: media)
            let vid = p.currentVideoTrackIndex
            if let v = infos.first(where: { $0.isVideo && $0.id == vid }) ?? infos.first(where: { $0.isVideo }) {
                o["videoDecoder"] = "VLC"
                o["videoFormat"] = SnowCodec.describeVideo(v, size: p.videoSize)
            }
            let aid = p.currentAudioTrackIndex
            if aid >= 0, let a = infos.first(where: { $0.isAudio && $0.id == aid }) {
                o["audioDecoder"] = "VLC"
                o["audioFormat"] = SnowCodec.describeAudio(a)
            }
            if let m = media, firstFrameSeen {
                let st = m.statistics
                o["renderedFrames"] = Int(st.displayedPictures)
                o["droppedFrames"] = Int(st.lostPictures)
            }
        }
        o["restarts"] = restarts
        o["lastRestartReason"] = orNull(lastRestartReason)
        o["lastError"] = orNull(lastError)
        o["httpStatus"] = orNull(lastHttpStatus)
        o["loadProfile"] = orNull(streaming ? loadProfile : nil)
        o["firstFrameMs"] = orNull(firstFrameMs)
        o["stalls"] = stalls
        var stallTotal = stallSec
        if stallStartedAt > 0 { stallTotal += CACurrentMediaTime() - stallStartedAt }
        o["stallSec"] = (stallTotal * 10).rounded() / 10
        if loadStartAt > 0 {
            let wallMs = (CACurrentMediaTime() - loadStartAt) * 1000
            if wallMs > 0 { o["cpuPct"] = ((SnowProcess.cpuMs() - loadStartCpuMs) / wallMs * 1000).rounded() / 10 }
        }
        return o
    }

    /// Nothing playing: zeros and nulls (emptyPlayerStats in SnowPlayer.ts).
    static func emptyStats(memory: Bool) -> [String: Any] {
        return [
            "state": "idle", "playing": false, "positionSec": 0.0, "durationSec": 0.0,
            // VLC doesn't say how far ahead it has read.
            "bufferedAheadSec": 0.0,
            "nowKbps": NSNull(), "avgKbps": NSNull(), "minKbps": NSNull(), "maxKbps": NSNull(), "arrivalKbps": NSNull(),
            "videoDecoder": NSNull(), "videoFormat": NSNull(), "renderedFrames": NSNull(), "droppedFrames": NSNull(),
            "audioDecoder": NSNull(), "audioFormat": NSNull(),
            "restarts": 0, "lastRestartReason": NSNull(), "lastError": NSNull(), "httpStatus": NSNull(),
            "loadProfile": NSNull(), "fetchConnections": 1, "rangeFetch": false, "connectionCap": 1,
            "lowRamBox": SnowProcess.lowRam,
            "javaHeapMb": NSNull(), "nativeHeapMb": NSNull(),
            "engine": "vlc", "firstFrameMs": NSNull(), "stalls": 0, "stallSec": 0.0, "cpuPct": NSNull(),
            "pssMb": orNull(memory ? SnowProcess.footprintMb() : nil),
        ]
    }

    // MARK: - VLC events

    func mediaPlayerStateChanged(_ aNotification: Notification) {
        guard let p = aNotification.object as? VLCMediaPlayer else { return }
        let state = p.state
        if Thread.isMainThread {
            onEngineState(state, of: p)
        } else {
            DispatchQueue.main.async { [weak self, weak p] in
                guard let self = self, let p = p else { return }
                self.onEngineState(state, of: p)
            }
        }
    }

    private func onEngineState(_ state: VLCMediaPlayerState, of p: VLCMediaPlayer) {
        guard p === player, currentUrl != nil else { return }
        switch state {
        case .opening, .buffering:
            if !progressing && !ended { setState("buffering") }
        case .playing:
            // A pause asked for before VLC had opened the stream did nothing
            // there; it stands now.
            if !wantPlaying || backgroundPaused { p.pause() }
            applyVolume()
            applyTrackChoices()
            scheduleTracksChanged()
        case .paused:
            setPlaying(false)
        case .esAdded:
            applyTrackChoices()
            scheduleTracksChanged()
        case .ended:
            onEnded()
        case .error:
            fail(code: nil, reason: nil)
        case .stopped:
            break
        @unknown default:
            break
        }
    }

    // MARK: - Engine

    private var cachingMs: Int {
        if !isLive { return SnowTuning.vodCachingMs }
        return isMain ? SnowTuning.liveCachingMs : SnowTuning.tileCachingMs
    }

    private var loadProfile: String {
        if !isLive { return "vlc · film · \(SnowTuning.vodCachingMs / 1000) s start / \(SnowTuning.vodPrefetchKiB / 1024) MB read-ahead" }
        let sec = String(format: "%.1f", Double(cachingMs) / 1000)
        return isMain ? "vlc · live · \(sec) s cache" : "vlc · tile · \(sec) s cache"
    }

    private func engineLibrary() -> VLCLibrary {
        if let l = library { return l }
        // VLCKit's own defaults, said again in case a library made with
        // options ever goes without them. Above all no title on the picture:
        // VLC shows the stream's name at the start, and an IPTV stream's
        // name is part of its address.
        let l = VLCLibrary(options: [
            "--no-color", "--no-osd", "--no-video-title-show", "--no-snapshot-preview",
            "--http-reconnect", "--text-renderer=freetype", "--avi-index=3", "--audio-resampler=soxr",
        ])
        SnowVLCSilentLogger.silence(l, capture: capture)
        library = l
        return l
    }

    /// A fresh player for the current stream, at `atMs` (0: its own start,
    /// the live edge of a channel). The one before is stopped off the main
    /// thread and its view removed once it has let go.
    private func startEngine(atMs: Int, paused: Bool) {
        guard let urlString = currentUrl, let url = URL(string: urlString), let b = ensureBox(), let sh = shutter else { return }
        retireEngine()
        loadGen += 1
        capture.reset()

        let m = VLCMedia(url: url)
        m.addOption(":network-caching=\(cachingMs)")
        if !isLive { m.addOption(":prefetch-buffer-size=\(SnowTuning.vodPrefetchKiB)") }
        if atMs > 0 { m.addOption(String(format: ":start-time=%.3f", Double(atMs) / 1000)) }
        if paused { m.addOption(":start-paused") }
        if let agent = Self.userAgent(for: url) { m.addOption(":http-user-agent=\(agent)") }

        let p = VLCMediaPlayer(library: engineLibrary())
        p.delegate = self
        let d = UIView(frame: b.bounds)
        d.backgroundColor = .black
        d.isUserInteractionEnabled = false
        b.insertSubview(d, belowSubview: sh)
        p.drawable = d
        p.media = m
        player = p
        media = m
        drawable = d
        fittedVideoSize = .zero
        fittedLayout = ""
        applyFormat()
        applyVolume()
        for f in sidecars { _ = p.addPlaybackSlave(f.url, type: .subtitle, enforce: false) }

        let now = CACurrentMediaTime()
        firstFrameSeen = false
        audioOnly = false
        progressing = false
        shownCount = 0
        heardCount = 0
        lastProgressAt = now
        ignoreProgressUntil = 0
        bwLastBytes = 0
        bwLastDemuxBytes = 0
        bwLastAt = now
        p.play()
        scheduleWatchdog()
    }

    private func retireEngine() {
        tracksItem?.cancel()
        tracksItem = nil
        guard let old = player else { return }
        old.delegate = nil
        let oldView = drawable
        player = nil
        media = nil
        drawable = nil
        Self.teardownQueue.async {
            old.stop()
            DispatchQueue.main.async { oldView?.removeFromSuperview() }
        }
    }

    /// Plex wants to know who is asking for a file played as it is, like
    /// the Android player's own agent; a conversion and Live TV go out with
    /// VLC's default one (Android sends its system agent there).
    private static let plexAgent: String = {
        let app = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let vlc = VLCLibrary.shared().version.split(separator: " ").first.map(String.init) ?? "3"
        return "SnowMediaCenter/\(app) (iPhone; iOS \(os.majorVersion).\(os.minorVersion)) LibVLC/\(vlc)"
    }()

    private static func userAgent(for url: URL) -> String? {
        return url.path.contains("/library/parts/") ? plexAgent : nil
    }

    /// A Plex file played as it is, or a conversion; matched anywhere in the
    /// path so a server behind a reverse proxy still counts.
    static func isPlexStream(_ url: String) -> Bool {
        guard let path = URL(string: url)?.path else { return false }
        return path.contains("/library/parts/") || path.contains("/transcode/universal/")
    }

    static func isPlexTranscode(_ url: String) -> Bool {
        return URL(string: url)?.path.contains("/transcode/universal/") == true
    }

    private func applyVolume() {
        player?.audio?.volume = Int32((volume * 100).rounded())
    }

    /// Screen format, as on Android (VideoFit): the view VLC draws in is
    /// given the shape the picture should have and centred in the black box,
    /// which crops whatever spills over. VLC's iOS display fills its view
    /// keeping the picture's own shape and ignores a forced aspect ratio, and
    /// a crop there squashes the picture, so neither is used.
    ///   fit   the whole picture, own shape, black bars. Default.
    ///   fill  the box, shape ignored (the view is stretched to it).
    ///   zoom  own shape, covering the box; the edges are cropped.
    ///   wide  16:9 whatever the stream says, inside the box.
    /// Until the picture's size is known the view simply fills the box.
    private func applyFormat() {
        guard let d = drawable, let b = box else { return }
        let boxSize = b.bounds.size
        guard boxSize.width > 0, boxSize.height > 0 else { return }
        let video = player?.videoSize ?? .zero
        // The picture's shape on screen: its pixels times their own shape
        // (anamorphic video has non-square pixels).
        var aspect: CGFloat = 0
        if video.width > 0 && video.height > 0 {
            aspect = video.width * pixelAspect() / video.height
        }
        let boxAspect = boxSize.width / boxSize.height
        func inside(_ a: CGFloat, _ size: CGSize) -> CGSize {
            return a > size.width / size.height ? CGSize(width: size.width, height: size.width / a) : CGSize(width: size.height * a, height: size.height)
        }
        let target: CGSize
        switch format {
        case "fill": target = boxSize
        case "wide": target = inside(16.0 / 9.0, boxSize)
        case "zoom": target = aspect > 0 ? (aspect > boxAspect ? CGSize(width: boxSize.height * aspect, height: boxSize.height) : CGSize(width: boxSize.width, height: boxSize.width / aspect)) : boxSize
        default: target = aspect > 0 ? inside(aspect, boxSize) : boxSize
        }
        // VLC fills a view of the picture's own shape edge to edge; a target
        // of another shape (fill, wide) is that view stretched.
        let view = aspect > 0 ? inside(aspect, target) : target
        let key = "\(boxSize.width)x\(boxSize.height)|\(target.width)x\(target.height)|\(view.width)x\(view.height)"
        fittedVideoSize = video
        guard key != fittedLayout, view.width > 0, view.height > 0 else { return }
        fittedLayout = key
        d.autoresizingMask = []
        d.transform = .identity
        d.bounds = CGRect(origin: .zero, size: view)
        d.center = CGPoint(x: boxSize.width / 2, y: boxSize.height / 2)
        d.transform = CGAffineTransform(scaleX: target.width / view.width, y: target.height / view.height)
    }

    /// The current video track's pixel shape (VLC's source aspect ratio), 1 when not stated.
    private func pixelAspect() -> CGFloat {
        guard let p = player, let raw = media?.tracksInformation else { return 1 }
        let vid = p.currentVideoTrackIndex
        var fallback: CGFloat = 1
        for item in raw {
            guard let d = item as? [String: Any], d[VLCMediaTracksInformationType] as? String == VLCMediaTracksInformationTypeVideo else { continue }
            let num = (d[VLCMediaTracksInformationSourceAspectRatio] as? NSNumber)?.doubleValue ?? 0
            let den = (d[VLCMediaTracksInformationSourceAspectRatioDenominator] as? NSNumber)?.doubleValue ?? 0
            let r: CGFloat = num > 0 && den > 0 ? CGFloat(num / den) : 1
            if (d[VLCMediaTracksInformationId] as? NSNumber)?.int32Value == vid { return r }
            fallback = r
        }
        return fallback
    }

    private func applyTrackChoices() {
        guard let p = player else { return }
        if audioOff {
            if p.currentAudioTrackIndex != -1 { p.currentAudioTrackIndex = -1 }
        } else if let want = chosenAudioId, want != p.currentAudioTrackIndex, Self.ids(p.audioTrackIndexes).contains(want) {
            p.currentAudioTrackIndex = want
        }
        if let sub = chosenSubId, sub != p.currentVideoSubTitleIndex, sub == -1 || Self.ids(p.videoSubTitlesIndexes).contains(sub) {
            p.currentVideoSubTitleIndex = sub
        }
    }

    private func scheduleTracksChanged() {
        tracksItem?.cancel()
        let gen = loadGen
        let item = DispatchWorkItem { [weak self] in
            guard let self = self, self.loadGen == gen, self.player != nil else { return }
            self.tracksItem = nil
            self.emit("tracksChanged", [:])
        }
        tracksItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: item)
    }

    private func onFirstFrame(_ now: CFTimeInterval) {
        firstFrameSeen = true
        if firstFrameMs == nil { firstFrameMs = Int((now - loadStartAt) * 1000) }
        shutter?.isHidden = true
        reconnectAttempts = 0
        watchdog?.cancel()
        watchdog = nil
        scheduleTracksChanged()
    }

    /// No picture in time: start again. Not for a Plex film or episode, which
    /// PlexSection watches itself (as on Android); not while paused.
    private func scheduleWatchdog() {
        watchdog?.cancel()
        watchdog = nil
        guard let url = currentUrl else { return }
        if !isLive && Self.isPlexStream(url) { return }
        let timeout = isLive ? SnowTuning.liveFirstFrameTimeout : SnowTuning.vodFirstFrameTimeout
        let gen = loadGen
        let item = DispatchWorkItem { [weak self] in
            guard let self = self, self.loadGen == gen, self.currentUrl != nil, !self.firstFrameSeen, !self.audioOnly, self.wantPlaying else { return }
            self.reconnect("no picture in \(Int(timeout)) s")
        }
        watchdog = item
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: item)
    }

    private func onEnded() {
        guard currentUrl != nil, !ended else { return }
        if isLive {
            reconnect("live stream ended")
            return
        }
        // VLC also "ends" a film whose connection dropped: that is a failure
        // to recover from at the same place, not the end of the film.
        let durMs = mediaLengthMs()
        let at = max(lastPositionMs, Int(player?.time.intValue ?? 0))
        if (!firstFrameSeen && !audioOnly) || (durMs > 0 && durMs - at > 30_000) {
            fail(code: Self.ioUnspecified, reason: "stream ended early")
            return
        }
        ended = true
        progressing = false
        watchdog?.cancel()
        watchdog = nil
        setPlaying(false)
        lastState = "ended"
        emit("playerState", ["state": "ended"])
    }

    /// The Android plugin's onPlayerError, for what VLC can tell: an HTTP
    /// status (read off its log), a connection that failed, or nothing more.
    /// `code` set: a failure found here (a stall, an early end).
    private func fail(code given: String?, reason given2: String?) {
        guard let url = currentUrl else { return }
        var code = given ?? Self.ioUnspecified
        var http: Int?
        if given == nil {
            let cap = capture.snapshot()
            if let status = cap.httpStatus {
                code = Self.ioBadHttp
                http = status
            } else if cap.connectionFailed {
                code = Self.ioConnFailed
            }
        }
        // First, before any playerError goes out: a handler reads it back.
        lastError = code
        lastHttpStatus = http
        progressing = false
        setPlaying(false)

        // A Plex conversion the server answered with an error status: the
        // same session once more, then the WebView starts a fresh one.
        if !isLive && code == Self.ioBadHttp && Self.isPlexTranscode(url) {
            transcodeHttpFails += 1
            if transcodeHttpFails < SnowTuning.transcodeHttpTries && reconnectAttempts < SnowTuning.maxReconnects {
                reconnect(Self.restartReason(code, http))
                return
            }
            watchdog?.cancel()
            var ev: [String: Any] = ["code": "PLEX_TRANSCODE_HTTP", "message": Self.exhaustedMessage(code, http, url)]
            if let http = http { ev["httpStatus"] = http }
            emit("playerError", ev)
            return
        }
        let vodSpent = !isLive && reconnectAttempts >= SnowTuning.maxVodReconnects
        if !vodSpent && reconnectAttempts < SnowTuning.maxReconnects {
            let reason = given2 ?? ((code == Self.ioConnFailed || code == Self.ioTimeout) ? "server stopped responding" : Self.restartReason(code, http))
            reconnect(reason)
            return
        }
        watchdog?.cancel()
        watchdog = nil
        if vodSpent {
            // Every failure VLC reports here is the server's (an IO error).
            emit("playerError", ["code": "RECONNECT_EXHAUSTED", "message": Self.exhaustedMessage(code, http, url), "httpStatus": orNull(http)])
            return
        }
        emit("playerError", ["code": code, "message": "Playback error"])
    }

    /// Start the stream again after a moment (`reason` is what the stats
    /// panel shows): a channel at its live edge, a film where it was, still
    /// paused if the viewer had paused it. 20 in a row and it gives up.
    private func reconnect(_ reason: String) {
        guard currentUrl != nil else { return }
        if reconnectAttempts >= SnowTuning.maxReconnects {
            emit("playerError", ["code": "RECONNECT_EXHAUSTED", "message": "The stream keeps dropping. Try again."])
            return
        }
        reconnectAttempts += 1
        restarts += 1
        lastRestartReason = reason
        lastState = "buffering"
        emit("playerState", ["state": "buffering"])
        progressing = false
        setPlaying(false)
        watchdog?.cancel()
        watchdog = nil
        reconnectItem?.cancel()
        let gen = loadGen
        // 0.5 s, then backing off to 4 s between tries.
        let delay = min(0.5 * pow(2, Double(reconnectAttempts - 1)), 4)
        let item = DispatchWorkItem { [weak self] in
            guard let self = self, self.loadGen == gen, self.currentUrl != nil else { return }
            self.reconnectItem = nil
            if self.isLive {
                // A channel always plays on (Android sets playWhenReady).
                self.wantPlaying = true
                self.reportPaused()
            }
            self.startEngine(atMs: self.isLive ? 0 : self.lastPositionMs, paused: !self.isLive && !self.wantPlaying)
        }
        reconnectItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func cancelTimers() {
        watchdog?.cancel()
        watchdog = nil
        reconnectItem?.cancel()
        reconnectItem = nil
        tracksItem?.cancel()
        tracksItem = nil
    }

    private func mediaLengthMs() -> Int {
        let ms = Int(media?.length.intValue ?? 0)
        return ms > 0 ? ms : 0
    }

    // MARK: - Events

    private func emit(_ event: String, _ data: [String: Any]) {
        var d = data
        d["screenId"] = screenId
        owner?.slot(self, emit: event, d)
    }

    private func setState(_ s: String) {
        guard lastState != s else { return }
        lastState = s
        emit("playerState", ["state": s])
    }

    private func setPlaying(_ b: Bool) {
        guard lastPlaying != b else { return }
        lastPlaying = b
        emit("playerState", ["playing": b])
    }

    /// 'paused': stopped on purpose, not a stall. Sent only when it changes.
    private func reportPaused() {
        let paused = !wantPlaying
        guard paused != reportedPaused else { return }
        reportedPaused = paused
        emit("playerState", ["paused": paused])
    }

    // MARK: - Views

    @discardableResult
    private func ensureBox() -> SnowVideoBox? {
        guard let host = owner?.slotHostView() else { return box }
        if let b = box {
            if b.superview !== host { host.addSubview(b) }
            return b
        }
        let b = SnowVideoBox(frame: host.bounds)
        b.backgroundColor = .black
        b.clipsToBounds = true
        b.isUserInteractionEnabled = false
        b.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        b.isHidden = true
        let sh = UIView(frame: b.bounds)
        sh.backgroundColor = .black
        sh.isUserInteractionEnabled = false
        sh.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        b.addSubview(sh)
        b.onResize = { [weak self] in self?.applyFormat() }
        host.addSubview(b)
        box = b
        shutter = sh
        return b
    }

    private func layoutBox() {
        guard let b = box, let host = b.superview, let mode = rectMode else { return }
        switch mode {
        case .fullscreen:
            b.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            b.frame = host.bounds
        case .frame(let r):
            b.autoresizingMask = []
            b.frame = r
        }
    }

    // MARK: - Sidecar subtitles

    /// Fetched to files first, each named so its track can be told apart and
    /// with the extension its type has (VLC picks a subtitle reader by the
    /// name, and a Plex subtitle URL has none). The URLs carry the Plex
    /// token: never logged, and VLC never sees them.
    private func fetchSidecars(_ requests: [SnowSidecarRequest]) {
        guard !requests.isEmpty else { return }
        let gen = titleGen
        let dir = Self.subtitleFolder
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tag = screenId.filter { $0.isLetter || $0.isNumber }
        for (i, r) in requests.enumerated() {
            let token = "smc\(tag)\(gen)x\(i)"
            let name = r.label.isEmpty ? (r.lang.isEmpty ? "Subtitles" : r.lang) : r.label
            let safe = String(name.map { $0.isLetter || $0.isNumber || $0 == " " || $0 == "(" || $0 == ")" || $0 == "-" ? $0 : "_" }.prefix(40))
            let file = dir.appendingPathComponent("\(safe) ~\(token).\(Self.subtitleExtension(r.mime))")
            let request = URLRequest(url: r.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            URLSession.shared.dataTask(with: request) { data, response, error in
                guard error == nil, let data = data, !data.isEmpty else { return }
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return }
                guard (try? data.write(to: file, options: .atomic)) != nil else { return }
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.titleGen == gen, self.currentUrl != nil else {
                        try? FileManager.default.removeItem(at: file)
                        return
                    }
                    self.sidecarFiles.append(file)
                    self.sidecars.append(SidecarFile(url: file, token: token, label: r.label, lang: r.lang))
                    _ = self.player?.addPlaybackSlave(file, type: .subtitle, enforce: false)
                }
            }.resume()
        }
    }

    private func removeSidecars() {
        let files = sidecarFiles
        sidecarFiles = []
        sidecars = []
        guard !files.isEmpty else { return }
        // After the player that read them has gone.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            files.forEach { try? FileManager.default.removeItem(at: $0) }
        }
    }

    static let subtitleFolder = FileManager.default.temporaryDirectory.appendingPathComponent("SnowPlayerSubs", isDirectory: true)

    /// Left over from a run that ended without a stop.
    static func clearSubtitleFolder() {
        try? FileManager.default.removeItem(at: subtitleFolder)
    }

    private static func subtitleExtension(_ mime: String) -> String {
        switch mime.lowercased() {
        case "text/vtt": return "vtt"
        case "text/x-ssa", "application/x-ass", "text/x-ass": return "ass"
        case "application/ttml+xml": return "ttml"
        default: return "srt"
        }
    }

    // MARK: - Stats bookkeeping

    /// A new load: its speeds and frames start over. Restarts and the last
    /// error belong to the title, so loading the same one again keeps them.
    private func resetStats(_ url: String) {
        kbpsMin = -1
        kbpsMax = -1
        kbpsSum = 0
        kbpsSamples = 0
        firstFrameMs = nil
        stalls = 0
        stallSec = 0
        stallStartedAt = 0
        loadStartAt = CACurrentMediaTime()
        loadStartCpuMs = SnowProcess.cpuMs()
        if url != statsUrl {
            statsUrl = url
            restarts = 0
            lastRestartReason = nil
            lastError = nil
            lastHttpStatus = nil
        }
    }

    /// A stop: nothing of that stream is left to report.
    private func clearStats() {
        lastKbps = -1
        kbpsMin = -1
        kbpsMax = -1
        kbpsSum = 0
        kbpsSamples = 0
        statsUrl = nil
        restarts = 0
        lastRestartReason = nil
        lastError = nil
        lastHttpStatus = nil
        firstFrameMs = nil
        stalls = 0
        stallSec = 0
        stallStartedAt = 0
        loadStartAt = 0
    }

    // MARK: - Helpers

    private static func rawIds(_ list: [Any]) -> [Int32] {
        return list.map { ($0 as? NSNumber)?.int32Value ?? -1 }
    }

    /// Real tracks only (VLC lists "Disable" as -1).
    private static func ids(_ list: [Any]) -> [Int32] {
        return rawIds(list).filter { $0 >= 0 }
    }

    /// VLC's name for a track, unless it looks like an address or a file path.
    private static func cleanLabel(_ name: String, fallback: String) -> String {
        let n = name.trimmingCharacters(in: .whitespaces)
        if n.isEmpty || n.contains("://") || n.contains("?") || n.contains("/") || n.lowercased().contains("token") { return fallback }
        return n
    }

    private static func restartReason(_ code: String, _ http: Int?) -> String {
        let base = "stream error " + (code.hasPrefix("ERROR_CODE_") ? String(code.dropFirst("ERROR_CODE_".count)) : code)
        if let http = http { return "\(base) · HTTP \(http)" }
        return base
    }

    /// What a film that has given up tells the viewer, by how the server
    /// failed (Android exhaustedMessage, English). Never a URL.
    private static func exhaustedMessage(_ code: String, _ http: Int?, _ url: String) -> String {
        let plex = isPlexStream(url)
        switch code {
        case ioBadHttp:
            if let s = http { return plex ? "The Plex server refused this file (HTTP \(s))." : "The server refused this file (HTTP \(s))." }
            return plex ? "The Plex server refused this file." : "The server refused this file."
        case ioTimeout, ioConnFailed, ioUnspecified:
            return "The server stopped responding. Try again."
        default:
            return "Playback error"
        }
    }
}
