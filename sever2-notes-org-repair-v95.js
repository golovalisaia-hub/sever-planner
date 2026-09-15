(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let attempts = 0;
  let timer = 0;

  function installIosPushCoreFixLayer() {
    if (document.querySelector('script[data-sever-ios-push-corefix]')) return;
    const script = document.createElement('script');
    script.src = 'sever2-ios-push-corefix-v1111.js?v=1111';
    script.async = true;
    script.dataset.severIosPushCorefix = 'true';
    document.head.appendChild(script);
  }

  function installOnboardingV110Layer() {
    if (!document.querySelector('link[data-sever-onboarding-v110]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'sever2-onboarding-v110.css?v=110';
      link.dataset.severOnboardingV110 = 'true';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-sever-onboarding-v110]')) {
      const script = document.createElement('script');
      script.src = 'sever2-onboarding-v110.js?v=110';
      script.async = true;
      script.dataset.severOnboardingV110 = 'true';
      document.head.appendChild(script);
    }
  }

  function installFinanceV111Layer() {
    if (!document.querySelector('link[data-sever-finance-v111]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'sever2-finance-v111.css?v=111';
      link.dataset.severFinanceV111 = 'true';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-sever-finance-v111]')) {
      const script = document.createElement('script');
      script.src = 'sever2-finance-v111.js?v=111';
      script.async = true;
      script.dataset.severFinanceV111 = 'true';
      document.head.appendChild(script);
    }
  }

  function installLateExperienceLayers() {
    installOnboardingV110Layer();
    installFinanceV111Layer();
  }

  function scheduleLateExperienceLayers() {
    // Presentation/help layers are never boot dependencies. Load only after the
    // document load event so Finance/Onboarding cannot delay the planner core.
    if (document.readyState === 'complete') {
      setTimeout(installLateExperienceLayers, 0);
      return;
    }
    window.addEventListener('load', () => setTimeout(installLateExperienceLayers, 0), { once:true });
  }

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

  // The iOS push capture must exist before a user can reach Settings. It is a
  // reliability layer rather than a presentation layer, so do not defer it.
  installIosPushCoreFixLayer();

  // This late stable bootstrap remains the deterministic presentation loader;
  // Notes repair behavior and ownership remain unchanged.
  scheduleLateExperienceLayers();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once:true });
  else schedule();
  window.addEventListener('load', schedule, { once:true });
  window.addEventListener('sever:ready', schedule);
})();
