/**
 * Where users send hand-made volume lists, and where the approved ones come back from.
 *
 * Lists go to a small Supabase table (`supabase/schema.sql`). Row-level security lets anyone insert an unapproved row
 * and read approved rows only, so the key below is safe to ship in the app: it is the public (publishable) key, never
 * the secret one. The maintainer approves rows in the Supabase dashboard. Approved lists reach every user's app by
 * themselves (see `remoteRules.ts`), and `npm run volumes:import` copies them into `src/data/volumeRules.json` for git.
 *
 * While `SUPABASE_KEY` is empty, sending is switched off: the Share dialog still lets people copy or download the list.
 */
export const SUPABASE_URL = 'https://pguaxzoqhdsujwtmiios.supabase.co';
/** The publishable (anon) key from Project Settings, API Keys. Never put the secret / service_role key here. */
export const SUPABASE_KEY = 'sb_publishable_KBXOGMc_xqmJS0rDMqg9Aw_QThw6mOK';

export const COMMUNITY_ENABLED = SUPABASE_KEY.length > 0;
