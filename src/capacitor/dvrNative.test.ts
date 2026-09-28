/**
 * Rewind live TV + recordings, native side (TRACKER 25). Kotlin can't run
 * here, so its shape is pinned the way the other player tests pin it:
 * no stream address (or user name, password or token) is ever logged, stored,
 * put in a file name or in a PendingIntent; the buffer is wiped on Home /
 * close / sign-out paths and lives only in the cache, recordings live
 * elsewhere and are never wiped by it; normal ExoPlayer playback reaches the
 * rewind code only through guarded one-line hooks; the buffer never starts on
 * mpv; and SMC's recorder rules (1 GB box floor, 200 MB USB floor, FAT32
 * parts, two at once) are in place.
 */
import { describe, expect, it } from 'vitest';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import manager from '../../android/app/src/main/java/com/snowmedia/dvr/TimeshiftManager.kt?raw';
import session from '../../android/app/src/main/java/com/snowmedia/dvr/TimeshiftSession.kt?raw';
import source from '../../android/app/src/main/java/com/snowmedia/dvr/LiveSource.kt?raw';
import segmenter from '../../android/app/src/main/java/com/snowmedia/dvr/TsSegmenter.kt?raw';
import budget from '../../android/app/src/main/java/com/snowmedia/dvr/StorageBudget.kt?raw';
import service from '../../android/app/src/main/java/com/snowmedia/dvr/RecordingService.kt?raw';
import store from '../../android/app/src/main/java/com/snowmedia/dvr/RecordingStore.kt?raw';
import recorder from '../../android/app/src/main/java/com/snowmedia/dvr/RecorderPlugin.kt?raw';
import activity from '../../android/app/src/main/java/com/snowmedia/MainActivity.kt?raw';
import manifest from '../../android/app/src/main/AndroidManifest.xml?raw';
import iconXml from '../../android/app/src/main/res/drawable/ic_stat_snow.xml?raw';

