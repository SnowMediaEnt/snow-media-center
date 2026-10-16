// The "Player Reports" account: tickets from people with no Snow Media
// account (guest tickets, channel reports, requests from a TV) are filed
// under it, so a guest can never file one as somebody else. report-channel
// made it first; device-inbox files under it too.
import type { createClient } from 'npm:@supabase/supabase-js@2';

export const PLAYER_REPORTS_EMAIL = 'player-reports@snowmediaapps.com';
const PLAYER_REPORTS_NAME = 'Player Reports';
let cachedId: string | null = null;

/** The account's user id, made the first time it is needed. Throws when it can be neither made nor found. */
export async function playerReportsUserId(admin: ReturnType<typeof createClient>): Promise<string> {
  if (cachedId) return cachedId;

  // Try create; if already exists, page through users to find it.
  const created = await admin.auth.admin.createUser({
    email: PLAYER_REPORTS_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { full_name: PLAYER_REPORTS_NAME },
  });

  let userId: string | null = created.data?.user?.id ?? null;

  if (!userId) {
    // Fall back to lookup — paginate auth users.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((u) => (u.email || '').toLowerCase() === PLAYER_REPORTS_EMAIL);
      if (match) userId = match.id;
      if (!data.users.length || data.users.length < 200) break;
    }
  }

  if (!userId) throw new Error('Failed to resolve the Player Reports user');

  // Ensure a profiles row exists so the admin dashboard join renders a name/email.
  await admin.from('profiles').upsert(
    { user_id: userId, email: PLAYER_REPORTS_EMAIL, full_name: PLAYER_REPORTS_NAME },
    { onConflict: 'user_id' },
  );

  cachedId = userId;
  return userId;
}
