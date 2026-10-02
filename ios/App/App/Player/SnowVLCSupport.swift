import UIKit
import MobileVLCKit

// Pieces the iOS SnowPlayer (SnowPlayerPlugin / SnowPlayerSlot) shares:
// numbers it is tuned by, VLC's log kept off the console, codec names, track
// details, and the process figures for getStats.

/// A value for the WebView, or JSON null.
func orNull<T>(_ value: T?) -> Any {
    if let v = value { return v }
    return NSNull()
}

/// The player's numbers, next to the Android plugin's where there is one.
enum SnowTuning {
    /// A live channel restarts at most this often in a row (Android MAX_RECONNECTS).
    static let maxReconnects = 20
    /// A film or episode gives up sooner (Android MAX_VOD_RECONNECTS).
    static let maxVodReconnects = 3
    /// A Plex conversion the server answers with an HTTP error is loaded this
    /// many times in all, then the WebView starts a fresh one (Android TRANSCODE_HTTP_TRIES).
    static let transcodeHttpTries = 2
    /// How much VLC buffers before it starts, ms. Live on the main player: the
    /// 2.5 s ExoPlayer starts on. A Multi-Screen tile starts sooner. A film
    /// starts on 3 s and reads far ahead behind that (vodPrefetchKiB).
    static let liveCachingMs = 2500
    static let tileCachingMs = 1500
    static let vodCachingMs = 3000
    /// A film's read-ahead (VLC's prefetch buffer, KiB): about 25-40 s of a
    /// 1080p film, where VLC's own 16 MiB carries a remux only a few seconds.
    static let vodPrefetchKiB = 96 * 1024
    /// No picture this long after a start: restart it (Android 8 s; VLC's
    /// own start is a little slower). Not for a Plex film, which PlexSection watches.
    static let liveFirstFrameTimeout: TimeInterval = 10
    static let vodFirstFrameTimeout: TimeInterval = 15
    /// Nothing played for this long while it should be: the server has
    /// stopped sending (ExoPlayer's read timeouts: 8 s live, 30 s Plex). VLC
    /// itself has no read timeout and would wait forever.
    static let liveStallRestart: TimeInterval = 15
    static let vodStallRestart: TimeInterval = 30
    /// What VLC holds in its decoders keeps the picture going for about the
    /// caching time after the network stops, and the counters it reports only
    /// move while it reads, so a stall is called this long after the last
    /// frame on top of the caching time.
    static let stallGrace: TimeInterval = 1.5
    /// The 'bandwidth' event's window (Android BANDWIDTH_TICK_MS).
    static let bandwidthTick: TimeInterval = 3
    /// How often the plugin looks at each player.
    static let tick: TimeInterval = 0.25
}

/// What the plugin keeps of VLC's messages: two facts, as numbers, and
/// nothing else. The words themselves are dropped, never printed: libVLC's
/// errors quote the stream address, and an IPTV address carries the line's
/// username and password, a Plex one its X-Plex-Token.
final class SnowVLCErrorCapture {
    private let lock = NSLock()
    private var httpStatus: Int?
    private var connectionFailed = false

    func reset() {
        lock.lock()
        httpStatus = nil
        connectionFailed = false
        lock.unlock()
    }

    func note(httpStatus status: Int) {
        lock.lock()
        httpStatus = status
        lock.unlock()
    }

    func noteConnectionFailure() {
        lock.lock()
        connectionFailed = true
        lock.unlock()
    }

    func snapshot() -> (httpStatus: Int?, connectionFailed: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (httpStatus, connectionFailed)
    }
}

/// libVLC's logger for one slot's library. Set as the library's only logger
/// it also replaces libVLC's default one, which writes to the console.
final class SnowVLCSilentLogger: NSObject, VLCLogging {
    var level: VLCLogLevel = .error
    private let capture: SnowVLCErrorCapture

    init(capture: SnowVLCErrorCapture) {
        self.capture = capture
        super.init()
    }

    /// Called on libVLC's own threads. Reads the HTTP access's two errors
    /// ("HTTP %d error", "HTTP connection failure") and drops everything.
    func handleMessage(_ message: String, logLevel level: VLCLogLevel, context: VLCLogContext?) {
        guard level == .error, message.hasPrefix("HTTP ") else { return }
        if message == "HTTP connection failure" {
            capture.noteConnectionFailure()
            return
        }
        let parts = message.split(separator: " ")
        if parts.count == 3, parts[2] == "error", let status = Int(parts[1]), (100...599).contains(status) {
            capture.note(httpStatus: status)
        }
    }

