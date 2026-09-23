import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { onViewerChange, resolveViewer, viewerAccountId } from '@/lib/viewer';
import type { KidsGameResult } from './types';
import { cleanRecord, completeRound, KIDS_GAME_IDS, mergeRecord, readProgress, writeProgress, type KidsGameId, type ProgressBook, type ProgressRecord } from './progress';

// viewer_profiles and kids_game_progress are newer than the generated client types.
type ProgressTable = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as ProgressTable;

const localKey = (owner: string, profileId: string) => `smc-kids-progress-v1:${owner}:${profileId}`;

export function useKidsProgress(profileId: string) {
  const [owner, setOwner] = useState<string | null>(() => viewerAccountId());
  const key = localKey(owner ?? 'device', profileId);
  const [book, setBook] = useState<ProgressBook>(() => readProgress(key));

  useEffect(() => {
    const refresh = () => setOwner(viewerAccountId());
    const unsubscribe = onViewerChange(refresh);
    void resolveViewer().then(refresh);
    return unsubscribe;
  }, []);

  useEffect(() => { setBook(readProgress(key)); }, [key]);

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await db.from('kids_game_progress').select('*')
          .eq('user_id', owner).eq('profile_id', profileId);
        if (cancelled || error || !Array.isArray(data)) return;
        const next = readProgress(key);
        const cloudByGame = new Map<KidsGameId, ProgressRecord>();
        for (const row of data) {
          if (!KIDS_GAME_IDS.includes(row.game_id as KidsGameId)) continue;
          const gameId = row.game_id as KidsGameId;
          cloudByGame.set(gameId, cleanRecord({
            plays: row.plays, bestScore: row.best_score, stars: row.stars,
            level: row.level, updatedAt: Date.parse(row.updated_at) || 0,
          }));
        }
        for (const gameId of KIDS_GAME_IDS) {
          const local = next[gameId];
          const cloud = cloudByGame.get(gameId);
          if (!local && !cloud) continue;
          const merged = mergeRecord(local, cloud);
          next[gameId] = merged;
          if (local && (!cloud || merged.updatedAt > cloud.updatedAt)) void saveCloud(owner, profileId, gameId, merged);
        }
        if (cancelled) return;
        writeProgress(key, next);
        setBook(next);
      } catch { /* local progress is available offline */ }
    })();
    return () => { cancelled = true; };
  }, [key, owner, profileId]);

  const complete = useCallback((gameId: KidsGameId, result: KidsGameResult) => {
    if (!KIDS_GAME_IDS.includes(gameId)) return;
    const current = readProgress(key);
    const record = completeRound(current[gameId], result);
    const next = { ...current, [gameId]: record };
    writeProgress(key, next);
    setBook(next);
    if (owner) void saveCloud(owner, profileId, gameId, record);
  }, [key, owner, profileId]);

  return { book, complete };
}

async function saveCloud(owner: string, profileId: string, gameId: KidsGameId, record: ProgressRecord) {
  try {
    const { error } = await db.from('kids_game_progress').upsert({
      user_id: owner, profile_id: profileId, game_id: gameId,
      plays: record.plays, best_score: record.bestScore,
      stars: record.stars, level: record.level,
      updated_at: new Date(record.updatedAt).toISOString(),
    }, { onConflict: 'user_id,profile_id,game_id' });
    if (error) return;
  } catch { /* keep the local save; retry after a future visit */ }
}
