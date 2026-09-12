(() => {
  const $ = selector => document.querySelector(selector);
  const isPhone = () => window.matchMedia('(max-width: 900px)').matches;
  const primaryMobileViews = new Set(['today', 'calendar', 'notes']);
  let pointerStart = null;
  let initialized = false;

  function openSheet(id) {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open || dialog.dataset.opening === 'true') return;
    dialog.dataset.opening = 'true';
    document.querySelectorAll('dialog.mobile-sheet[open]').forEach(open => {
      if (open !== dialog) open.close();
    });
    try { dialog.showModal(); } catch {}
    requestAnimationFrame(() => { delete dialog.dataset.opening; });
  }
  function closeDialog(id) { const dialog = document.getElementById(id); if (dialog?.open) dialog.close(); }
  function currentView() { return document.querySelector('.view.active')?.id.replace(/View$/, '') || 'today'; }
  function setText(element, value) { if (element && element.textContent !== value) element.textContent = value; }
  function updateHeader() {
    const activeView = currentView();
    document.querySelectorAll('.bottom-nav button').forEach(button => {
      const direct = button.dataset.view === activeView;
      const more = button.dataset.mobileMore === 'true' && !primaryMobileViews.has(activeView);
      button.classList.toggle('active', direct || more);
      if (direct || more) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
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
    setText(sync, cloud);
    setText(menuSync, cloud);
    setText(account, email);
    setText(menuAccount, email === 'Данные только на этом устройстве' ? 'Войти для синхронизации' : email);
    const storage = $('#storageStatus')?.textContent;
    if (storage) setText($('#settingsStorageStatus'), storage);
  }
  function attachSheetBehavior(dialog) {
    if (!dialog) return;
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

  function installVideoAuditStyles() {
    if ($('#severVideoAuditStyles')) return;
    const style = document.createElement('style');
    style.id = 'severVideoAuditStyles';
    style.textContent = `
      /* Safari-safe guide mask: four real panes instead of a 999vmax shadow. */
      #tourDialog .guide-spotlight {
        opacity: 0 !important;
        border: 0 !important;
        box-shadow: none !important;
      }
      #tourDialog .guide-mask-pane {
        position: fixed;
        z-index: 3;
        margin: 0;
        padding: 0;
        border: 0;
        background: rgba(3, 3, 5, .58);
        pointer-events: none;
        transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease, background-color .18s ease;
      }
      #tourDialog[data-guide-mask-target="false"] .guide-mask-pane { background: rgba(3, 3, 5, .26); }
      #tourDialog .guide-mask-ring {
        position: fixed;
        z-index: 4;
        display: none;
        box-sizing: border-box;
        border: 2px solid rgba(255, 255, 255, .88);
        border-radius: 16px;
        box-shadow: 0 0 0 5px rgba(255, 255, 255, .09), 0 12px 34px rgba(0, 0, 0, .26);
        pointer-events: none;
        transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease;
      }
      #tourDialog[data-guide-mask-target="true"] .guide-mask-ring { display: block; }
      #tourDialog .guide-card { z-index: 8; }
      html[data-theme="light"] #tourDialog .guide-mask-pane { background: rgba(28, 27, 30, .38); }
      html[data-theme="light"] #tourDialog[data-guide-mask-target="false"] .guide-mask-pane { background: rgba(28, 27, 30, .14); }
      html[data-theme="light"] #tourDialog .guide-mask-ring {
        border-color: rgba(25, 24, 26, .82);
        box-shadow: 0 0 0 5px rgba(25, 24, 26, .08), 0 12px 34px rgba(0, 0, 0, .14);
      }
      @media (max-width: 900px) {
        #tourDialog[data-step="5"] .guide-card {
          bottom: calc(78px + env(safe-area-inset-bottom));
          border-bottom: 1px solid var(--border, rgba(127,127,127,.18));
          border-radius: 22px;
        }
        #dayDialog .day-task-list .empty {
          min-height: 180px;
          padding: 24px 18px 18px;
          gap: 8px;
          align-content: center;
          justify-items: center;
          text-align: center;
        }
        #dayDialog .day-task-list .empty .empty-icon {
          width: 56px !important;
          height: 56px !important;
          min-width: 56px;
          min-height: 56px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          margin: 0 auto 4px;
        }
        #dayDialog .day-task-list .empty .empty-icon svg {
          width: 26px !important;
          height: 26px !important;
        }
        #dayDialog .day-task-list .empty .today-add-task {
          display: none !important;
        }
        #dayDialog .day-add-task {
          margin-top: 10px;
        }
        .settings-mobile-index {
          position: sticky;
          top: calc(env(safe-area-inset-top, 0px) + 56px);
          z-index: 8;
          display: flex;
          gap: 8px;
          overflow-x: auto;
          overscroll-behavior-inline: contain;
          scrollbar-width: none;
          padding: 10px 2px 12px;
          margin: -4px 0 8px;
          background: color-mix(in srgb, var(--bg, #07111e) 88%, transparent);
          -webkit-backdrop-filter: blur(18px);
          backdrop-filter: blur(18px);
        }
        .settings-mobile-index::-webkit-scrollbar { display: none; }
        .settings-mobile-index button {
          flex: 0 0 auto;
          min-height: 38px;
          border: 1px solid var(--line, rgba(255,255,255,.10));
          border-radius: 999px;
          padding: 0 14px;
          background: var(--surface, rgba(255,255,255,.06));
          color: inherit;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: .01em;
          touch-action: manipulation;
        }
        .settings-mobile-index button:active { transform: scale(.97); }
        #settingsView .settings-section { scroll-margin-top: 122px; }
      }
      @media (min-width: 901px) {
        .settings-mobile-index { display: none !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        #tourDialog .guide-mask-pane,
        #tourDialog .guide-mask-ring { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function tidyDayDialog() {
    const root = $('#dayTaskList');
    if (!root || root.dataset.severVideoAudit === 'true') return;
    root.dataset.severVideoAudit = 'true';
    const tidy = () => root.querySelectorAll('.empty .today-add-task').forEach(button => button.remove());
    tidy();
    new MutationObserver(tidy).observe(root, { childList: true, subtree: true });
  }

  function installSettingsIndex() {
    const list = $('#settingsView .settings-list');
    if (!list || $('#settingsMobileIndex')) return;
    const sections = [...list.querySelectorAll(':scope > .settings-section')];
    if (!sections.length) return;
    const nav = document.createElement('nav');
    nav.id = 'settingsMobileIndex';
    nav.className = 'settings-mobile-index';
    nav.setAttribute('aria-label', 'Быстрый переход по настройкам');
    sections.forEach((section, index) => {
      const label = section.querySelector(':scope > small')?.textContent?.trim();
      if (!label) return;
      if (!section.id) section.id = `settings-section-${index + 1}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label.replace('SEVER AI', 'AI').replace('ОПАСНАЯ ЗОНА', 'Сброс');
      button.setAttribute('aria-controls', section.id);
      button.addEventListener('click', () => {
        const details = section.closest('details');
        if (details && !details.open) details.open = true;
        requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
      nav.appendChild(button);
    });
    list.prepend(nav);
  }

  function installGuideSpotlightMask() {
    const dialog = $('#tourDialog');
    const originalSpot = $('#guideSpotlight');
    if (!dialog || !originalSpot || dialog.dataset.severMaskReady === 'true') return;
    dialog.dataset.severMaskReady = 'true';

    const names = ['top', 'left', 'right', 'bottom'];
    const panes = {};
    names.forEach(name => {
      const pane = document.createElement('div');
      pane.className = `guide-mask-pane guide-mask-${name}`;
      pane.setAttribute('aria-hidden', 'true');
      dialog.insertBefore(pane, dialog.querySelector('.guide-card'));
      panes[name] = pane;
    });
    const ring = document.createElement('div');
    ring.className = 'guide-mask-ring';
    ring.setAttribute('aria-hidden', 'true');
    dialog.insertBefore(ring, dialog.querySelector('.guide-card'));

    const expandedRect = (target, gap = 7) => {
      const rect = target?.getBoundingClientRect?.();
      if (!rect || rect.width <= 1 || rect.height <= 1) return null;
      const left = Math.max(0, rect.left - gap);
      const top = Math.max(0, rect.top - gap);
      const right = Math.min(window.innerWidth, rect.right + gap);
      const bottom = Math.min(window.innerHeight, rect.bottom + gap);
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };

    const currentRect = () => {
      // Steps 2–4 are already anchored by app.js. Read the real positioned spot,
      // but render the mask ourselves so Safari cannot lose the transparent hole.
      if (dialog.dataset.hasTarget === 'true') {
        const rect = originalSpot.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) {
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        }
      }
      // The final guide step talks about navigation. Show the navigation instead of
      // returning to a fully grey backdrop with no visible referent.
      if (dialog.dataset.step === '5') {
        return expandedRect(isPhone() ? $('.bottom-nav') : $('.desktop-sidebar .app-nav'), 5);
      }
      return null;
    };

    const box = (node, left, top, width, height) => {
      node.style.left = `${Math.max(0, left)}px`;
      node.style.top = `${Math.max(0, top)}px`;
      node.style.width = `${Math.max(0, width)}px`;
      node.style.height = `${Math.max(0, height)}px`;
    };

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!dialog.open) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = currentRect();
        dialog.dataset.guideMaskTarget = rect ? 'true' : 'false';
        if (!rect) {
          box(panes.top, 0, 0, vw, vh);
          box(panes.left, 0, 0, 0, 0);
          box(panes.right, 0, 0, 0, 0);
          box(panes.bottom, 0, 0, 0, 0);
          return;
        }
        box(panes.top, 0, 0, vw, rect.top);
        box(panes.left, 0, rect.top, rect.left, rect.height);
        box(panes.right, rect.right, rect.top, vw - rect.right, rect.height);
        box(panes.bottom, 0, rect.bottom, vw, vh - rect.bottom);
        box(ring, rect.left, rect.top, rect.width, rect.height);
        ring.style.borderRadius = originalSpot.style.borderRadius || '16px';
      });
    };

    new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['open', 'data-step', 'data-has-target'] });
    new MutationObserver(sync).observe(originalSpot, { attributes: true, attributeFilter: ['style'] });
    ['tourNext', 'tourBack'].forEach(id => $(`#${id}`)?.addEventListener('click', () => setTimeout(sync, 0)));
    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  function setup() {
    if (initialized) return;
    initialized = true;
    installVideoAuditStyles();
    tidyDayDialog();
    installSettingsIndex();
    installGuideSpotlightMask();

    // Presentation only: keep the task renderer and its event handlers intact.
    const tidyTaskMetadata = root => root.querySelectorAll('.task-meta').forEach(meta => {
      const parts = meta.textContent.split(' · ').filter(part => part && part !== 'Без времени');
      const label = parts.join(' · ');
      if (meta.textContent !== label) meta.textContent = label;
    });
    document.querySelectorAll('.task-list').forEach(root => {
      tidyTaskMetadata(root);
      // Observe row replacement only, so changing metadata cannot retrigger us.
      new MutationObserver(() => tidyTaskMetadata(root)).observe(root, { childList: true });
    });
    ['noteCreateSheet', 'mobileMenuSheet', 'resetConfirmDialog', 'habitDeleteDialog'].forEach(id => attachSheetBehavior(document.getElementById(id)));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));

    // Desktop retains its direct editor. On phones this single visible action
    // opens the choice sheet, avoiding a second Notes creation control.
    $('#openNote').onclick = () => {
      if (isPhone()) openSheet('noteCreateSheet');
      else window.SeverNotes?.openNote?.();
    };
    $('#noteCreateNote').onclick = () => { closeDialog('noteCreateSheet'); window.SeverNotes?.openNote?.(); };
    $('#noteCreateFolder').onclick = () => { closeDialog('noteCreateSheet'); window.SeverNotes?.openFolderDialog?.(); };

    $('#openSettingsMenu').onclick = openSettings;
    document.querySelectorAll('[data-menu-view]').forEach(button => button.addEventListener('click', () => { closeDialog('mobileMenuSheet'); window.SeverApp?.switchView?.(button.dataset.menuView); updateHeader(); }));
    $('#menuAccount').onclick = () => { closeDialog('mobileMenuSheet'); window.SeverCloudUI?.openAccount?.(); };
    $('#menuSync').onclick = async () => { syncSettings(); try { await window.SeverCloud?.restoreSession?.(); } finally { syncSettings(); } };
    $('#menuTheme').onclick = () => { openSettings(); requestAnimationFrame(() => document.querySelector('.settings-appearance')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };

    $('#settingsAccountButton').onclick = () => window.SeverCloudUI?.openAccount?.();
    $('#settingsSyncRetry').onclick = async () => { const button = $('#settingsSyncRetry'); if (button.disabled) return; button.disabled = true; button.textContent = 'Проверяем…'; try { await window.SeverCloud?.restoreSession?.(); } finally { button.disabled = false; button.textContent = 'Повторить'; syncSettings(); } };
    $('#settingsNotificationToggle').onchange = event => { const source = $('#notificationToggle'); if (source) { source.checked = event.target.checked; source.dispatchEvent(new Event('change', { bubbles: true })); } };
    $('#settingsNotificationTime').onchange = event => { const source = $('#notificationTime'); if (source) { source.value = event.target.value; source.dispatchEvent(new Event('change', { bubbles: true })); } };
    $('#settingsTestNotification').onclick = () => $('#testNotification')?.click();
    $('#settingsGuide').onclick = () => {
      const guide = window.SeverApp?.startGuide;
      if (typeof guide !== 'function') return;
      guide({ manual: true });
    };
    $('#settingsExport').onclick = () => $('#exportBtn')?.click();
    $('#settingsVaultExport').onclick = () => window.SeverApp?.exportProtectedVault?.();
    $('#settingsReset').onclick = requestReset;
    $('#confirmReset').onclick = async () => { closeDialog('resetConfirmDialog'); await window.SeverApp?.resetPlanner?.(); };
    document.querySelector('.bottom-nav button[data-mobile-more="true"]')?.addEventListener('click', event => { event.preventDefault(); openSheet('mobileMenuSheet'); updateHeader(); });

    const update = () => { updateHeader(); syncSettings(); };
    new MutationObserver(update).observe(document.querySelector('main'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    const settingsObserver = new MutationObserver(syncSettings);
    ['#cloudStatusSettings', '#accountEmail', '#storageStatus'].map($).filter(Boolean).forEach(source => settingsObserver.observe(source, { subtree: true, childList: true, characterData: true }));
    document.querySelectorAll('.bottom-nav button').forEach(button => button.addEventListener('click', () => setTimeout(update, 0)));
    window.addEventListener('resize', update, { passive: true });
    update();
  }
  window.addEventListener('sever:ready', setup, { once: true });
  if (window.SeverApp) setup();
})();
