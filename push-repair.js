(() => {
  'use strict';
  // Public VAPID key only. This page never reads or exposes the private signing key.
  const CURRENT_KEY = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
  const $ = id => document.getElementById(id);
  const message = text => { if ($('message')) $('message').textContent = text; };
  const decode = value => {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  };
  function keyIsStale(subscription) {
    const key = subscription?.options?.applicationServerKey;
    // Unknown is not evidence of a mismatch: never offer destructive recovery.
    if (!key) return false;
    const old = new Uint8Array(key), current = decode(CURRENT_KEY);
    return old.length !== current.length || old.some((value, index) => value !== current[index]);
  }
  async function staleSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return keyIsStale(subscription) ? subscription : null;
  }
  async function inspect() {
    const button = $('repairSubscription');
    if (!button || button.disabled) return;
    try { button.hidden = !(await staleSubscription()); }
    catch { button.hidden = true; }
  }
  async function repair() {
    const button = $('repairSubscription');
    if (!button || button.disabled) return;
    button.disabled = true;
    let stage = 'auth';
    let remotelyDisabled = false;
    try {
      // Recheck the actual browser key on every click. No key mismatch => no mutation.
      const subscription = await staleSubscription();
      if (!subscription) {
        button.hidden = true;
        message('Несовпадение ключа не подтверждено. Ничего не изменено.');
        return;
      }
      if (!window.SeverSupabase?.getClient) throw new Error('CLIENT_UNAVAILABLE');
      const client = await window.SeverSupabase.getClient();
      const who = await client.auth.getUser();
      if (who.error || !who.data?.user?.id) {
        message('Войдите в аккаунт SEVER и откройте проверку из настроек. Подписка не изменена.');
        return;
      }
      const userId = who.data.user.id;
      const registration = await navigator.serviceWorker.getRegistration();
      const latest = await registration?.pushManager?.getSubscription();
      if (!latest || latest.endpoint !== subscription.endpoint || !keyIsStale(latest)) {
        message('Подписка изменилась. Обновите результаты; ничего не удалено.');
        return;
      }
      // Fail closed if Supabase rejects the owner-scoped write: do not remove a
      // browser subscription while the server still considers it enabled.
      stage = 'disable';
      const disabled = await client.from('push_subscriptions').update({enabled:false})
        .eq('user_id', userId).eq('endpoint', subscription.endpoint);
      if (disabled.error) throw new Error('SERVER_DISABLE_FAILED');
      remotelyDisabled = true;
      stage = 'unsubscribe';
      if (await latest.unsubscribe() !== true) throw new Error('LOCAL_UNSUBSCRIBE_FAILED');
      stage = 'delete';
      const deleted = await client.from('push_subscriptions').delete()
        .eq('user_id', userId).eq('endpoint', subscription.endpoint);
      if (deleted.error) throw new Error('SERVER_DELETE_FAILED');
      button.hidden = true;
      if ($('repairNext')) $('repairNext').hidden = false;
      message('Устаревшая подписка удалена только на этом устройстве. Вернитесь в настройки и включите уведомления: будет создана новая подписка с актуальным ключом.');
    } catch {
      if (stage === 'auth' || stage === 'disable') {
        message('Не удалось проверить аккаунт или отключить старую запись на сервере. Подписка на устройстве не изменена.');
      } else if (stage === 'unsubscribe') {
        message('iPhone или браузер не удалил старую подписку. Серверная запись отключена, чтобы не слать ошибочные запросы. Данные SEVER не затронуты.');
      } else {
        if ($('repairNext')) $('repairNext').hidden = false;
        message('Старая подписка удалена на устройстве, но очистка записи в облаке не завершилась. Старая запись отключена; можно включить новую подписку в настройках.');
      }
    } finally {
      button.disabled = false;
      if (!remotelyDisabled) await inspect();
    }
  }
  $('repairSubscription')?.addEventListener('click', () => void repair());
  $('refresh')?.addEventListener('click', () => void inspect());
  void inspect();
})();
