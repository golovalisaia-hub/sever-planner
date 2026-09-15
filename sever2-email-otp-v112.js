(() => {
  'use strict';

  const VERSION = 'v112';
  const RESEND_SECONDS = 60;
  const RESEND_KEY = 'sever-email-otp-resend-v112';
  let bootAttempts = 0;
  let bootTimer = 0;
  let resendTimer = 0;
  let phase = 'email';
  let pendingEmail = '';
  let bound = false;

  const $ = selector => document.querySelector(selector);
  const cloud = () => window.SeverCloud;
  const client = () => window.SeverSupabase?.getClient?.();

  function normalizeEmail(value) {
    return String(value || '').trim();
  }

  function errorText(reason) {
    const source = `${reason?.code || ''} ${reason?.message || reason || ''}`.toLocaleLowerCase('en-US');
    if (source.includes('otp_expired') || source.includes('token has expired') || source.includes('expired')) {
      return 'Код истёк. Запросите новый код и попробуйте ещё раз.';
    }
    if (source.includes('invalid token') || source.includes('invalid otp') || source.includes('token is invalid') || source.includes('otp_disabled')) {
      return 'Код неверный. Проверьте цифры из письма или запросите новый код.';
    }
    if (source.includes('rate limit') || source.includes('too many') || source.includes('over_email_send_rate_limit')) {
      return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    }
    if (source.includes('valid email') || source.includes('invalid email') || (source.includes('email address') && source.includes('invalid'))) {
      return 'Проверьте правильность email.';
    }
    if (source.includes('signup') && source.includes('disabled')) {
      return 'Создание новых аккаунтов сейчас отключено. Если аккаунт уже есть, попробуйте этот же email позже.';
    }
    if (source.includes('fetch') || source.includes('network') || source.includes('failed to fetch')) {
      return 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
    }
    return 'Не удалось выполнить вход по коду. Попробуйте ещё раз.';
  }

  function ensureOtpUi() {
    const form = $('#accountForm');
    const error = $('#accountError');
    if (!form || !error) return false;

    if (!$('#accountCodeLabel')) {
      const label = document.createElement('label');
      label.id = 'accountCodeLabel';
      label.className = 'account-otp-code hidden';
      label.append(document.createTextNode('Код из письма'));
      const input = document.createElement('input');
      input.id = 'accountCode';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'one-time-code';
      input.maxLength = 8;
      input.pattern = '[0-9]{6,8}';
      input.placeholder = '000000';
      input.setAttribute('aria-describedby', 'accountOtpHint');
      label.append(input);
      error.before(label);
    }

    if (!$('#accountOtpHint')) {
      const hint = document.createElement('p');
      hint.id = 'accountOtpHint';
      hint.className = 'muted account-otp-hint hidden';
      hint.textContent = 'Введите одноразовый код из письма. Пароль не нужен.';
      error.before(hint);
    }

    if (!$('#accountResend')) {
      const resend = document.createElement('button');
      resend.id = 'accountResend';
      resend.type = 'button';
      resend.className = 'text-action account-otp-resend hidden';
      resend.textContent = 'Отправить код ещё раз';
      const actions = form.querySelector('.dialog-actions');
      actions?.before(resend);
    }
    return true;
  }

  function clearNotice() {
    const node = $('#accountError');
    if (!node) return;
    node.textContent = '';
    node.classList.add('hidden');
    node.classList.remove('success');
  }

  function showNotice(text, success = false) {
    const node = $('#accountError');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('success', success);
    node.classList.remove('hidden');
  }

  function readResendState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(RESEND_KEY) || 'null');
      if (!value || value.email !== pendingEmail) return 0;
      return Math.max(0, Number(value.until || 0) - Date.now());
    } catch {
      return 0;
    }
  }

  function startCooldown() {
    const until = Date.now() + RESEND_SECONDS * 1000;
    try { sessionStorage.setItem(RESEND_KEY, JSON.stringify({ email: pendingEmail, until })); } catch {}
    updateResend();
  }

  function updateResend() {
    clearInterval(resendTimer);
    const button = $('#accountResend');
    if (!button || phase !== 'code') return;
    const update = () => {
      const remainingMs = readResendState();
      const remaining = Math.ceil(remainingMs / 1000);
      button.disabled = remaining > 0;
      button.textContent = remaining > 0 ? `Отправить снова через ${remaining} с` : 'Отправить код ещё раз';
      if (remaining <= 0) {
        clearInterval(resendTimer);
        resendTimer = 0;
      }
    };
    update();
    if (readResendState() > 0) resendTimer = window.setInterval(update, 1000);
  }

  function resetFlow({ keepEmail = false } = {}) {
    phase = 'email';
    if (!keepEmail) pendingEmail = '';
    clearInterval(resendTimer);
    resendTimer = 0;
    const code = $('#accountCode');
    if (code) code.value = '';
  }

  function render() {
    if (!ensureOtpUi()) return;
    const account = cloud();
    const signedIn = Boolean(account?.user);
    const emailLabel = $('#accountEmailInput')?.closest('label');
    const passwordLabel = $('#accountPassword')?.closest('label');
    const codeLabel = $('#accountCodeLabel');
    const hint = $('#accountOtpHint');
    const submit = $('#accountSubmit');
    const mode = $('#accountMode');
    const resend = $('#accountResend');
    const title = $('#accountTitle');
    const copy = $('#accountCopy');
    const signOut = $('#accountSignOut');
    const retry = $('#accountRetry');
    if (!submit || !mode || !title || !copy) return;

    passwordLabel?.classList.add('hidden');
    $('#accountPassword')?.removeAttribute('required');

    if (signedIn) {
      emailLabel?.classList.add('hidden');
      codeLabel?.classList.add('hidden');
      hint?.classList.add('hidden');
      submit.classList.add('hidden');
      mode.classList.add('hidden');
      resend?.classList.add('hidden');
      signOut?.classList.remove('hidden');
      title.textContent = 'Аккаунт SEVER';
      copy.textContent = `Вы вошли как ${account.user.email || 'пользователь SEVER'}. Данные синхронизируются через защищённое облако.`;
      return;
    }

    signOut?.classList.add('hidden');
    submit.classList.remove('hidden');
    retry?.classList.toggle('hidden', account?.health?.().lastErrorCode !== 'SDK_LOAD_FAILED');

    if (phase === 'code') {
      emailLabel?.classList.add('hidden');
      codeLabel?.classList.remove('hidden');
      hint?.classList.remove('hidden');
      mode.classList.remove('hidden');
      resend?.classList.remove('hidden');
      title.textContent = 'Введите код';
      copy.textContent = `Мы отправили одноразовый код на ${pendingEmail}. Пароль не нужен.`;
      submit.textContent = 'Войти';
      mode.textContent = 'Изменить email';
      updateResend();
      requestAnimationFrame(() => $('#accountCode')?.focus());
    } else {
      emailLabel?.classList.remove('hidden');
      codeLabel?.classList.add('hidden');
      hint?.classList.add('hidden');
      mode.classList.add('hidden');
      resend?.classList.add('hidden');
      title.textContent = 'Войти в SEVER';
      copy.textContent = account?.configured
        ? 'Введите email — SEVER пришлёт одноразовый код для входа. Пароль не нужен.'
        : 'Облачная синхронизация пока не настроена. SEVER продолжит работать на этом устройстве.';
      submit.textContent = 'Получить код';
      requestAnimationFrame(() => $('#accountEmailInput')?.focus());
    }
  }

  async function requestOtp(email) {
    const supabase = await client();
    if (!supabase) throw new Error('Supabase unavailable');
    const result = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    if (result.error) throw result.error;
  }

  async function verifyOtp(email, token) {
    const supabase = await client();
    if (!supabase) throw new Error('Supabase unavailable');
    const result = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (result.error) throw result.error;
    const user = result.data?.session?.user || result.data?.user || null;
    if (!user) throw new Error('OTP session missing');
    await cloud()?.applySession?.(user);
    return result.data;
  }

  async function sendCode({ resend = false } = {}) {
    const emailInput = $('#accountEmailInput');
    const submit = $('#accountSubmit');
    const resendButton = $('#accountResend');
    const email = resend ? pendingEmail : normalizeEmail(emailInput?.value);
    if (!email) {
      showNotice('Введите email, на который отправить код.');
      emailInput?.focus();
      return;
    }
    if (resend && readResendState() > 0) return;

    clearNotice();
    const button = resend ? resendButton : submit;
    if (button) {
      button.disabled = true;
      button.textContent = resend ? 'Отправляем…' : 'Отправляем код…';
    }
    try {
      await requestOtp(email);
      pendingEmail = email;
      phase = 'code';
      startCooldown();
      render();
      showNotice(resend ? 'Новый код отправлен.' : 'Код отправлен. Проверьте почту.', true);
    } catch (reason) {
      showNotice(errorText(reason));
      if (!resend) phase = 'email';
      render();
    } finally {
      if (button) button.disabled = false;
      render();
    }
  }

  async function submitCode() {
    const codeInput = $('#accountCode');
    const submit = $('#accountSubmit');
    const token = String(codeInput?.value || '').replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(token)) {
      showNotice('Введите код из 6–8 цифр из письма.');
      codeInput?.focus();
      return;
    }
    clearNotice();
    submit.disabled = true;
    submit.textContent = 'Проверяем код…';
    try {
      await verifyOtp(pendingEmail, token);
      resetFlow({ keepEmail: true });
      $('#accountDialog')?.close();
    } catch (reason) {
      showNotice(errorText(reason));
      codeInput.value = '';
      codeInput.focus();
    } finally {
      submit.disabled = false;
      if ($('#accountDialog')?.open) render();
    }
  }

  function bind() {
    if (bound || !ensureOtpUi() || !cloud()) return false;
    const dialog = $('#accountDialog');
    const form = $('#accountForm');
    const mode = $('#accountMode');
    const resend = $('#accountResend');
    const codeInput = $('#accountCode');
    if (!dialog || !form || !mode || !resend || !codeInput) return false;
    bound = true;

    form.addEventListener('submit', event => {
      if (cloud()?.user) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (phase === 'code') void submitCode();
      else void sendCode();
    }, true);

    mode.addEventListener('click', event => {
      if (cloud()?.user || phase !== 'code') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      resetFlow({ keepEmail: true });
      clearNotice();
      render();
    }, true);

    resend.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void sendCode({ resend: true });
    }, true);

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 8);
    });

    new MutationObserver(() => {
      if (!dialog.open) return;
      if (!cloud()?.user && phase !== 'code') resetFlow({ keepEmail: true });
      queueMicrotask(render);
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

    window.addEventListener('sever:cloud-status', () => { if (dialog.open) queueMicrotask(render); });
    window.addEventListener('sever:cloud-ready', () => { if (dialog.open) queueMicrotask(render); });
    document.documentElement.dataset.severEmailOtp = VERSION;
    render();
    return true;
  }

  function scheduleBoot() {
    if (bind()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ >= 240) return;
    clearTimeout(bootTimer);
    bootTimer = window.setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('sever:ready', scheduleBoot);
  window.addEventListener('sever:cloud-ready', scheduleBoot);
})();
