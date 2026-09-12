(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let booted = false;
  let bootAttempts = 0;
  let observer = null;

  const labels = {
    all: 'Все типы',
    text: 'Заметки',
    checklist: 'Чек-листы',
    protected: 'Защищённые'
  };

  function sourceButtons() {
    return [...document.querySelectorAll('#notesView .notes-core-filters [data-notes-core-filter]')];
  }

  function activeValue() {
    return sourceButtons().find(button => button.classList.contains('active'))?.dataset.notesCoreFilter || 'all';
  }

  function syncSelect() {
    const select = $('#notesCompactType');
    if (!select) return;
    const next = activeValue();
    if (select.value !== next) select.value = next;
  }

  function install() {
    const controls = $('#notesView .notes-core-controls');
    const sort = controls?.querySelector('.notes-core-sort');
    const buttons = sourceButtons();
    if (!controls || !sort || !buttons.length) return false;
    if ($('#notesCompactType')) {
      syncSelect();
      return true;
    }

    const wrapper = document.createElement('label');
    wrapper.className = 'notes-compact-type';
    wrapper.innerHTML = `
      <span class="visually-hidden">Тип заметок</span>
      <select id="notesCompactType" aria-label="Тип заметок">
        <option value="all">${labels.all}</option>
        <option value="text">${labels.text}</option>
        <option value="checklist">${labels.checklist}</option>
        <option value="protected">${labels.protected}</option>
      </select>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4 4 4-4"/></svg>`;
    controls.insertBefore(wrapper, sort);

    const select = wrapper.querySelector('select');
    select.value = activeValue();
    select.addEventListener('change', () => {
      const button = sourceButtons().find(item => item.dataset.notesCoreFilter === select.value);
      button?.click();
      requestAnimationFrame(syncSelect);
    });

    observer = new MutationObserver(syncSelect);
    buttons.forEach(button => observer.observe(button, { attributes: true, attributeFilter: ['class'] }));
    document.documentElement.dataset.severNotesCompact = 'v87';
    return true;
  }

  function boot() {
    if (booted) return;
    if (install()) {
      booted = true;
      return;
    }
    if (bootAttempts++ >= 180) return;
    setTimeout(boot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('sever:ready', () => {
    if (!booted) boot();
    else syncSelect();
  });
})();
