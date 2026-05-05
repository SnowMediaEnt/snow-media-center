// Sync the public.apps table from https://snowmediaapps.com/apps/apps.json.php
// - Public function (no auth required) — mirrors a public file
// - Uses service role to bypass RLS for the upsert
// - Preserves manually-edited metadata (description, icon_url, package_name, category)
// - Soft-disables rows whose filename is no longer in the feed (is_available = false)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FEED_URL = "https://snowmediaapps.com/apps/apps.json.php";

// Pretty display names for known build variants. Anything not listed
// falls back to a title-cased version of the PHP `name` field.
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "Dreamstreams3.0.apk": "Dreamstreams 3.0",
  "DreamStreams(2.2.2).apk": "Dreamstreams 2.2.2",
  "ipvanishlatest.apk": "IPVanish (Latest)",
  "IPVanishTV.apk": "IPVanish (TV)",
  "IPVanishMobile.apk": "IPVanish (Mobile)",
  "firestickplex.apk": "Plex (FireTV)",
  "androidplex.apk": "Plex (Android Box)",
  "kodilatest.apk": "Kodi",
  "stremiolatest.apk": "Stremio",
  "VibezTVlatest.apk": "VibezTV",
  "ATV_Launcher_0.1.5-pro.apk": "ATV Launcher Pro",
  "ProjectivyLauncher-4.68-c82-xda-release.apk": "Projectivy Launcher",
  "ES File Explorer Pro 1.1.4.1.apk": "ES File Explorer Pro",
  "Speedtest(ookla).apk": "Speedtest (Ookla)",
  "ooklaspeedtest.apk": "Ookla Speedtest",
  "Downloader 1.5.1.apk": "Downloader",
  "iptvsmarterspro.apk": "IPTV Smarters Pro",
  "OmniMax-7.0-v1000.apk": "OmniMax 7.0",
  "snowmediacenter.apk": "Snow Media Center",
  "TeamViewerQS.apk": "TeamViewer QuickSupport",
  "quicksupport.apk": "QuickSupport",
};

interface PhpApp {
  id?: string;
  name?: string;
  file?: string;
  url?: string;
  icon?: string | null;
  version?: string | null;
  size?: string | null;
  featured?: boolean;
  support?: boolean;
}

interface SyncResult {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  total: number;
  durationMs: number;
  error?: string;
}

function prettyName(file: string, fallbackName: string): string {
  if (DISPLAY_NAME_OVERRIDES[file]) return DISPLAY_NAME_OVERRIDES[file];
  // Title-case the fallback (e.g. "cyberflix" -> "Cyberflix")
  return fallbackName
    .replace(/\.apk$/i, "")
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Fetch the PHP feed
    console.log("[sync-apps] Fetching feed:", FEED_URL);
    const feedRes = await fetch(`${FEED_URL}?ts=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!feedRes.ok) {
      throw new Error(
        `Feed fetch failed: HTTP ${feedRes.status} ${feedRes.statusText}`,
      );
    }
    const feedJson = await feedRes.json();
    const feedApps: PhpApp[] = Array.isArray(feedJson)
      ? feedJson
      : (feedJson?.apps ?? []);

    if (!Array.isArray(feedApps) || feedApps.length === 0) {
      throw new Error("Feed returned no apps");
    }
    console.log(`[sync-apps] Feed contains ${feedApps.length} apps`);

    // 2. Load current rows so we can preserve manually-edited metadata
    const { data: existingRows, error: loadErr } = await supabase
      .from("apps")
      .select(
        "id, external_id, description, icon_url, package_name, category, is_featured, source",
      );
    if (loadErr) throw loadErr;

    const existingByExternal = new Map<string, typeof existingRows[number]>();
    for (const row of existingRows ?? []) {
      if (row.external_id) existingByExternal.set(row.external_id, row);
    }

    // 3. Build upsert payloads
    const seenExternalIds = new Set<string>();
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;

    const upsertRows = feedApps
      .filter((app) => app.file && app.url)
      .map((app) => {
        const externalId = app.file as string;
        seenExternalIds.add(externalId);

        const existing = existingByExternal.get(externalId);
        const isNew = !existing;
        if (isNew) added++;
        else updated++;

        // Default category: "support" if PHP says so, else "main".
        const inferredCategory = app.support ? "support" : "main";

        return {
          // Do not send `id` in mixed upsert batches. Supabase/PostgREST fills
          // missing ids as null when other rows include id, breaking new apps.
          // `external_id` is the conflict key, so existing rows still update.
          external_id: externalId,
          name: prettyName(externalId, app.name ?? externalId),
          description:
            existing?.description && existing.description.trim().length > 0
              ? existing.description
              : `${app.name ?? externalId}${
                app.version ? ` v${app.version}` : ""
              }`,
          size: app.size ?? "Unknown",
          version: app.version ?? null,
          download_url: app.url as string,
          icon_url: existing?.icon_url ?? app.icon ?? null,
          // Preserve manually-set category/featured/package_name; otherwise use feed
          category: existing?.category ?? inferredCategory,
          is_featured: existing?.is_featured ?? Boolean(app.featured),
          package_name: existing?.package_name ?? null,
          is_available: true,
          source: "php",
          last_synced_at: now,
        };
      });

    // 4. Upsert in one call
    const { error: upsertErr } = await supabase
      .from("apps")
      .upsert(upsertRows, { onConflict: "external_id" });
    if (upsertErr) {
      console.error("[sync-apps] Upsert error:", JSON.stringify(upsertErr));
      throw new Error(`Upsert failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }

    // 5. Soft-disable rows whose filename is no longer in the feed
    //    (only touch rows that were sourced from PHP — leave manual rows alone)
    let removed = 0;
    const { data: phpRows, error: listErr } = await supabase
      .from("apps")
      .select("id, external_id")
      .eq("source", "php")
      .eq("is_available", true);
    if (listErr) {
      console.warn("[sync-apps] List for soft-disable failed:", JSON.stringify(listErr));
    } else if (phpRows) {
      const staleIds = phpRows
        .filter((r) => r.external_id && !seenExternalIds.has(r.external_id))
        .map((r) => r.id);
      if (staleIds.length > 0) {
        const { error: disableErr } = await supabase
          .from("apps")
          .update({ is_available: false, last_synced_at: now })
          .in("id", staleIds);
        if (disableErr) {
          console.warn("[sync-apps] Soft-disable failed:", JSON.stringify(disableErr));
        } else {
          removed = staleIds.length;
        }
      }
    }

    const result: SyncResult = {
      ok: true,
      added,
      updated,
      removed,
      total: upsertRows.length,
      durationMs: Date.now() - startedAt,
    };
    console.log("[sync-apps] Done:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
    console.error("[sync-apps] Error:", message);
    const result: SyncResult = {
      ok: false,
      added: 0,
      updated: 0,
      removed: 0,
      total: 0,
      durationMs: Date.now() - startedAt,
      error: message,
    };
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
