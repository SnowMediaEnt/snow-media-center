/**
 * Native text (TRACKER i18n item 10). Kotlin can't run here, so its shape is pinned the way
 * dvrNative.test.ts pins the recorder: the app's own native text (notifications, the news widget,
 * player and billing errors, the speech prompt) lives in res/values*\/strings.xml in the five app
 * languages, is read through AppLocale (the language saved from the app, never the box's), and no
 * notification text is written into the Kotlin any more.
 */
import { describe, expect, it } from 'vitest';
import en from '../../android/app/src/main/res/values/strings.xml?raw';
import es from '../../android/app/src/main/res/values-es/strings.xml?raw';
import fr from '../../android/app/src/main/res/values-fr/strings.xml?raw';
import de from '../../android/app/src/main/res/values-de/strings.xml?raw';
import ar from '../../android/app/src/main/res/values-ar/strings.xml?raw';
import appLocale from '../../android/app/src/main/java/com/snowmedia/AppLocale.kt?raw';
import service from '../../android/app/src/main/java/com/snowmedia/dvr/RecordingService.kt?raw';
import scheduler from '../../android/app/src/main/java/com/snowmedia/dvr/RecordScheduler.kt?raw';
import alarmReceiver from '../../android/app/src/main/java/com/snowmedia/dvr/ScheduleAlarmReceiver.kt?raw';
import notifier from '../../android/app/src/main/java/com/snowmedia/notify/AlertNotifier.kt?raw';
import poller from '../../android/app/src/main/java/com/snowmedia/notify/AlertPollWorker.kt?raw';
import notifyPlugin from '../../android/app/src/main/java/com/snowmedia/notify/SnowNotifyPlugin.kt?raw';
import widget from '../../android/app/src/main/java/com/snowmedia/widget/SmcNewsWidget.kt?raw';
import billingError from '../../android/app/src/main/java/com/snowmedia/billing/BillingError.kt?raw';
import player from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import appManager from '../../android/app/src/main/java/com/snowmedia/appmanager/AppManagerPlugin.kt?raw';
import cacheClear from '../../android/app/src/main/java/com/snowmedia/appmanager/CacheClearService.kt?raw';
import snowNotifyTs from './SnowNotify.ts?raw';

const FILES = { en, es, fr, de, ar } as const;
type Lang = keyof typeof FILES;
const LANGS = Object.keys(FILES) as Lang[];

interface Entry { kind: 'string' | 'plurals'; translatable: boolean; text: string; quantities: string[] }

