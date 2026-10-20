// Supabase configuration
const SUPABASE_URL = 'https://bjjyotduxvcwcuaztxgj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dVi5KufBJGYDM6slTAz0Hw_VN4XsRTq';

// Initialize Supabase client if available
let supabase = null;
if (typeof window !== 'undefined' && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
