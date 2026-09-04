/* Public browser configuration. Keep the service_role key out of this repository. */
window.SEVER_SUPABASE_CONFIG = window.SEVER_SUPABASE_CONFIG || {
  url: 'https://vdhazibkfpgclcwyvvbi.supabase.co',
  // Public publishable key; RLS remains the authority for every row.
  anonKey: 'sb_publishable_eRp5yJyhKF9EBTDdhi77_Q_iGaZJaUj'
};

window.SEVER_CLOUD_ENABLED = Boolean(
  window.SEVER_SUPABASE_CONFIG.url && window.SEVER_SUPABASE_CONFIG.anonKey
);
