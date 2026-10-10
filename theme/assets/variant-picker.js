/**
 * Variant picker for the product page. Options are rendered as radio "pills";
 * this resolves the selected combination to a variant (from a JSON island)
 * and syncs the hidden id input, price, button state and URL.
 */
(() => {
  function init(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = 'true';

    const variants = JSON.parse(root.querySelector('[data-variants]').textContent);
    const form = document.getElementById(root.dataset.form);
    const idInput = form.querySelector('[name="id"]');
    const button = form.querySelector('[type="submit"]');
    const buttonLabel = button.querySelector('[data-button-label]');
    const priceEl = document.querySelector(`[data-price-for="${root.dataset.section}"]`);
    const { formatMoney } = window.theme;

    const selected = () =>
      [...root.querySelectorAll('fieldset')].map((fs) => fs.querySelector('input:checked')?.value);

    const update = () => {
      const options = selected();
      const variant = variants.find((v) => v.options.every((o, i) => o === options[i]));

      // Grey out values that are sold out given the other current selections.
      root.querySelectorAll('fieldset').forEach((fs, position) => {
        fs.querySelectorAll('input').forEach((input) => {
          const candidate = [...options];
          candidate[position] = input.value;
          const match = variants.find((v) => v.options.every((o, i) => o === candidate[i]));
          input.closest('label').classList.toggle('is-unavailable', !match || !match.available);
        });
      });

      if (!variant) {
        button.disabled = true;
        buttonLabel.textContent = button.dataset.unavailable;
        return;
      }
      idInput.value = variant.id;
      button.disabled = !variant.available;
      buttonLabel.textContent = variant.available ? button.dataset.add : button.dataset.soldOut;
      if (priceEl) {
        priceEl.innerHTML =
          variant.compare_at_price > variant.price
            ? `<s class="price__compare">${formatMoney(variant.compare_at_price)}</s> ${formatMoney(variant.price)}`
            : formatMoney(variant.price);
      }
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    };

    root.addEventListener('change', update);
    update();
  }

  const run = (scope = document) => scope.querySelectorAll('[data-variant-picker]').forEach(init);
  run();
  document.addEventListener('shopify:section:load', (e) => run(e.target));
})();
