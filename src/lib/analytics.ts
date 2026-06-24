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

const loadQueue = () => {
  safe(() => {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) queue = JSON.parse(raw) || [];
  });
};

const persistQueue = () => {
  safe(() => {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  });
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
  if (queue.length === 0) return;
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
    persistQueue();
    if (queue.length >= BATCH_SIZE) {
      // fire async; do not await
      void flush();
    }
  });
};

/** Track a lightweight crash/error. Never loops. */
export const trackCrash = (message: string, stack?: string, component?: string) => {
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

      // Flush on hide / unload
      safe(() => {
        window.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            void flush();
            endSession();
          }
        });
        window.addEventListener("pagehide", () => {
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
