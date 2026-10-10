/**
 * Behaviour for content sections: roast hero, tabs and origin map.
 * Loaded once from the layout; every initialiser is idempotent and re-runs
 * when the theme editor (re)loads a section.
 */
(() => {
  const once = (el, key) => {
    if (el.dataset[key]) return false;
    el.dataset[key] = 'true';
    return true;
  };

  /* Roast hero: scroll progress → --roast-progress (0..1) + stage label. */
  const STAGES = ['Green', 'First crack', 'City', 'Full city', 'Second crack'];
  function initHero(root) {
    if (!once(root, 'heroReady')) return;
    const label = root.querySelector('[data-roast-stage]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = null;

    const update = () => {
      frame = null;
      const rect = root.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / (rect.height * 0.8)));
      root.style.setProperty('--roast-progress', progress.toFixed(3));
      if (label) label.textContent = STAGES[Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length))];
    };

    if (reduceMotion) {
      root.style.setProperty('--roast-progress', '0.5');
      if (label) label.textContent = 'City';
      return;
    }
    window.addEventListener('scroll', () => (frame ??= requestAnimationFrame(update)), { passive: true });
    update();
  }

  /* Tabs (WAI-ARIA pattern). */
  function initTabs(root) {
    if (!once(root, 'tabsReady')) return;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const active = t === tab;
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
      });
      tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) select(tabs[(i + step + tabs.length) % tabs.length]);
        if (e.key === 'Home') select(tabs[0]);
        if (e.key === 'End') select(tabs[tabs.length - 1]);
      });
    });
  }

  /* Origin map: pins toggle their story card. */
  function initOriginMap(root) {
    if (!once(root, 'mapReady')) return;
    const pins = [...root.querySelectorAll('[data-origin-pin]')];
    const cards = [...root.querySelectorAll('[data-origin-card]')];
    pins.forEach((pin) =>
      pin.addEventListener('click', () => {
        const id = pin.dataset.originPin;
        pins.forEach((p) => {
          p.classList.toggle('is-active', p === pin);
          p.setAttribute('aria-pressed', String(p === pin));
        });
        cards.forEach((card) => (card.hidden = card.dataset.originCard !== id));
      })
    );
  }

  function init(scope = document) {
    scope.querySelectorAll('[data-hero-roast]').forEach(initHero);
    scope.querySelectorAll('[data-tabs]').forEach(initTabs);
    scope.querySelectorAll('[data-origin-map]').forEach(initOriginMap);
  }

  init();
  document.addEventListener('shopify:section:load', (e) => init(e.target));
})();
