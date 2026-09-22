/**
 * Lightweight, silent analytics client.
 *
 * Design goals:
 *  - Never block UI, navigation, alerts, or app launches.
 *  - All work runs async/microtask; failures swallowed.
 *  - Events batched (flush every 5s or 20 events).
 *  - Small offline queue persisted to localStorage (cap 200).
 *  - No PII collection beyond signed-in user_id (when available).
 */
import { supabase } from "@/integrations/supabase/client";
import { isDemo } from "@/lib/demoMode";

type EventRow = {
  device_id: string;
  session_id: string | null;
  user_id: string | null;
  event_name: string;
  event_category?: string | null;
  properties?: Record<string, unknown>;
  app_version?: string | null;
  platform?: string | null;
  reseller_id?: string | null;
  occurred_at: string;
};

const APP_VERSION =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_VERSION) || "1.0.0";
const DEVICE_KEY = "smc_device_id";
const QUEUE_KEY = "smc_analytics_queue";
const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
const FLUSH_MS = 5000;

let deviceId: string = "";
let sessionId: string | null = null;
let sessionStartMs: number | null = null;
let userId: string | null = null;
let started = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let queue: EventRow[] = [];

const safe = <T,>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

const uuid = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return (crypto as any).randomUUID();
  } catch {}
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

const detectPlatform = (): string => {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Android TV|GoogleTV|BRAVIA|AFT/i.test(ua)) return "androidtv";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "web";
};

const platform = safe(detectPlatform) ?? "unknown";

// Demo latch (?demo=1): analytics is a hard no-op in demo so marketing-site
// visitors never pollute the production analytics tables. Always false on
// native, so this is dead code in the APK.
const DEMO = isDemo();

const loadQueue = () => {
  safe(() => {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) queue = JSON.parse(raw) || [];
  });
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistQueue = () => {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  safe(() => {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  });
};

// Every tracked event used to serialise the whole queue (up to 200 events)
// to localStorage on the main thread, and opening the Player fires about
// ten of them in a row. Coalesce: one write two seconds after the last
// event. Flush and hide still write at once, so nothing is lost on exit.
const persistQueueSoon = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistQueue(); }, 2000);
};

const getOrCreateDeviceId = (): string => {
  const existing = safe(() => localStorage.getItem(DEVICE_KEY));
  if (existing) return existing;
  const id = uuid();
  safe(() => localStorage.setItem(DEVICE_KEY, id));
  return id;
};

/**
 * Returns the persisted per-device id, creating it on first use.
 * Safe to call from any module — used to attribute anonymous AI usage.
 */
export const getDeviceId = (): string => {
  if (deviceId) return deviceId;
  deviceId = getOrCreateDeviceId();
  return deviceId;
};

const flush = async () => {
  if (queue.length === 0) {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    return;
  }
  const batch = queue.splice(0, BATCH_SIZE);
  persistQueue();
  try {
    const { error } = await supabase.from("analytics_events").insert(batch as any);
    if (error) {
      // Re-queue on failure (bounded)
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
      persistQueue();
    }
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    persistQueue();
  }
};

// Armed when something is queued, dropped again once the queue drains (see
// flush), so an idle app is not woken every five seconds for nothing.
const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_MS);
};

