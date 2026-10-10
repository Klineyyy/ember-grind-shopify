/**
 * Global storefront behaviour: money formatting, a tiny Cart API client,
 * the cart drawer and AJAX product forms.
 *
 * The cart drawer is a static section ("cart-drawer"), so after any cart
 * change we re-render it with the Section Rendering API instead of building
 * cart HTML in JavaScript. Liquid stays the single source of truth for markup.
 */
(() => {
  const theme = window.theme;

  theme.formatMoney = (cents) => {
    const amount = (cents / 100).toFixed(2);
    const noDecimals = Math.round(cents / 100).toString();
    const withCommas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const [whole, decimals] = amount.split('.');
    return theme.moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals':
          return withCommas(noDecimals);
        case 'amount_with_comma_separator':
          return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
        default:
          return `${withCommas(whole)}.${decimals}`;
      }
    });
  };

  async function request(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.description || data.message || 'Cart request failed');
    return data;
  }

  theme.cart = {
    add: (items) => request(`${theme.routes.cartAdd}.js`, { items }),
    change: (line, quantity) => request(`${theme.routes.cartChange}.js`, { line, quantity }),
    update: (body) => request(`${theme.routes.cart}/update.js`, body),
  };

  class CartDrawer {
    constructor() {
      this.lastFocus = null;
      document.addEventListener('click', (e) => this.onClick(e));
      document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
      document.addEventListener('cart:updated', (e) => this.refresh(e.detail?.open));
    }

    get el() {
      return document.querySelector('[data-cart-drawer]');
    }

    onClick(e) {
      const toggle = e.target.closest('[data-cart-toggle]');
      if (toggle && this.el) {
        e.preventDefault();
        this.open();
        return;
      }
      if (e.target.closest('[data-cart-close]')) {
        e.preventDefault();
        this.close();
        return;
      }
      const qtyButton = e.target.closest('[data-line-change]');
      if (qtyButton) {
        e.preventDefault();
        this.changeLine(Number(qtyButton.dataset.line), Number(qtyButton.dataset.lineChange));
      }
    }

    open() {
      const el = this.el;
      if (!el) return;
      this.lastFocus = document.activeElement;
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('has-drawer');
      el.querySelector('[data-cart-close]')?.focus();
    }

    close() {
      const el = this.el;
      if (!el || !el.classList.contains('is-open')) return;
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('has-drawer');
      this.lastFocus?.focus();
    }

    async changeLine(line, quantity) {
      this.el?.classList.add('is-busy');
      try {
        await theme.cart.change(line, Math.max(0, quantity));
        // The cart page renders totals server-side, so reload it rather than patching.
        if (document.body.classList.contains('template-cart')) return window.location.reload();
        await this.refresh(true);
      } finally {
        this.el?.classList.remove('is-busy');
      }
    }

    async refresh(openAfter = false) {
      const [html, cart] = await Promise.all([
        fetch(`${theme.routes.root}?section_id=cart-drawer`).then((r) => r.text()),
        fetch(`${theme.routes.cart}.js`).then((r) => r.json()),
      ]);
      const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-cart-drawer-inner]');
      const current = this.el?.querySelector('[data-cart-drawer-inner]');
      if (fresh && current) current.replaceWith(fresh);

      document.querySelectorAll('[data-cart-count]').forEach((badge) => {
        badge.textContent = cart.item_count;
        badge.hidden = cart.item_count === 0;
      });
      if (openAfter) this.open();
    }
  }

  /** Product forms submit over AJAX and open the drawer instead of navigating. */
  function initProductForms() {
    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-product-form]');
      if (!form || !document.querySelector('[data-cart-drawer]') || form.dataset.drawer === 'false') return;
      e.preventDefault();

      const button = form.querySelector('[type="submit"]');
      const error = form.querySelector('[data-form-error]');
      const data = new FormData(form);
      const properties = {};
      for (const [key, value] of data.entries()) {
        const match = key.match(/^properties\[(.+)\]$/);
        if (match && value) properties[match[1]] = value;
      }

      button.disabled = true;
      button.classList.add('is-loading');
      if (error) error.hidden = true;
      try {
        await theme.cart.add([{ id: Number(data.get('id')), quantity: Number(data.get('quantity') || 1), properties }]);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { open: true } }));
      } catch (err) {
        if (error) {
          error.textContent = err.message;
          error.hidden = false;
        }
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    });
  }

  theme.drawer = new CartDrawer();
  initProductForms();
})();
