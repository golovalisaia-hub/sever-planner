(() => {
  const $ = selector => document.querySelector(selector);
  const isPhone = () => window.matchMedia('(max-width: 900px)').matches;
  const titles = { today: 'Sever', calendar: 'Календарь', timer: 'Таймер', notes: 'Заметки', habits: 'Привычки', progress: 'Прогресс', settings: 'Настройки' };
  const actions = {
    today: () => $('#openAdd')?.click(),
    notes: () => openSheet('noteCreateSheet'),
    habits: () => $('#openHabit')?.click()
  };
  let pointerStart = null;
  let initialized = false;

  function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog?.open) dialog?.showModal();
  }
  function closeDialog(id) { const dialog = document.getElementById(id); if (dialog?.open) dialog.close(); }
  function currentView() { return document.querySelector('.view.active')?.id.replace(/View$/, '') || 'today'; }
  function updateHeader() {
    const name = currentView();
    const title = name === 'notes' ? document.querySelector('#folderTabs button.active span')?.textContent || titles[name] : titles[name] || 'Sever';
    const heading = $('#mobileHeaderTitle');
    if (heading) heading.textContent = title;
    const action = $('#mobileHeaderAction');
    if (action) {
      const show = Boolean(actions[name]);
      action.classList.toggle('hidden', !show);
      action.setAttribute('aria-label', name === 'notes' ? 'Создать заметку или папку' : name === 'habits' ? 'Добавить привычку' : 'Добавить задачу');
      action.onclick = show ? actions[name] : null;
    }
  }
  function openSettings() {
    closeDialog('mobileMenuSheet');
    window.SeverApp?.switchView?.('settings');
    updateHeader();
  }
  function syncSettings() {
    const sourceToggle = $('#notificationToggle');
    const sourceTime = $('#notificationTime');
    const targetToggle = $('#settingsNotificationToggle');
    const targetTime = $('#settingsNotificationTime');
    if (sourceToggle && targetToggle) targetToggle.checked = sourceToggle.checked;
    if (sourceTime && targetTime) targetTime.value = sourceTime.value;
    const cloud = $('#cloudStatusSettings')?.textContent || 'Локально';
    const sync = $('#settingsSyncStatus');
    const menuSync = $('#menuSyncStatus');
    const account = $('#settingsAccountEmail');
    const menuAccount = $('#menuAccountStatus');
    const email = $('#accountEmail')?.textContent || 'Локальный режим';
    if (sync) sync.textContent = cloud;
    if (menuSync) menuSync.textContent = cloud;
    if (account) account.textContent = email;
    if (menuAccount) menuAccount.textContent = email === 'Данные только на этом устройстве' ? 'Войти для синхронизации' : email;
    const storage = $('#storageStatus')?.textContent;
    if (storage && $('#settingsStorageStatus')) $('#settingsStorageStatus').textContent = storage;
  }
  function attachSheetBehavior(dialog) {
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const handle = dialog.querySelector('.sheet-grabber');
    handle?.addEventListener('pointerdown', event => { pointerStart = event.clientY; handle.setPointerCapture?.(event.pointerId); });
    handle?.addEventListener('pointerup', event => { if (pointerStart !== null && event.clientY - pointerStart > 70) dialog.close(); pointerStart = null; });
    dialog.addEventListener('cancel', () => { pointerStart = null; });
  }
  function requestReset() {
    const cloud = $('#cloudStatusSettings')?.textContent || '';
    const copy = $('#resetConfirmCopy');
    if (copy) copy.textContent = cloud.includes('Синх') ? 'Будут удалены данные этого планера. Связанные облачные записи будут помечены для удаления после синхронизации. Учётная запись сохранится.' : 'Будут удалены все данные календаря на этом устройстве. Учётная запись сохранится.';
    openSheet('resetConfirmDialog');
  }
  function setup() {
    if (initialized) return;
    initialized = true;
    ['noteCreateSheet', 'mobileMenuSheet', 'resetConfirmDialog'].forEach(id => attachSheetBehavior(document.getElementById(id)));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));

    // Desktop retains its direct editor. On phones this single visible action
    // opens the choice sheet, avoiding a second Notes creation control.
    $('#openNote').onclick = () => {
      if (isPhone()) openSheet('noteCreateSheet');
      else window.SeverNotes?.openNote?.();
    };
    $('#noteCreateNote').onclick = () => { closeDialog('noteCreateSheet'); window.SeverNotes?.openNote?.(); };
    $('#noteCreateFolder').onclick = () => { closeDialog('noteCreateSheet'); window.SeverNotes?.openFolderDialog?.(); };

    // Mobile gets a concise sheet; desktop keeps the established settings dialog.
    $('#moreBtn').onclick = () => {
      if (isPhone()) openSheet('mobileMenuSheet');
      else $('#moreDialog')?.showModal();
    };
    $('#openSettingsMenu').onclick = openSettings;
    $('#menuAccount').onclick = () => { closeDialog('mobileMenuSheet'); $('#openAccountFromSettings')?.click(); };
    $('#menuSync').onclick = async () => { syncSettings(); try { await window.SeverCloud?.restoreSession?.(); } finally { syncSettings(); } };
    $('#menuTheme').onclick = () => { $('#themeBtn')?.click(); closeDialog('mobileMenuSheet'); };

    $('#settingsAccountButton').onclick = () => $('#openAccountFromSettings')?.click();
    $('#settingsSyncRetry').onclick = async () => { const button = $('#settingsSyncRetry'); button.disabled = true; button.textContent = 'Проверяем…'; try { await window.SeverCloud?.restoreSession?.(); } finally { button.disabled = false; button.textContent = 'Повторить'; syncSettings(); } };
    $('#settingsNotificationToggle').onchange = event => { const source = $('#notificationToggle'); if (source) { source.checked = event.target.checked; source.dispatchEvent(new Event('change', { bubbles: true })); } };
    $('#settingsNotificationTime').onchange = event => { const source = $('#notificationTime'); if (source) { source.value = event.target.value; source.dispatchEvent(new Event('change', { bubbles: true })); } };
    $('#settingsTestNotification').onclick = () => $('#testNotification')?.click();
$('#settingsGuide')?.addEventListener('click', () => window.SeverApp?.startGuide?.({ manual: true }));
    $('#settingsExport').onclick = () => $('#exportBtn')?.click();
    $('#settingsReset').onclick = requestReset;
    $('#confirmReset').onclick = async () => { closeDialog('resetConfirmDialog'); await window.SeverApp?.resetPlanner?.(); };

    const update = () => { updateHeader(); syncSettings(); };
    new MutationObserver(update).observe(document.querySelector('main'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    new MutationObserver(syncSettings).observe(document.body, { subtree: true, childList: true, characterData: true });
    document.querySelectorAll('.bottom-nav button').forEach(button => button.addEventListener('click', () => setTimeout(update, 0)));
    window.addEventListener('resize', update, { passive: true });
    update();
  }
  window.addEventListener('sever:ready', setup, { once: true });
  if (window.SeverApp) setup();
})();
