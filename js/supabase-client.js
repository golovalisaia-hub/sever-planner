(() => {
  let clientPromise = null;
  const config = () => window.SEVER_SUPABASE_CONFIG || {};
  const configured = () => Boolean(config().url && config().anonKey);

  window.SeverSupabase = {
    configured,
    async getClient() {
      if (!configured()) throw new Error('Supabase не настроен');
      if (!clientPromise) {
        clientPromise = import('https://esm.sh/@supabase/supabase-js@2.57.4')
          .then(({ createClient }) => createClient(config().url, config().anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
          }));
      }
      return clientPromise;
    }
  };
})();
