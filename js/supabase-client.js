(() => {
  let clientPromise = null;
  let lastErrorCode = null;
  const config = () => window.SEVER_SUPABASE_CONFIG || {};
  const configured = () => Boolean(config().url && config().anonKey);
  const sdkLoaded = () => typeof window.supabase?.createClient === 'function';

  function taggedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function health() {
    return Object.freeze({
      configured: configured(),
      sdkLoaded: sdkLoaded(),
      clientReady: Boolean(clientPromise) && !lastErrorCode,
      lastErrorCode
    });
  }

  async function getClient() {
    if (!configured()) {
      lastErrorCode = 'CONFIG_MISSING';
      throw taggedError(lastErrorCode, 'Supabase is not configured');
    }
    if (!sdkLoaded()) {
      lastErrorCode = 'SDK_LOAD_FAILED';
      throw taggedError(lastErrorCode, 'Supabase SDK unavailable');
    }
    if (!clientPromise) {
      try {
        clientPromise = Promise.resolve(window.supabase.createClient(config().url, config().anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        }));
      } catch (error) {
        clientPromise = null;
        lastErrorCode = 'SDK_INIT_FAILED';
        throw taggedError(lastErrorCode, error?.message || 'Supabase SDK initialization failed');
      }
    }
    const client = await clientPromise;
    lastErrorCode = null;
    return client;
  }

  window.SeverSupabase = {
    configured,
    sdkLoaded,
    health,
    getClient,
    ready: getClient,
    async retry() {
      clientPromise = null;
      lastErrorCode = null;
      return getClient();
    }
  };

  window.dispatchEvent(new CustomEvent('sever:supabase-ready', { detail: health() }));
})();
