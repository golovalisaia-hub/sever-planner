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

  function loadEmailOtpLayer() {
    if (!document.querySelector('link[data-sever-email-otp-v112]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'sever2-email-otp-v112.css?v=112';
      style.dataset.severEmailOtpV112 = 'style';
      document.head.append(style);
    }
    if (!document.querySelector('script[data-sever-email-otp-v112]')) {
      const script = document.createElement('script');
      script.src = 'sever2-email-otp-v112.js?v=112';
      script.dataset.severEmailOtpV112 = 'script';
      document.head.append(script);
    }
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

  loadEmailOtpLayer();
  window.dispatchEvent(new CustomEvent('sever:supabase-ready', { detail: health() }));
})();