const body = (src: string, from: string) => {
  const at = src.indexOf(from);
  expect(at, from).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf('\n    }\n', at));
};
const logLines = (src: string) => src.split('\n').filter((l) => /\bLog\.[a-z]\(/.test(l));
/** The code without its comments (a comment may say "password" to warn about it). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const dvr = [
  ['LiveSource', source], ['TimeshiftSession', session], ['TimeshiftManager', manager], ['TsSegmenter', segmenter],
  ['StorageBudget', budget], ['RecordingService', service], ['RecorderPlugin', recorder], ['RecordingStore', store],
] as const;

describe('stream addresses and logins are never logged', () => {
  it.each(dvr)('%s', (_name, src) => {
    for (const line of logLines(src)) {
      expect(line).not.toMatch(/\burl\b|\bu\b|e\.message|\$e\b|, e\)|, t\)/);
      expect(line).not.toMatch(/password|username|token|creds|EXTRA_URL/i);
    }
  });

  it('the rewind half of the player plugin logs no address either', () => {
    const ts = plugin.slice(plugin.indexOf('// ---- Rewind live TV (timeshift)'), plugin.indexOf('override fun handleOnDestroy()'));
    expect(ts.length).toBeGreaterThan(1000);
    for (const line of logLines(ts)) expect(line).not.toMatch(/\burl\b|currentUrl|e\.message|password|username|token/i);
  });

  it('an HTTP error keeps only its status', () => {
    expect(source).toContain('internal class HttpStatusException(val status: Int) : IOException("HTTP $status")');
    // A failed connection is re-thrown by class name, not message (which can hold the address).
    expect(source).toContain('IOException(e.javaClass.simpleName)');
  });
});

describe('the rewind buffer', () => {
  it('lives in the cache folder only', () => {
    expect(plugin).toContain('File(it, "timeshift")');
    expect(manager).not.toMatch(/getExternalFilesDir|Environment\./);
  });

  it('is wiped on Home (onStop), when the app closes, and on the WebView asking (leave / sign-out)', () => {
    expect(body(plugin, 'override fun handleOnStop()')).toContain('tsManager?.wipeAll()');
    expect(body(plugin, 'override fun handleOnDestroy()')).toContain('tsManager?.wipeAll()');
    expect(body(plugin, 'fun timeshiftWipe(call: PluginCall)')).toContain('tsManager?.wipeAll()');
    // Left-overs of a killed run go before the first new buffer.
    expect(body(plugin, 'private fun tsManager(): TimeshiftManager?')).toContain('TimeshiftManager.wipeFolder(root)');
  });

  it('keeps the old channel 5-10 s after a change', () => {
    expect(manager).toMatch(/const val GRACE_MS = (\d+)L/);
    const grace = Number(/const val GRACE_MS = (\d+)L/.exec(manager)![1]);
    expect(grace).toBeGreaterThanOrEqual(5000);
    expect(grace).toBeLessThanOrEqual(10_000);
  });

  it('never grows past the disk budget or Max rewind', () => {
    const trim = body(session, 'private fun trim()');
    expect(trim).toContain('StorageBudget.allowedBytes(');
    expect(trim).toContain('lim.maxDurationMs');
  });
});

describe('normal ExoPlayer playback reaches the rewind code only through guarded hooks', () => {
  it('play, pause, load, stop and the two listener callbacks', () => {
    expect(body(plugin, 'fun play(call: PluginCall)')).toContain('if (!(screenId == MAIN && tsOnPlay(s))) s.player?.play()');
    expect(body(plugin, 'fun pause(call: PluginCall)')).toContain('if (screenId == MAIN) tsOnPause(s)');
    expect(body(plugin, 'private fun tsOnPause(s: PlayerSlot)')).toContain('if (tsManager?.current?.alive != true) return');
    expect(body(plugin, 'private fun tsOnPlay(s: PlayerSlot)')).toContain('if (tsPausedAt == 0L || tsBuffer) { tsClearPause(); return false }');
    expect(plugin).toContain('if (state == Player.STATE_ENDED && screenId == MAIN && tsBuffer) { tsGoLive(s); return }');
    expect(plugin).toContain('if (screenId == MAIN && tsBuffer) { tsOnBufferError(s, error); return }');
    expect(body(plugin, 'private fun stopSlot(s: PlayerSlot)')).toContain('if (slots[MAIN] === s) tsReset()');
    // load(): only in the ExoPlayer branch, after the MPV branch has returned.
    const load = body(plugin, 'fun load(call: PluginCall)');
    expect(load).toContain('if (screenId == MAIN) tsReset()');
    expect(load.indexOf('return@runOnUiThread\n            }\n            if (s.player == null) buildPlayer'))
      .toBeLessThan(load.indexOf('tsReset()'));
  });

  it("SMC's mpv branches of play and pause are untouched (the hooks sit after their early return)", () => {
    const play = body(plugin, 'fun play(call: PluginCall)');
    expect(play).toContain('if (s.engine == EngineChoice.MPV) { s.second?.play(); call.resolve(); return@runOnUiThread }');
    expect(play.indexOf('s.second?.play()')).toBeLessThan(play.indexOf('tsOnPlay(s)'));
    const pause = body(plugin, 'fun pause(call: PluginCall)');
    expect(pause).toContain('if (s.engine == EngineChoice.MPV) { s.second?.pause(); call.resolve(); return@runOnUiThread }');
    expect(pause.indexOf('s.second?.pause()')).toBeLessThan(pause.indexOf('tsOnPause(s)'));
  });

  it('the load control is told it is a live stream before the buffer or the channel is prepared', () => {
    for (const fn of ['private fun tsSwitchToBuffer(', 'private fun tsGoLive(']) {
      const b = body(plugin, fn);
      expect(b).toContain('s.loadControl?.beginStream(film = false)');
      expect(b.indexOf('beginStream(film = false)')).toBeLessThan(b.indexOf('p.prepare()'));
    }
  });
});

describe('the buffer is ExoPlayer only', () => {
  it('timeshiftStart does nothing while the main slot plays on mpv', () => {
    const start = body(plugin, 'fun timeshiftStart(call: PluginCall)');
    expect(start).toContain('if (slots[MAIN]?.engine == EngineChoice.MPV) { call.resolve(); return@runOnUiThread }');
    expect(start.indexOf('EngineChoice.MPV')).toBeLessThan(start.indexOf('m.start('));
  });

  it("the player is never moved onto the buffer on mpv's slot", () => {
    expect(body(plugin, 'private fun tsSwitchToBuffer(')).toContain('s.engine != EngineChoice.EXO');
  });

  it("SMC's engine argument and MPV path are still there", () => {
    expect(plugin).toContain('val requestedEngine = call.getString("engine") ?: EngineChoice.EXO');
    expect(plugin).toContain('second.load(url, live)');
  });
});

describe('recordings', () => {
  it('go to the app folder on each drive (no permission, no document picker) and not the cache', () => {
    expect(store).toContain('getExternalFilesDirs(Environment.DIRECTORY_DOWNLOADS)');
    expect(store).not.toContain('cacheDir');
    expect(service).not.toContain('cacheDir');
  });

  it('rename and delete only touch our own recordings, and never one still recording', () => {
    expect(body(recorder, 'fun rename(call: PluginCall)')).toContain('RecordingStore.isOurs(context, from)');
    expect(body(recorder, 'fun remove(call: PluginCall)')).toContain('RecordingStore.isOurs(context, f)');
    expect(body(recorder, 'fun remove(call: PluginCall)')).toContain('Stop the recording before deleting it');
  });

  it('run as a foreground data-sync service, not exported, with its own notification', () => {
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE"');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_DATA_SYNC"');
    expect(manifest).toMatch(/android:name="com\.snowmedia\.dvr\.RecordingService"\s*android:exported="false"\s*android:foregroundServiceType="dataSync"/);
    expect(service).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC');
    expect(activity).toContain('registerPlugin(RecorderPlugin::class.java)');
    expect(recorder).toContain('@CapacitorPlugin(name = "SnowRecorder")');
  });

  it("the notification uses SMC's own small icon, which exists", () => {
    expect(service).toContain('R.drawable.ic_stat_snow');
    expect(service).toContain('import com.snowmedia.R');
    expect(iconXml).toContain('<vector');
  });

  it('the notification says a recording uses a stream on the line, with a Stop button', () => {
    const n = body(service, 'private fun buildNotification(): Notification');
    expect(n).toContain('stream on your line');
    expect(n).toContain('.addAction(0, "Stop", stop)');
  });
});

describe('the login never leaves the recording thread', () => {
  it('no PendingIntent carries the address, the path or any login: the service is not restarted with it', () => {
    for (const fn of ['private fun buildNotification(): Notification', 'private fun notifyEnded(job: Job, why: String)']) {
      const b = body(service, fn);
      expect(b).not.toMatch(/EXTRA_URL|\burl\b|EXTRA_PATH|password|username|token/i);
    }
    // The Stop button is a bare action; the open button is a bare activity intent.
    expect(service).toContain('Intent(this, RecordingService::class.java).setAction(ACTION_STOP)');
    // Android must not re-deliver a start intent (it carries the address) after the process dies.
    expect(service).toContain('return START_NOT_STICKY');
    expect(service).not.toMatch(/START_REDELIVER_INTENT|START_STICKY\b/);
  });

  it('the address goes only in one in-app intent to the service, and only the plugin builds it', () => {
    expect(recorder.match(/putExtra\(RecordingService\.EXTRA_URL/g)).toHaveLength(1);
    expect(service).not.toMatch(/putExtra\(EXTRA_URL/);
    for (const [name, src] of dvr) {
      if (name === 'RecorderPlugin') continue;
      expect(src, name).not.toMatch(/setPackage|sendBroadcast|PendingIntent\.[a-zA-Z]+\([^)]*EXTRA_URL/);
    }
  });

  it('the job, the index and the file name hold names, times and ids only', () => {
    expect(code(body(service, 'internal class Job('))).not.toMatch(/\burl\b|password|username|token/i);
    expect(code(store)).not.toMatch(/put\("url"|password|username|token|getSharedPreferences|SharedPreferences/i);
    // The file is named from the channel name the viewer sees, cleaned for any drive: never from the address.
    const fileLine = body(recorder, 'val file = RecordingStore.uniqueFile').split('\n')[0];
    expect(fileLine).toContain('RecordingStore.safeName(fileName)');
    expect(fileLine).not.toMatch(/\burl\b/);
    expect(body(recorder, 'fun start(call: PluginCall)')).toContain('val fileName = call.getString("fileName") ?: channel');
  });

  it('a recording connection that fails is logged by its class name, never its message', () => {
    expect(service).toContain('Log.w(TAG, "Recording connection dropped (${e.javaClass.simpleName})")');
    expect(service).toContain('Log.w(TAG, "Recording stopped (${t.javaClass.simpleName})")');
  });
});

describe("SMC's recorder rules", () => {
  it('stops before the box has less than 1 GB free, and before a USB drive has less than 200 MB', () => {
    expect(store).toContain('const val BOX_MIN_FREE_BYTES = 1L shl 30');
    expect(store).toContain('const val USB_MIN_FREE_BYTES = 200L * 1024L * 1024L');
    expect(store).toContain('fun minFreeBytes(removable: Boolean): Long = if (removable) USB_MIN_FREE_BYTES else BOX_MIN_FREE_BYTES');
    expect(service).toContain('if (free < job.minFreeBytes) job.stop("The drive is full")');
    // The volume the plugin picked decides which floor, and a start with no room is refused.
    expect(body(recorder, 'fun start(call: PluginCall)')).toContain('.putExtra(RecordingService.EXTRA_REMOVABLE, vol.removable)');
    expect(body(recorder, 'fun start(call: PluginCall)')).toContain('RecordingStore.minFreeBytes(vol.removable)');
    expect(body(recorder, 'fun start(call: PluginCall)')).toContain('"NO_SPACE"');
  });

  it('carries on in "(part 2).ts" at about 3.9 GB on a removable drive (FAT32 stops at 4 GB)', () => {
    const m = /const val PART_LIMIT_BYTES = (\d+)L \* 1024L \* 1024L \* 1024L \/ (\d+)L/.exec(store);
    expect(m).not.toBeNull();
    const limit = (Number(m![1]) * 1024 ** 3) / Number(m![2]);
    expect(limit / 1024 ** 3).toBeCloseTo(3.9, 5);
    expect(limit).toBeLessThan(4 * 1024 ** 3 - 1);
    expect(store).toContain('fun partLimitBytes(removable: Boolean): Long = if (removable) PART_LIMIT_BYTES else Long.MAX_VALUE');
    expect(store).toContain('"${first.name.removeSuffix(".ts")} (part $n).ts"');
    expect(body(service, 'private fun record(job: Job, url: String)')).toContain('if (partBytes >= job.partLimitBytes)');
    expect(body(service, 'private fun nextPart(')).toContain('RecordingStore.partFile(job.firstFile, n)');
    // Each part is a recording of its own, and only the one being written is "recording".
    expect(body(service, 'private fun nextPart(')).toContain('job.partId = "${job.id}-p$n"');
    expect(service).toContain('fun isActive(id: String): Boolean = jobs.values.any { !it.stopped && it.partId == id }');
  });

  it('at most two at once, and a third is refused with a plain message', () => {
    expect(service).toContain('const val MAX_SIMULTANEOUS = 2');
    expect(service).toContain('fun tryReserve(id: String, cap: Int = MAX_SIMULTANEOUS): Boolean');
    const start = body(recorder, 'fun start(call: PluginCall)');
    expect(start).toContain('RecordingService.tryReserve(id, cap)');
    expect(start).toContain('"TOO_MANY"');
    expect(start).toContain('at most $cap at once');
    // A start that can't reach the service gives its place back.
    expect(start).toContain('RecordingService.release(id)');
    // The service checks again, in the same step that registers the job.
    expect(body(service, 'private fun startJob(intent: Intent)')).toContain('>= MAX_SIMULTANEOUS');
  });

  it('a job can later carry a schedule id, a title and an absolute end (no scheduling yet)', () => {
    expect(service).toContain('const val EXTRA_ENDS_AT = "endsAt"');
    expect(service).toContain('const val EXTRA_SCHEDULE_ID = "scheduleId"');
    expect(service).toContain('const val EXTRA_TITLE = "title"');
    expect(service).not.toMatch(/AlarmManager|BroadcastReceiver/);
    expect(manifest).not.toMatch(/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
  });
});

describe('CH+ / CH- keys', () => {
  it('reach the page as chup / chdown on smc:mediakey, and a held key does not repeat', () => {
    expect(activity).toContain('KeyEvent.KEYCODE_CHANNEL_UP -> "chup"');
    expect(activity).toContain('KeyEvent.KEYCODE_CHANNEL_DOWN -> "chdown"');
    expect(activity).toMatch(/val toggles = [^\n]*\n\s*name == "chup" \|\| name == "chdown"/);
    expect(activity).toContain("new CustomEvent('smc:mediakey'");
    // Fast-forward and Rewind still repeat when held (the skip queue adds them up).
    expect(activity).not.toMatch(/toggles = [^\n]*name == "(ff|rw)"/);
  });
});