/** Track an event. Never throws. Fire-and-forget. */
export const trackEvent = (
  name: string,
  category?: string,
  properties?: Record<string, unknown>
) => {
  if (DEMO) return;
  safe(() => {
    if (!deviceId) return;
    queue.push({
      device_id: deviceId,
      session_id: sessionId,
      user_id: userId,
      event_name: name.slice(0, 128),
      event_category: category?.slice(0, 64) ?? null,
      properties: properties ?? {},
      app_version: APP_VERSION,
      platform,
      reseller_id: null,
      occurred_at: new Date().toISOString(),
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persistQueueSoon();
    if (queue.length >= BATCH_SIZE) {
      // fire async; do not await
      void flush();
    } else {
      scheduleFlush();
    }
  });
};

/** Track a lightweight crash/error. Never loops. */
export const trackCrash = (message: string, stack?: string, component?: string) => {
  if (DEMO) return;
  safe(() => {
    if (!deviceId) return;
    try {
      void supabase
        .from("analytics_crashes")
        .insert({
          device_id: deviceId,
          session_id: sessionId,
          user_id: userId,
          message: (message || "").slice(0, 4000),
          stack: (stack || "").slice(0, 16000),
          component: component?.slice(0, 128) ?? null,
          severity: "error",
          app_version: APP_VERSION,
          platform,
        } as any);
    } catch {}
  });
};


const startSession = async () => {
  sessionId = uuid();
  sessionStartMs = Date.now();
  const row = {
    session_id: sessionId,
    device_id: deviceId,
    user_id: userId,
    started_at: new Date().toISOString(),
    app_version: APP_VERSION,
    platform,
  };
  try {
    await supabase.from("analytics_sessions").insert(row as any);
  } catch {}
};

const upsertDevice = async () => {
  try {
    await supabase.from("analytics_devices").upsert(
      {
        device_id: deviceId,
        platform,
        app_version: APP_VERSION,
        last_seen_at: new Date().toISOString(),
        last_user_id: userId,
      } as any,
      { onConflict: "device_id" }
    );
  } catch {}
};

const endSession = () => {
  if (!sessionId) return;
  const durationSeconds = sessionStartMs
    ? Math.max(0, Math.round((Date.now() - sessionStartMs) / 1000))
    : null;
  const payload: any = { ended_at: new Date().toISOString() };
  if (durationSeconds !== null) payload.duration_seconds = durationSeconds;
  safe(() => {
    void supabase.from("analytics_sessions").update(payload).eq("session_id", sessionId!);
  });
};

/** Initialize once at app startup. Safe to call multiple times. */
export const initAnalytics = () => {
  if (started) return;
  started = true;

  // Defer everything to idle/microtask so we never block first paint.
  const boot = () => {
    safe(() => {
      // Demo: no sessions, no device upserts, no queue flush, no listeners.
      if (DEMO) return;
      deviceId = getOrCreateDeviceId();
      loadQueue();

      // Resolve current user (non-blocking)
      supabase.auth
        .getUser()
        .then(({ data }) => {
          userId = data?.user?.id ?? null;
          void upsertDevice();
          void startSession();
          trackEvent("app_open", "lifecycle");
        })
        .catch(() => {
          void upsertDevice();
          void startSession();
          trackEvent("app_open", "lifecycle");
        });

      // Listen for auth changes to attach user_id to subsequent events
      safe(() => {
        supabase.auth.onAuthStateChange((event, session) => {
          const prevUserId = userId;
          userId = session?.user?.id ?? null;
          if (userId) void upsertDevice();
          if (event === 'SIGNED_IN' && userId && userId !== prevUserId) {
            trackEvent('user_signed_in', 'auth', { email: session?.user?.email });
          }
          if (event === 'SIGNED_OUT') {
            trackEvent('user_signed_out', 'auth');
          }
        });
      });

      scheduleFlush();

      // Anything that was being timed when the app last died.
      recoverTimers();

      // Flush on hide / unload
      safe(() => {
        window.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            stopAllTimers("app_hidden");
            void flush();
            endSession();
          }
        });
        window.addEventListener("pagehide", () => {
          stopAllTimers("app_closed");
          void flush();
          endSession();
        });
      });

      // Lightweight global error capture (no loops)
      let lastCrashAt = 0;
      safe(() => {
        window.addEventListener("error", (e) => {
          const now = Date.now();
          if (now - lastCrashAt < 2000) return;
          lastCrashAt = now;
          trackCrash(e.message, e.error?.stack, "window.error");
        });
        window.addEventListener("unhandledrejection", (e: any) => {
          const now = Date.now();
          if (now - lastCrashAt < 2000) return;
          lastCrashAt = now;
          const reason = e?.reason;
          trackCrash(
            typeof reason === "string" ? reason : reason?.message || "unhandledrejection",
            reason?.stack,
            "unhandledrejection"
          );
        });
      });
    });
  };

  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(boot, { timeout: 2000 });
  } else {
    setTimeout(boot, 0);
  }
};

/* ---------------------------------------------------------------------------
 * Dwell and watch timers
 *
 * "How long were they in there" questions (time in the Player, time on a
 * game, time watching one channel or one film) need a start and an end, and
 * on a TV box the end is often the power button. So every open timer is
 * persisted with a heartbeat: if the app dies mid-watch, the next launch
 * reports what it knows, marked `recovered`, instead of losing the session.
 *
 * Keys are caller-chosen and unique per thing being timed ("player",
 * "watch:live", "game:slots"). Starting a key that is already open closes the
 * old one first, so a channel change or a new film reports the previous one.
 * ------------------------------------------------------------------------- */

type OpenTimer = {
  event: string;
  category: string;
  props: Record<string, unknown>;
  startedAt: number;
  beatAt: number;
};

