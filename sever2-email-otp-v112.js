(() => {
  'use strict';

  const VERSION = 'v112';
  const RESEND_SECONDS = 60;
  let bootAttempts = 0;
  let bootTimer = 0;
  let bound = false;
  let phase = 'email';
  let pendingEmail = '';
  let resendUntil = 0;
  let resendTimer = 0;

  const $ = selector => document.querySelector(selector);
  const cloud = () => window.SeverCloud;
  const configured = () => Boolean(window.SeverSupabase?.configured?.());

  function normalEmail(value) {
    return String(value || '').trim().toLocaleLowerCase('en-US');
  }

  function setNotice(message = '', kind = 'error') {
    const node = $('#accountError');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('hidden', !message);
    node.classList.toggle('success', Boolean(message) && kind === 'success');
    node.dataset.kind = message ? kind : '';
  }

  function authMessage(reason) {
    const source = String(reason?.message || reason || '').toLocaleLowerCase('en-US');
    if (source.includes('token') && (source.includes('expired') || source.includes('invalid'))) return 'Код неверный или уже истёк. Проверьте письмо или запросите новый код.';
    if (source.includes('otp') && (source.includes('expired') || source.includes('invalid'))) return 'Код неверный или уже истёк. Проверьте письмо или запросите новый код.';
    if (source.includes('rate') || source.includes('too many') || source.includes('security purposes')) return 'Слишком много запросов. Подождите немного и попробуйте снова.';
    if (source.includes('valid email') || source.includes('invalid email')) return 'Проверьте правильность email.';
    if (source.includes('signup') && source.includes('disabled')) return 'Создание новых аккаунтов временно отключено.';
    if (source.includes('fetch') || source.includes('network')) return 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
    if (source.includes('not configured')) return 'Облачная синхронизация пока не настроена.';
    return 'Не удалось выполнить вход. Попробуйте ещё раз.';
  }

  function ensureOtpMarkup() {
    const form = $('#accountForm');
    const email = $('#accountEmailInput');
    const password = $('#accountPassword');
    const error = $('#accountError');
    if (!form || !email || !password || !error) return null;

    password.required = false;
    password.closest('label')?.classList.add('hidden');
    $('#accountMode')?.classList.add('hidden');

    let codeWrap = $('#severOtpCodeWrap');
    if (!codeWrap) {
      codeWrap = document.createElement('label');
      codeWrap.id = 'severOtpCodeWrap';
      codeWrap.className = 'sever-otp-code hidden';
      codeWrap.append(document.createTextNode('Код из письма'));
      const code = document.createElement('input');
      code.id = 'severOtpCode';
      code.type = 'text';
      code.inputMode = 'numeric';
      code.autocomplete = 'one-time-code';
      code.maxLength = 6;
      code.pattern = '[0-9]{6}';
      code.placeholder = '000000';
      code.setAttribute('aria-describedby', 'severOtpHint');
      code.addEventListener('input', () => {
        const cleaned = code.value.replace(/\D+/g, '').slice(0, 6);
        if (code.value !== cleaned) code.value = cleaned;
      });
      const hint = document.createElement('small');
      hint.id = 'severOtpHint';
      hint.textContent = 'Введите 6 цифр из письма SEVER.';
      codeWrap.append(code, hint);
      error.before(codeWrap);
    }

    let actions = $('#severOtpActions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'severOtpActions';
      actions.className = 'sever-otp-actions hidden';
      const back = document.createElement('button');
      back.id = 'severOtpBack';
      back.type = 'button';
      back.className = 'text-action';
      back.textContent = 'Другой email';
      const resend = document.createElement('button');
      resend.id = 'severOtpResend';
      resend.type = 'button';
      resend.className = 'text-action';
      resend.textContent = 'Отправить код ещё раз';
      actions.append(back, resend);
      codeWrap.after(actions);
    }

    return { form, email, password, codeWrap, code: $('#severOtpCode'), actions };
  }

  function updateCountdown() {
    const resend = $('#severOtpResend');
    if (!resend) return;
    const left = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
    resend.disabled = left > 0;
    resend.textContent = left > 0 ? `Отправить ещё раз через ${left} сек` : 'Отправить код ещё раз';
    clearTimeout(resendTimer);
    if (left > 0) resendTimer = window.setTimeout(updateCountdown, 500);
  }

  function startCooldown() {
    resendUntil = Date.now() + RESEND_SECONDS * 1000;
    updateCountdown();
  }

  function render() {
    const refs = ensureOtpMarkup();
    if (!refs) return;
    const signedIn = Boolean(cloud()?.user);
    const submit = $('#accountSubmit');
    const signOut = $('#accountSignOut');
    const title = $('#accountTitle');
    const copy = $('#accountCopy');
    const eyebrow = $('#accountEyebrow');
    const emailLabel = refs.email.closest('label');

    refs.password.closest('label')?.classList.add('hidden');
    $('#accountMode')?.classList.add('hidden');
    eyebrow.textContent = configured() ? 'SEVER ACCOUNT' : 'ЛОКАЛЬНЫЙ РЕЖИМ';

    if (signedIn) {
      phase = 'email';
      pendingEmail = '';
      emailLabel?.classList.add('hidden');
      refs.codeWrap.classList.add('hidden');
      refs.actions.classList.add('hidden');
      submit?.classList.add('hidden');
      signOut?.classList.remove('hidden');
      title.textContent = 'Аккаунт SEVER';
      copy.textContent = `Вы вошли как ${cloud().user.email || 'пользователь SEVER'}. Данные синхронизируются через защищённое облако.`;
      return;
    }

    signOut?.classList.add('hidden');
    submit?.classList.remove('hidden');
    submit.disabled = !configured();

    if (!configured()) {
      emailLabel?.classList.remove('hidden');
      refs.codeWrap.classList.add('hidden');
      refs.actions.classList.add('hidden');
      title.textContent = 'Аккаунт SEVER';
      copy.textContent = 'Облачная синхронизация пока не настроена. SEVER продолжит работать на этом устройстве.';
      submit.textContent = 'Получить код';
      return;
    }

    if (phase === 'code') {
      emailLabel?.classList.add('hidden');
      refs.codeWrap.classList.remove('hidden');
      refs.actions.classList.remove('hidden');
      refs.code.required = true;
      title.textContent = 'Введите код';
      copy.textContent = `Мы отправили 6-значный код на ${pendingEmail}.`;
      submit.textContent = 'Подтвердить код';
      updateCountdown();
    } else {
      emailLabel?.classList.remove('hidden');
      refs.codeWrap.classList.add('hidden');
      refs.actions.classList.add('hidden');
      refs.code.required = false;
      title.textContent = 'Войти в SEVER';
      copy.textContent = 'Введите email — пришлём одноразовый код. Пароль не нужен.';
      submit.textContent = 'Получить код';
    }
  }

  async function sendCode(email, { resend = false } = {}) {
    const client = await window.SeverSupabase.getClient();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    if (error) throw error;
    pendingEmail = email;
    phase = 'code';
    startCooldown();
    setNotice(resend ? 'Новый код отправлен.' : 'Код отправлен. Проверьте почту.', 'success');
    render();
    requestAnimationFrame(() => $('#severOtpCode')?.focus());
  }

  async function verifyCode(code) {
    const client = await window.SeverSupabase.getClient();
    const { data, error } = await client.auth.verifyOtp({
      email: pendingEmail,
      token: code,
      type: 'email'
    });
    if (error) throw error;
    if (!data?.session?.user) throw new Error('SESSION_MISSING');
    await cloud()?.restoreSession?.({ throwOnError: true });
    phase = 'email';
    pendingEmail = '';
    clearTimeout(resendTimer);
    setNotice('');
    render();
    $('#accountDialog')?.close();
  }

  async function handleSubmit(event) {
    if (cloud()?.user) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const refs = ensureOtpMarkup();
    const submit = $('#accountSubmit');
    if (!refs || !submit || !configured()) return;
    setNotice('');
    submit.disabled = true;
    try {
      if (phase === 'email') {
        const email = normalEmail(refs.email.value);
        refs.email.value = email;
        if (!refs.email.checkValidity()) {
          refs.email.reportValidity();
          return;
        }
        submit.textContent = 'Отправляем…';
        await sendCode(email);
      } else {
        const code = String(refs.code.value || '').replace(/\D+/g, '');
        if (!/^\d{6}$/.test(code)) {
          setNotice('Введите все 6 цифр из письма.');
          refs.code.focus();
          return;
        }
        submit.textContent = 'Проверяем…';
        await verifyCode(code);
      }
    } catch (reason) {
      console.warn('SEVER: email OTP auth failed', reason);
      setNotice(authMessage(reason));
    } finally {
      if ($('#accountDialog')?.open && !cloud()?.user) {
        submit.disabled = !configured();
        submit.textContent = phase === 'code' ? 'Подтвердить код' : 'Получить код';
      }
    }
  }

  async function handleResend() {
    const button = $('#severOtpResend');
    if (!button || button.disabled || phase !== 'code' || !pendingEmail) return;
    setNotice('');
    button.disabled = true;
    button.textContent = 'Отправляем…';
    try { await sendCode(pendingEmail, { resend: true }); }
    catch (reason) {
      console.warn('SEVER: email OTP resend failed', reason);
      setNotice(authMessage(reason));
      updateCountdown();
    }
  }

  function resetToEmail() {
    phase = 'email';
    pendingEmail = '';
    const code = $('#severOtpCode');
    if (code) code.value = '';
    clearTimeout(resendTimer);
    setNotice('');
    render();
    requestAnimationFrame(() => $('#accountEmailInput')?.focus());
  }

  function boot() {
    if (bound || !window.SeverSupabase?.getClient || !window.SeverCloud || !$('#accountForm')) return false;
    const refs = ensureOtpMarkup();
    if (!refs) return false;
    bound = true;

    refs.form.addEventListener('submit', handleSubmit, true);
    $('#severOtpBack')?.addEventListener('click', resetToEmail);
    $('#severOtpResend')?.addEventListener('click', handleResend);
    $('#accountDialog')?.addEventListener('close', resetToEmail);

    const dialog = $('#accountDialog');
    if (dialog) new MutationObserver(() => { if (dialog.open) queueMicrotask(render); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('sever:cloud-status', render);
    window.addEventListener('sever:cloud-ready', render);

    document.documentElement.dataset.severEmailOtp = VERSION;
    render();
    return true;
  }

  function scheduleBoot() {
    if (boot()) return;
    if (bootAttempts++ >= 200) return;
    clearTimeout(bootTimer);
    bootTimer = window.setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('sever:ready', scheduleBoot);
  window.addEventListener('sever:cloud-ready', scheduleBoot);
})();