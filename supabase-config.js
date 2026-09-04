/* Public browser configuration. Keep the service_role key out of this repository. */
window.SEVER_SUPABASE_CONFIG = window.SEVER_SUPABASE_CONFIG || {
  url: '',
  anonKey: ''
};

window.SEVER_CLOUD_ENABLED = Boolean(
  window.SEVER_SUPABASE_CONFIG.url && window.SEVER_SUPABASE_CONFIG.anonKey
);