    /// Silences a library (the shared one VLCMedia is made on, too).
    static func silence(_ library: VLCLibrary, capture: SnowVLCErrorCapture = SnowVLCErrorCapture()) {
        library.loggers = [SnowVLCSilentLogger(capture: capture)]
    }
}

/// One elementary stream as VLC describes it (VLCMedia.tracksInformation).
struct SnowTrackInfo {
    let id: Int32
    let type: String
    let fourcc: String
    let language: String?
    let title: String?
    let channels: Int
    let rate: Int
    let width: Int
    let height: Int
    let fps: Double
    let bitrate: Int

    var isVideo: Bool { type == VLCMediaTracksInformationTypeVideo }
    var isAudio: Bool { type == VLCMediaTracksInformationTypeAudio }

    static func all(of media: VLCMedia?) -> [SnowTrackInfo] {
        guard let raw = media?.tracksInformation else { return [] }
        return raw.compactMap { item -> SnowTrackInfo? in
            guard let d = item as? [String: Any], let id = (d[VLCMediaTracksInformationId] as? NSNumber)?.int32Value else { return nil }
            let int = { (key: String) -> Int in (d[key] as? NSNumber)?.intValue ?? 0 }
            let fpsNum = Double(int(VLCMediaTracksInformationFrameRate))
            let fpsDen = Double(int(VLCMediaTracksInformationFrameRateDenominator))
            let lang = (d[VLCMediaTracksInformationLanguage] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let title = (d[VLCMediaTracksInformationDescription] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return SnowTrackInfo(
                id: id,
                type: d[VLCMediaTracksInformationType] as? String ?? "",
                fourcc: SnowCodec.fourcc((d[VLCMediaTracksInformationCodec] as? NSNumber)?.uint32Value ?? 0),
                language: lang,
                title: title,
                channels: int(VLCMediaTracksInformationAudioChannelsNumber),
                rate: int(VLCMediaTracksInformationAudioRate),
                width: int(VLCMediaTracksInformationVideoWidth),
                height: int(VLCMediaTracksInformationVideoHeight),
                fps: fpsDen > 0 ? fpsNum / fpsDen : 0,
                bitrate: int(VLCMediaTracksInformationBitrate)
            )
        }
    }
}

/// Codec names from VLC's four-character codes, in the words the Android
/// plugin uses (its codecName / codecLabel), so the stats panel and track
/// lists read the same on both.
enum SnowCodec {
    /// VLC_FOURCC(a,b,c,d) is a | b<<8 | c<<16 | d<<24; trailing spaces dropped.
    static func fourcc(_ value: UInt32) -> String {
        guard value != 0 else { return "" }
        let bytes = [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
        let chars = bytes.map { b -> Character in
            let s = UnicodeScalar(UInt8(b))
            return (32...126).contains(b) ? Character(s) : "?"
        }
        return String(chars).trimmingCharacters(in: .whitespaces)
    }

    static func name(_ fourcc: String) -> String {
        switch fourcc.lowercased() {
        case "h264", "avc1", "x264": return "H.264"
        case "hevc", "hev1", "hvc1", "h265": return "HEVC"
        case "av01": return "AV1"
        case "vp90", "vp09": return "VP9"
        case "vp80", "vp08": return "VP8"
        case "mpgv", "mp2v", "mpg2": return "MPEG-2"
        case "mp4v": return "MPEG-4"
        case "wvc1", "vc-1": return "VC-1"
        case "dvh1", "dvhe": return "Dolby Vision"
        case "a52", "a52b": return "AC3"
        case "eac3": return "EAC3"
        case "ac-4", "ac4": return "AC4"
        case "mlp", "trhd": return "TrueHD"
        case "dts", "dtsh": return "DTS"
        case "mp4a": return "AAC"
        case "mpga", "mp3": return "MP3"
        case "opus": return "Opus"
        case "vorb": return "Vorbis"
        case "flac": return "FLAC"
        case "alac": return "ALAC"
        case "araw", "lpcm", "s16l", "s16b", "s24l", "s24b", "f32l", "u8": return "PCM"
        case "subt": return "Text"
        case "tx3g": return "Timed text"
        case "cc1", "cc2", "cc3", "cc4", "c608": return "CEA-608"
        case "c708": return "CEA-708"
        case "dvbs": return "DVB"
        case "pgs", "pgss": return "PGS"
        case "ssa", "ass": return "ASS"
        case "webv", "wvtt": return "WebVTT"
        case "": return "?"
        default: return fourcc.uppercased()
        }
    }

    /// Android's `codecs` string where there is a common one, VLC's code otherwise.
    static func codecs(_ fourcc: String) -> String {
        switch fourcc.lowercased() {
        case "a52", "a52b": return "ac-3"
        case "eac3": return "ec-3"
        case "h264": return "avc1"
        case "hevc": return "hvc1"
        default: return fourcc.lowercased()
        }
    }

    /// The MIME type ExoPlayer would report (MimeTypes.*), for the track list.
    static func mime(_ fourcc: String, video: Bool, audio: Bool) -> String {
        switch fourcc.lowercased() {
        case "h264", "avc1", "x264": return "video/avc"
        case "hevc", "hev1", "hvc1", "h265": return "video/hevc"
        case "av01": return "video/av01"
        case "vp90", "vp09": return "video/x-vnd.on2.vp9"
        case "mpgv", "mp2v", "mpg2": return "video/mpeg2"
        case "a52", "a52b": return "audio/ac3"
        case "eac3": return "audio/eac3"
        case "ac-4", "ac4": return "audio/ac4"
        case "mlp", "trhd": return "audio/true-hd"
        case "dts", "dtsh": return "audio/vnd.dts"
        case "mp4a": return "audio/mp4a-latm"
        case "mpga", "mp3": return "audio/mpeg"
        case "opus": return "audio/opus"
        case "vorb": return "audio/vorbis"
        case "flac": return "audio/flac"
        case "alac": return "audio/alac"
        case "araw", "lpcm", "s16l", "s16b", "s24l", "s24b", "f32l", "u8": return "audio/raw"
        case "subt": return "application/x-subrip"
        case "tx3g": return "application/x-quicktime-tx3g"
        case "cc1", "cc2", "cc3", "cc4", "c608": return "application/cea-608"
        case "c708": return "application/cea-708"
        case "dvbs": return "application/dvbsubs"
        case "pgs", "pgss": return "application/pgs"
        case "ssa", "ass": return "text/x-ssa"
        case "webv", "wvtt": return "text/vtt"
        default:
            if video { return "video/x-unknown" }
            if audio { return "audio/x-unknown" }
            return ""
        }
    }

    /// "HEVC 1920x804 23.98fps 21.6 Mb/s", leaving out what VLC doesn't know.
    static func describeVideo(_ t: SnowTrackInfo, size: CGSize) -> String {
        var s = name(t.fourcc)
        let w = t.width > 0 ? t.width : Int(size.width)
        let h = t.height > 0 ? t.height : Int(size.height)
        if w > 0 && h > 0 { s += " \(w)x\(h)" }
        if t.fps > 0 {
            let whole = t.fps.rounded()
            s += abs(t.fps - whole) < 0.01 ? " \(Int(whole))fps" : String(format: " %.2ffps", t.fps)
        }
        if t.bitrate > 0 { s += String(format: " %.1f Mb/s", Double(t.bitrate) / 1_000_000) }
        return s
    }

    /// "EAC3 6ch 48.0kHz".
    static func describeAudio(_ t: SnowTrackInfo) -> String {
        var s = name(t.fourcc)
        if t.channels > 0 { s += " \(t.channels)ch" }
        if t.rate > 0 { s += String(format: " %.1fkHz", Double(t.rate) / 1000) }
        return s
    }
}

/// Process figures for getStats.
enum SnowProcess {
    /// CPU time this process has used, ms (user + system, every thread).
    static func cpuMs() -> Double {
        var u = rusage()
        guard getrusage(RUSAGE_SELF, &u) == 0 else { return 0 }
        let user = Double(u.ru_utime.tv_sec) * 1000 + Double(u.ru_utime.tv_usec) / 1000
        let sys = Double(u.ru_stime.tv_sec) * 1000 + Double(u.ru_stime.tv_usec) / 1000
        return user + sys
    }

    /// The process's memory footprint, MB: what iOS counts against the app
    /// (the nearest thing to Android's PSS). Nil if the kernel won't say.
    static func footprintMb() -> Int? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        return Int(info.phys_footprint / (1024 * 1024))
    }

    /// The Android plugin's "2 GB class" test, on this device's RAM.
    static let lowRam: Bool = ProcessInfo.processInfo.physicalMemory <= 2_200_000_000

    /// "iPhone16,1" and the like.
    static let machine: String = {
        var u = utsname()
        uname(&u)
        return withUnsafeBytes(of: &u.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()
}
