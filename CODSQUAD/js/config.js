/* CODSQUAD public frontend configuration.
   Replace these two values with your Supabase project's URL and publishable key.
   Never put a service_role/secret key in this file. */
export const SUPABASE_URL = 'https://qqepnblhtyrrhfgmjfmr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GikC2tGRwJFour60kEv32A_cKF4xaag';

export const isSupabaseConfigured = () =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
  SUPABASE_PUBLISHABLE_KEY.length > 20 &&
  !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');