/** name -> entry, read from the XML text (no XML parser needed for this flat file). */
function parse(xml: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const m of xml.matchAll(/<string name="(\w+)"([^>]*)>([\s\S]*?)<\/string>/g)) {
    out[m[1]] = { kind: 'string', translatable: !/translatable="false"/.test(m[2]), text: m[3], quantities: [] };
  }
  for (const m of xml.matchAll(/<plurals name="(\w+)">([\s\S]*?)<\/plurals>/g)) {
    const items = [...m[2].matchAll(/<item quantity="(\w+)">([\s\S]*?)<\/item>/g)];
    out[m[1]] = { kind: 'plurals', translatable: true, text: items.map((i) => i[2]).join('\n'), quantities: items.map((i) => i[1]) };
  }
  return out;
}
const parsed = Object.fromEntries(LANGS.map((l) => [l, parse(FILES[l])])) as Record<Lang, Record<string, Entry>>;
const translatable = (l: Lang) => Object.keys(parsed[l]).filter((k) => parsed[l][k].translatable).sort();
const placeholders = (t: string) => [...new Set(t.match(/%\d\$[sd]|%d/g) ?? [])].sort();
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('strings.xml in the five app languages', () => {
  it('is well formed', () => {
    for (const l of LANGS) {
      expect(FILES[l].trimStart().startsWith('<?xml'), l).toBe(true);
      expect((FILES[l].match(/<resources>/g) ?? []).length, l).toBe(1);
      expect((FILES[l].match(/<\/resources>/g) ?? []).length, l).toBe(1);
      expect(FILES[l], l).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    }
  });

  it.each(LANGS.filter((l) => l !== 'en'))('%s has exactly the keys English has', (l) => {
    expect(translatable(l)).toEqual(translatable('en'));
  });

  it('keeps the English-only keys (names, package, accessibility text) out of the other languages', () => {
    const fixed = Object.keys(parsed.en).filter((k) => !parsed.en[k].translatable);
    expect(fixed).toEqual(expect.arrayContaining(['app_name', 'package_name', 'custom_url_scheme', 'cache_clear_service_desc']));
    for (const l of LANGS.filter((x) => x !== 'en')) for (const k of fixed) expect(parsed[l][k], `${l}/${k}`).toBeUndefined();
  });

  it.each(LANGS)('%s: no empty text', (l) => {
    for (const k of translatable(l)) expect(parsed[l][k].text.trim(), `${l}/${k}`).not.toBe('');
  });

  it.each(LANGS.filter((l) => l !== 'en'))('%s: same kind of entry and the same %s placeholders as English', (l) => {
    for (const k of translatable('en')) {
      expect(parsed[l][k].kind, `${l}/${k}`).toBe(parsed.en[k].kind);
      if (parsed.en[k].kind === 'string') {
        expect(placeholders(parsed[l][k].text), `${l}/${k}`).toEqual(placeholders(parsed.en[k].text));
      }
    }
  });

  it('every plural has the quantities its language needs (Arabic all six; Spanish and French carry many)', () => {
    const need: Record<Lang, string[]> = {
      en: ['one', 'other'],
      de: ['one', 'other'],
      es: ['one', 'many', 'other'],
      fr: ['one', 'many', 'other'],
      ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
    };
    for (const l of LANGS) {
      for (const k of translatable(l).filter((x) => parsed[l][x].kind === 'plurals')) {
        expect([...parsed[l][k].quantities].sort(), `${l}/${k}`).toEqual([...need[l]].sort());
      }
    }
  });

  it('a placeholder-free string is not a plural with a stray number, and a plural uses its count', () => {
    for (const l of ['en', 'es', 'fr', 'de'] as Lang[]) {
      for (const k of translatable(l).filter((x) => parsed[l][x].kind === 'plurals')) {
        // "one" and "other" both show the number (Arabic's "one" and "two" may say it in words).
        for (const item of FILES[l].match(new RegExp(`<plurals name="${k}">[\\s\\S]*?</plurals>`))![0].matchAll(/<item quantity="(one|other|many)">([\s\S]*?)<\/item>/g)) {
          expect(item[2], `${l}/${k}/${item[1]}`).toMatch(/%d|%2\$d/);
        }
      }
    }
  });

  it('Arabic keeps Latin digits 0-9 in its text, and every apostrophe is escaped for aapt', () => {
    expect(ar).not.toMatch(/[٠-٩]/);
    for (const l of LANGS) for (const k of translatable(l)) expect(parsed[l][k].text, `${l}/${k}`).not.toMatch(/(^|[^\\])['"]/);
  });
});

describe('AppLocale: the language is the app\'s saved choice, not the box\'s', () => {
  it('reads and writes SharedPreferences, defaults to English and knows the five', () => {
    expect(appLocale).toContain('val SUPPORTED: List<String> = listOf("en", "es", "fr", "de", "ar")');
    expect(appLocale).toContain('const val DEFAULT = "en"');
    expect(appLocale).toContain('getSharedPreferences(PREFS, Context.MODE_PRIVATE)');
    // Nothing takes the box's language.
    expect(code(appLocale)).not.toMatch(/Locale\.getDefault|Resources\.getSystem|configuration\.locale\b/);
  });

  it('keeps Arabic digits at 0-9 and the clock at 12 hours', () => {
    expect(appLocale).toContain('Locale.forLanguageTag("ar-u-nu-latn")');
    expect(appLocale).toContain('SimpleDateFormat("h:mm a", locale(ctx))');
  });

  it('gives the speech recogniser a tag for each language', () => {
    for (const tag of ['es-US', 'fr-FR', 'de-DE', 'ar-SA', 'en-US']) expect(appLocale).toContain(`"${tag}"`);
  });

  it('SnowNotify.setLanguage saves it, renames the channels that exist and redraws the widget', () => {
    expect(notifyPlugin).toContain('fun setLanguage(call: PluginCall)');
    expect(notifyPlugin).toContain('AppLocale.setLanguage(context, lang)');
    expect(notifyPlugin).toContain('AlertNotifier.ensureChannel(context)');
    expect(notifyPlugin).toContain('RecordingService.ensureChannel(context)');
    expect(notifyPlugin).toContain('AppWidgetManager.ACTION_APPWIDGET_UPDATE');
    expect(notifyPlugin).toContain('AppLocale.attach(context)');
    expect(snowNotifyTs).toContain('setLanguage(options: { lang: string }): Promise<{ lang?: string }>;');
  });

  it('both notification channels are created again on every call, so a new language renames them', () => {
    for (const src of [service, notifier]) {
      const fn = src.slice(src.indexOf('fun ensureChannel('));
      expect(fn.slice(0, fn.indexOf('\n    }\n') > 0 ? fn.indexOf('\n    }\n') : 900)).not.toContain('getNotificationChannel(CHANNEL_ID) != null) return');
      expect(fn).toContain('AppLocale.string(');
    }
  });

  it('speech recognition gets the app\'s language, in both flows', () => {
    expect(appManager.match(/putExtra\(RecognizerIntent\.EXTRA_LANGUAGE, AppLocale\.speechTag\(context\)\)/g)).toHaveLength(2);
    expect(appManager).not.toContain('Locale.getDefault()');
    expect(appManager).toContain('AppLocale.string(context, R.string.voice_speak_now)');
  });

  it('CacheClearService is untouched: it matches Android\'s own English "Clear cache" text', () => {
    expect(cacheClear).not.toContain('AppLocale');
    expect(cacheClear).not.toContain('R.string');
  });
});

describe('no notification or widget text is written into the Kotlin any more', () => {
  const noticeCalls = [
    /\.setContentTitle\(\s*"/, /\.setContentText\(\s*"/, /\.addAction\([^)]*"[A-Za-z]/,
    /NotificationChannel\([^)]*"[A-Za-z ]+"/, /description = "/,
  ];
  const files = [
    ['RecordingService', service], ['RecordScheduler', scheduler], ['ScheduleAlarmReceiver', alarmReceiver],
    ['AlertNotifier', notifier], ['AlertPollWorker', poller],
  ] as const;

  it.each(files)('%s: titles, texts, actions and channel names come from strings.xml', (_n, src) => {
    for (const re of noticeCalls) expect(code(src)).not.toMatch(re);
  });

  it('RecordScheduler and ScheduleAlarmReceiver post only translated titles and texts', () => {
    // notify(ctx, key, title, text): the last two arguments are AppLocale calls or a reason text.
    for (const call of code(scheduler + alarmReceiver).matchAll(/\bnotify\(\s*ctx,\s*[^,]+,\s*(\S[^\n]*)/g)) {
      expect(call[1], call[0]).toMatch(/^AppLocale\.string\(/);
    }
    expect(code(alarmReceiver)).not.toMatch(/notify\([^)]*"[A-Za-z]/);
    expect(alarmReceiver).toContain('RecordScheduler.movedToBox(ctx, s)');
  });

  it('the alert poller\'s "Now on Plex" notice comes from strings.xml; the Hub\'s own alert text is passed on as it is', () => {
    expect(poller).toContain('AppLocale.string(applicationContext, R.string.alert_plex_title)');
    expect(poller).toContain('AppLocale.string(applicationContext, R.string.alert_plex_ready, title)');
    expect(code(poller)).not.toMatch(/"Now on Plex"|is ready to watch/);
    expect(notifier).toContain('.setContentText(alert.message)');
  });

  it('the recording notification and the stored reasons: only the stored reasons stay English, and the notification maps them', () => {
    const consts = [...service.matchAll(/private const val (REASON_\w+) = "([^"]+)"/g)].map((m) => m[1]);
    expect(consts.sort()).toEqual(['REASON_DRIVE_FULL', 'REASON_DRIVE_REMOVED', 'REASON_UNSUPPORTED', 'REASON_WRITE_FAILED']);
    for (const c of consts) expect(service).toContain(`${c} -> AppLocale.string(this, R.string.`);
    expect(code(service)).not.toMatch(/job\.stop\("/);
    // ScheduleReasons stay as stored; the notification translates the seven it knows.
    expect(scheduler.match(/ScheduleReasons\.\w+ -> R\.string\.sched_reason_\w+/g)).toHaveLength(7);
  });

  it('SmcNewsWidget: every line of the status and the headline fallback comes from strings.xml', () => {
    for (const key of ['widget_open_app', 'widget_not_signed_in', 'widget_line_fallback', 'widget_trial', 'widget_active', 'widget_expired', 'widget_expires_today']) {
      expect(widget).toContain(`R.string.${key}`);
    }
    expect(widget).toContain('R.plurals.widget_days_left');
    expect(code(widget)).not.toMatch(/AccountStatus\("[A-Za-z]|"Open Snow Media|" days? left|Locale\.getDefault/);
    expect(widget).toContain('AppLocale.clock(context, System.currentTimeMillis())');
  });

  it('BillingError: its own messages come from strings.xml; the server\'s message is passed on as sent', () => {
    for (const key of ['billing_network', 'billing_bad_response', 'billing_cancelled', 'billing_http_401', 'billing_http_403', 'billing_http_404', 'billing_http_429', 'billing_http_5xx', 'billing_request_failed']) {
      expect(billingError).toContain(`R.string.${key}`);
    }
    expect(code(billingError)).not.toMatch(/"(Could not reach|The billing server|Stopped|Please sign in|This account|That item|Too many|Request failed)/);
    expect(billingError).toContain('err?.str("message")?.takeIf { it.isNotBlank() } ?: defaultMessage(status)');
    // The code the web layer switches on is never translated.
    expect(billingError).toContain('BillingError("network"');
    expect(billingError).toContain('BillingError("bad_response"');
  });

  it('SnowPlayerPlugin: the messages it sends the WebView come from strings.xml', () => {
    for (const key of ['player_err_stream_dropping', 'player_err_server_stopped', 'player_err_refused', 'player_err_refused_status', 'player_err_plex_refused', 'player_err_plex_refused_status', 'player_err_playback', 'player_err_audio']) {
      expect(player).toContain(`R.string.${key}`);
    }
    expect(code(player)).not.toMatch(/put\("message", "[A-Za-z]|\?: "Playback error"|\?: "Audio decoder failed"|"The (Plex )?server /);
  });
});
