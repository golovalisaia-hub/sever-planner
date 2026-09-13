(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let attempts = 0;
  let timer = 0;

  function triggerOrganizationRender() {
    const root = $('#noteList');
    if (!root) return;
    const marker = document.createComment('sever-notes-org-repair');
    root.appendChild(marker);
    marker.remove();
  }

  function repair() {
    const view = $('#notesView');
    const summary = $('#notesCoreSummary');
    const noteList = $('#noteList');
    if (!view || !summary || !noteList || document.documentElement.dataset.severNotesOrganization !== 'ready') return false;

    let repaired = false;
    if (!$('#notesOrganizationTags')) {
      const tags = document.createElement('div');
      tags.id = 'notesOrganizationTags';
      tags.className = 'notes-org-filterbar hidden';
      tags.setAttribute('aria-label', 'Фильтр по тегам');
      summary.after(tags);
      repaired = true;
    }

    if (!$('#notesPinnedSection')) {
      const pinned = document.createElement('section');
      pinned.id = 'notesPinnedSection';
      pinned.className = 'notes-org-pinned hidden';
      pinned.innerHTML = '<div class="notes-org-pinned-head"><span>Закреплённые</span><b id="notesPinnedCount">0</b></div><div id="notesPinnedList" class="notes-org-pinned-list"></div>';
      noteList.before(pinned);
      repaired = true;
    }

    if (repaired) triggerOrganizationRender();
    document.documentElement.dataset.severNotesOrganizationRepair = 'v95';
    return true;
  }

  function schedule() {
    if (repair()) {
      clearTimeout(timer);
      return;
    }
    if (attempts++ >= 180) return;
    clearTimeout(timer);
    timer = setTimeout(schedule, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once:true });
  else schedule();
  window.addEventListener('load', schedule, { once:true });
  window.addEventListener('sever:ready', schedule);
})();