const TIMERS_KEY = "smc_analytics_timers";
const BEAT_MS = 30_000;
/** Anything longer than this is a box left on, not a person watching. */
const MAX_TIMER_SECONDS = 12 * 60 * 60;

const timers: Record<string, OpenTimer> = {};
let beatTimer: ReturnType<typeof setInterval> | null = null;

const persistTimers = () => {
  safe(() => {
    if (Object.keys(timers).length === 0) localStorage.removeItem(TIMERS_KEY);
    else localStorage.setItem(TIMERS_KEY, JSON.stringify(timers));
  });
};

const scheduleBeat = () => {
  if (beatTimer) return;
  beatTimer = setInterval(() => {
    safe(() => {
      const now = Date.now();
      let dirty = false;
      for (const key of Object.keys(timers)) {
        timers[key].beatAt = now;
        dirty = true;
      }
      if (dirty) persistTimers();
      else if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    });
  }, BEAT_MS);
};

const emitTimer = (
  timer: OpenTimer,
  endedAt: number,
  extra?: Record<string, unknown>,
) => {
  const seconds = Math.max(0, Math.round((endedAt - timer.startedAt) / 1000));
  if (seconds > MAX_TIMER_SECONDS) return seconds;
  trackEvent(timer.event, timer.category, {
    ...timer.props,
    ...(extra ?? {}),
    duration_seconds: seconds,
    duration_minutes: Math.round((seconds / 60) * 10) / 10,
  });
  return seconds;
};

/** Reports any timer left open by a crash, a kill or the power button. */
const recoverTimers = () => {
  safe(() => {
    const raw = localStorage.getItem(TIMERS_KEY);
    localStorage.removeItem(TIMERS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, OpenTimer>;
    for (const timer of Object.values(saved ?? {})) {
      if (!timer?.event || !timer.startedAt) continue;
      // The last heartbeat is the last moment we know the app was alive.
      emitTimer(timer, timer.beatAt || timer.startedAt, { recovered: true });
    }
  });
};

/**
 * Starts timing something. Call the matching stopTimer when it ends; a start
 * on the same key, or an app that never comes back, closes it too.
 */
export const startTimer = (
  key: string,
  event: string,
  category = "engagement",
  properties?: Record<string, unknown>,
) => {
  if (DEMO) return;
  safe(() => {
    if (timers[key]) stopTimer(key);
    const now = Date.now();
    timers[key] = {
      event,
      category,
      props: properties ?? {},
      startedAt: now,
      beatAt: now,
    };
    persistTimers();
    scheduleBeat();
  });
};

/** Ends a timer and records how long it ran. Returns the seconds, or null. */
export const stopTimer = (
  key: string,
  extraProperties?: Record<string, unknown>,
): number | null => {
  if (DEMO) return null;
  let seconds: number | null = null;
  safe(() => {
    const timer = timers[key];
    if (!timer) return;
    delete timers[key];
    persistTimers();
    seconds = emitTimer(timer, Date.now(), extraProperties);
  });
  return seconds;
};

/** True while `key` is being timed. */
export const isTimerOpen = (key: string): boolean => !!timers[key];

/** Ends every open timer — used when the app goes to the background. */
const stopAllTimers = (reason: string) => {
  for (const key of Object.keys(timers)) stopTimer(key, { ended_by: reason });
};

/* ---------------------------------------------------------------------------
 * Session flags
 *
 * One-bit facts about this run of the app that another event wants to carry.
 * "Did they open the content bar before going into the Player" is answered by
 * reading the flag when player_open fires, instead of joining two event
 * streams later.
 * ------------------------------------------------------------------------- */

const sessionFlags = new Set<string>();

export const markSessionFlag = (name: string) => {
  safe(() => sessionFlags.add(name));
};

export const hasSessionFlag = (name: string): boolean => sessionFlags.has(name);

/** Convenience helpers used throughout the UI. All silent. */
export const trackScreenView = (screen: string) =>
  trackEvent("screen_view", "navigation", { screen });
export const trackButtonClick = (label: string, screen?: string) =>
  trackEvent("button_click", "interaction", { label, screen });
export const trackAppLaunch = (app: string) => {
  trackEvent("app_launched", "apps", { app });
  try {
    const slug = (app || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (slug) trackEvent(`${slug}_launch`, "apps", { app });
  } catch {}
};
export const trackAlertShown = (title: string) =>
  trackEvent("alert_shown", "alerts", { title });
