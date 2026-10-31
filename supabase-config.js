// The project URL and publishable key are public by design (access is enforced by row-level security).
// They are used when a deployment has no VITE_SUPABASE_* variables.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://lqzcfqaayrneavkfdonm.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_JyJIWFyaun2V_mZW81S2Sw_vqE7KtA2";
