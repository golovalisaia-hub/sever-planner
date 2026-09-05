(() => {
  let clientPromise = null;
  const config = () => window.SEVER_SUPABASE_CONFIG || {};
  const configured = () => Boolean(config().url && config().anonKey);

  window.SeverSupabase = {
    configured,
    async getClient() {
      if (!configured()) throw new Error('Supabase не настроен');
      if (!clientPromise) {
        const createClient = window.supabase?.createClient;
        if (typeof createClient !== 'function') throw new Error('Supabase SDK unavailable');
        clientPromise = Promise.resolve(createClient(config().url, config().anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        }));
      }
      return clientPromise;
    }
  };
})();
