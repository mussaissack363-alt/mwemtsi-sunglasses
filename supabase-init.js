const SUPABASE_URL = 'https://bjjyotduxvcwcuaztxgj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dVi5KufBJGYDM6slTAz0Hw_VN4XsRTq';

window.mwemtsiSupabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
