(() => {
  'use strict';

  const VERSION = 'v1111';
  const RESEND_SECONDS = 60;
  const $ = selector => document.querySelector(selector);
  let attempts = 0;
  let timer = 0;
  let resendTimer = 0;

  function otpMessage(reason) {
    const source = String(reason?.message || reason || '').toLocaleLowerCase('en-US');
    if (source.includes('expired') || source.includes('token has expired')) return 'Код истёк. Отправьте новый код и попробуйте снова.';
    if (source.includes('invalid') && (source.includes('token') || source.includes('otp'))) return 'Неверный код. Проверьте 6 цифр из письма.';
    if (source.includes('rate limit') || source.includes('too many') || source.includes('security purposes')) return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    if (source.includes('valid email') || (source.includes('email address') && source.includes('invalid'))) return 'Проверьте правильность email.';
    if (source.includes('fetch') || source.includes('network')) return 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
    return 'Не удалось выполнить вход по коду. Попробуйте ещё раз.';
  }

  function install() {
    const cloud = window.SeverCloud;
    const dialog = $('#accountDialog');
    const form = $('#accountForm');
    const email = $('#accountEmailInput');
    const password = $('#accountPassword');
    const submit = $('#accountSubmit');
    const mode = $('#accountMode');
    const error = $('#accountError');
    const copy = $('#accountCopy');
    const title = $('#accountTitle');
    if (!cloud || !dialog || !form || !email || !password || !submit || !mode || !error || !copy || !title) return false;
    if (form.dataset.severEmailOtpAuth === VERSION) return true;

    form.dataset.severEmailOtpAuth = VERSION;
    document.documentElement.dataset.severEmailOtpAuth = VERSION;
    password.required = false;
    password.closest('label')?.classList.add('hidden');
    mode.classList.add('hidden');

    const otpWrap = document.createElement('section');
    otpWrap.id = 'accountOtpStep';
    otpWrap.className = 'account-otp-step hidden';
    otpWrap.innerHTML = `
      <label>Код из письма
        <input id="accountOtpCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" aria-describedby="accountOtpHint">
      </label>
      <p id="accountOtpHint" class="account-otp-hint">Введите 6 цифр, которые пришли на почту.</p>
      <div class="account-otp-actions">
        <button id="accountOtpChangeEmail" type="button" class="text-action">Изменить email</button>
        <button id="accountOtpResend" type="button" class="text-action">Отправить код ещё раз</button>
      </div>`;
    password.closest('label')?.after(otpWrap);

    const code = $('#accountOtpCode');
    const resend = $('#accountOtpResend');
    const changeEmail = $('#accountOtpChangeEmail');
    let stage = 'email';
    let pendingEmail = '';
    let requestBusy = false;

    const clearNotice = () => {
      error.textContent = '';
      error.classList.add('hidden');
      error.classList.remove('success');
    };
    const showError = reason => {
      error.textContent = otpMessage(reason);
      error.classList.remove('hidden', 'success');
    };
    const showSuccess = text => {
      error.textContent = text;
      error.classList.add('success');
      error.classList.remove('hidden');
    };

    cloud.requestEmailOtp = async requestedEmail => {
      const client = await cloud.client();
      cloud.bindAuthListener(client, true);
      const result = await client.auth.signInWithOtp({
        email: requestedEmail,
        options: { shouldCreateUser: true }
      });
      cloud.authReachable = true;
      if (result.error) throw result.error;
      cloud.lastErrorCode = null;
      return result.data;
    };

    cloud.verifyEmailOtp = async (requestedEmail, token) => {
      const client = await cloud.client();
      cloud.bindAuthListener(client, true);
      const result = await client.auth.verifyOtp({ email: requestedEmail, token, type: 'email' });
      cloud.authReachable = true;
      if (result.error) throw result.error;
      cloud.lastErrorCode = null;
      const user = result.data?.session?.user || result.data?.user || null;
      if (user) await cloud.applySession(user);
      return result.data;
    };

    function stopCooldown() {
      clearInterval(resendTimer);
      resendTimer = 0;
    }

    function startCooldown() {
      stopCooldown();
      let left = RESEND_SECONDS;
      resend.disabled = true;
      const paint = () => {
        resend.textContent = left > 0 ? `Отправить код ещё раз через ${left} сек` : 'Отправить код ещё раз';
        resend.disabled = left > 0;
      };
      paint();
      resendTimer = window.setInterval(() => {
        left -= 1;
        paint();
        if (left <= 0) stopCooldown();
      }, 1000);
    }

    function setStage(next, { preserveNotice = false } = {}) {
      stage = next;
      const signedIn = Boolean(cloud.user);
      const emailLabel = email.closest('label');
      if (signedIn) {
        emailLabel?.classList.add('hidden');
        otpWrap.classList.add('hidden');
        submit.classList.add('hidden');
        mode.classList.add('hidden');
        password.closest('label')?.classList.add('hidden');
        stopCooldown();
        return;
      }
      password.closest('label')?.classList.add('hidden');
      mode.classList.add('hidden');
      submit.classList.remove('hidden');
      if (!preserveNotice) clearNotice();
      if (next === 'code') {
        emailLabel?.classList.add('hidden');
        otpWrap.classList.remove('hidden');
        title.textContent = 'Введите код';
        copy.textContent = `Код отправлен на ${pendingEmail}. Он одноразовый — пароль больше не нужен.`;
        submit.textContent = 'Войти';
        code.required = true;
        requestAnimationFrame(() => code.focus());
      } else {
        emailLabel?.classList.remove('hidden');
        otpWrap.classList.add('hidden');
        title.textContent = 'Войти в SEVER';
        copy.textContent = 'Введите email — мы пришлём одноразовый код для входа и синхронизации.';
        submit.textContent = 'Получить код';
        code.required = false;
        code.value = '';
        pendingEmail = '';
        stopCooldown();
        requestAnimationFrame(() => email.focus());
      }
    }

    function normalizeOpenDialog() {
      password.required = false;
      password.value = '';
      password.closest('label')?.classList.add('hidden');
      mode.classList.add('hidden');
      if (cloud.user) setStage('email');
      else if (stage === 'code' && pendingEmail) setStage('code', { preserveNotice: true });
      else setStage('email');
    }

    code.addEventListener('input', () => {
      const digits = code.value.replace(/\D+/g, '').slice(0, 6);
      if (code.value !== digits) code.value = digits;
    });

    mode.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    changeEmail.addEventListener('click', () => {
      if (requestBusy) return;
      clearNotice();
      setStage('email');
    });

    resend.addEventListener('click', async () => {
      if (requestBusy || resend.disabled || !pendingEmail) return;
      requestBusy = true;
      resend.disabled = true;
      clearNotice();
      try {
        await cloud.requestEmailOtp(pendingEmail);
        startCooldown();
        showSuccess('Новый код отправлен. Проверьте почту.');
      } catch (reason) {
        showError(reason);
        resend.disabled = false;
      } finally {
        requestBusy = false;
      }
    });

    form.addEventListener('submit', async event => {
      if (cloud.user) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (requestBusy) return;
      clearNotice();
      requestBusy = true;
      submit.disabled = true;
      try {
        if (stage === 'email') {
          const requestedEmail = email.value.trim();
          if (!requestedEmail || !email.checkValidity()) {
            email.reportValidity();
            return;
          }
          submit.textContent = 'Отправляем…';
          await cloud.requestEmailOtp(requestedEmail);
          pendingEmail = requestedEmail;
          setStage('code');
          startCooldown();
        } else {
          const token = code.value.trim();
          if (!/^\d{6}$/.test(token)) {
            code.setCustomValidity('Введите 6 цифр из письма.');
            code.reportValidity();
            code.setCustomValidity('');
            return;
          }
          submit.textContent = 'Проверяем…';
          await cloud.verifyEmailOtp(pendingEmail, token);
          stopCooldown();
          dialog.close();
        }
      } catch (reason) {
        showError(reason);
        submit.textContent = stage === 'code' ? 'Войти' : 'Получить код';
      } finally {
        requestBusy = false;
        submit.disabled = !cloud.configured;
      }
    }, true);

    const observer = new MutationObserver(() => {
      if (dialog.open) queueMicrotask(normalizeOpenDialog);
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    dialog.addEventListener('close', () => {
      stopCooldown();
      stage = 'email';
      pendingEmail = '';
      code.value = '';
      clearNotice();
    });
    window.addEventListener('sever:cloud-status', () => {
      if (dialog.open && cloud.user) setStage('email');
    });

    if (dialog.open) normalizeOpenDialog();
    return true;
  }

  function schedule() {
    if (install()) {
      clearTimeout(timer);
      return;
    }
    if (attempts++ >= 240) return;
    clearTimeout(timer);
    timer = setTimeout(schedule, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('sever:cloud-ready', schedule);
})();
