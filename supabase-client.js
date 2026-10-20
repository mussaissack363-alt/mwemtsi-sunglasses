import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bjjyotduxvcwcuaztxgj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dVi5KufBJGYDM6slTAz0Hw_VN4XsRTq';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
