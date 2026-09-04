/* Copy these public values to supabase-config.js before deploying. */
window.SEVER_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY'
};

/* Never put a service_role key in this file. RLS protects browser requests. */
window.SEVER_CLOUD_ENABLED = true;
