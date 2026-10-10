/**
 * Brew Profile quiz.
 *
 * Scoring is deliberately transparent: every coffee gets a 0–100 match built
 * from three weighted parts (flavour fit, roast fit, brew-method fit) plus
 * caffeine rules. The parts that score highest become the human-readable
 * "why it matched" reasons shown on each result.
 */
(() => {
  const FLAVOR_TARGETS = {
    fruity: { sweetness: 6, acidity: 8, body: 4, bitterness: 2, fruit: 9 },
    chocolatey: { sweetness: 8, acidity: 4, body: 7, bitterness: 4, fruit: 3 },
    bold: { sweetness: 5, acidity: 2, body: 9, bitterness: 7, fruit: 2 },
    balanced: { sweetness: 7, acidity: 5, body: 6, bitterness: 3, fruit: 5 },
  };

  // Ideal roast level (1 light – 5 dark) for each brewer.
  const METHOD_ROAST = { espresso: 3.5, 'pour-over': 1.5, 'french-press': 3.5, moka: 4, drip: 2.5 };

  const METHOD_GRIND = {
    espresso: 'Espresso',
    moka: 'Espresso',
    'pour-over': 'Filter',
    drip: 'Filter',
    'french-press': 'French Press',
  };

  const LABELS = {
    method: { espresso: 'espresso', 'pour-over': 'pour-over', 'french-press': 'French press', moka: 'moka pot', drip: 'drip' },
    flavor: { fruity: 'bright & fruity', chocolatey: 'chocolatey', bold: 'bold', balanced: 'balanced' },
    persona: {
      fruity: 'Bright',
      chocolatey: 'Cocoa',
      bold: 'Bold',
      balanced: 'Easygoing',
    },
    brewer: {
      espresso: 'Barista',
      'pour-over': 'Pour-over Purist',
      'french-press': 'Press Pro',
      moka: 'Stovetop Romantic',
      drip: 'Batch Brewer',
    },
  };

  const WEIGHTS = { flavor: 0.55, roast: 0.25, method: 0.2 };
  const PROFILE_KEYS = ['sweetness', 'acidity', 'body', 'bitterness', 'fruit'];
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function idealRoast(answers) {
    let roast = METHOD_ROAST[answers.method] ?? 3;
    if (answers.milk === 'milk') roast += 1; // milk needs body and caramel to cut through
    if (answers.milk === 'black' && answers.flavor === 'fruity') roast -= 0.5;
    return clamp(roast, 1, 5);
  }

  function flavorFit(profile, target) {
    if (!profile) return 50; // no data: neutral rather than punishing
    const diff = PROFILE_KEYS.reduce((sum, key) => sum + Math.abs((profile[key] ?? 5) - target[key]), 0);
    return clamp(100 - (diff / PROFILE_KEYS.length) * 12, 0, 100);
  }

  function scoreCoffee(coffee, answers) {
    const parts = {
      flavor: flavorFit(coffee.profile, FLAVOR_TARGETS[answers.flavor]),
      roast: clamp(100 - Math.abs(coffee.roast - idealRoast(answers)) * 22, 0, 100),
      method: coffee.methods.includes(answers.method) ? 100 : 45,
    };
    let score = parts.flavor * WEIGHTS.flavor + parts.roast * WEIGHTS.roast + parts.method * WEIGHTS.method;

    if (answers.caffeine === 'decaf') score = coffee.decaf ? score + 15 : score * 0.5;
    if (answers.caffeine === 'regular' && coffee.decaf) score *= 0.4;

    return { coffee, parts, score: Math.round(clamp(score, 0, 99)), reasons: explain(coffee, parts, answers) };
  }

  function explain(coffee, parts, answers) {
    const reasons = [];
    if (parts.flavor >= 75) reasons.push(`Nails your ${LABELS.flavor[answers.flavor]} profile`);
    if (parts.method === 100) reasons.push(`Roaster-tested for ${LABELS.method[answers.method]}`);
    if (parts.roast >= 78) reasons.push(`Roast level suits ${LABELS.method[answers.method]}`);
    if (answers.milk === 'milk' && (coffee.profile?.body ?? 0) >= 7) reasons.push('Stands up to milk');
    if (coffee.decaf) reasons.push('Swiss Water decaf');
    if (reasons.length === 0) reasons.push('A curveball worth trying');
    return reasons.slice(0, 3);
  }

  function grindFor(answers) {
    return answers.grinder === 'yes' ? 'Whole Bean' : METHOD_GRIND[answers.method] ?? 'Whole Bean';
  }

  /** Cheapest available variant whose options include the grind (i.e. the 250 g bag). */
  function pickVariant(coffee, grind) {
    const wanted = grind.toLowerCase();
    const available = coffee.variants.filter((v) => v.available);
    const matching = available.filter((v) => v.options.some((o) => o.toLowerCase() === wanted));
    const pool = matching.length ? matching : available;
    return pool.sort((a, b) => a.price - b.price)[0] ?? null;
  }

  class BrewQuiz {
    constructor(root) {
      this.root = root;
      this.form = root.querySelector('[data-quiz-form]');
      this.steps = [...root.querySelectorAll('[data-step]')];
      this.results = root.querySelector('[data-quiz-results]');
      this.catalog = JSON.parse(root.querySelector('[data-quiz-catalog]').textContent);
      this.discountCode = root.dataset.discountCode;
      this.index = 0;
      this.answers = {};
      this.picks = [];
      this.gear = null;

      // 'click' (not 'change') so re-picking the same answer after going back still advances.
      this.form.addEventListener('click', (e) => this.onAnswer(e));
      root.querySelector('[data-quiz-back]').addEventListener('click', () => this.go(this.index - 1));
      root.querySelector('[data-quiz-restart]').addEventListener('click', () => this.restart());
      root.querySelector('[data-sampler-add]').addEventListener('click', () => this.addSampler());
      this.render();
    }

    onAnswer(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
      this.answers[input.name] = input.value;
      // Small delay so the selected state is visible before advancing.
      setTimeout(() => (this.index === this.steps.length - 1 ? this.showResults() : this.go(this.index + 1)), 220);
    }

    go(index) {
      this.index = clamp(index, 0, this.steps.length - 1);
      this.render();
      this.steps[this.index].querySelector('input')?.focus({ preventScroll: true });
    }

    render() {
      this.steps.forEach((step, i) => step.classList.toggle('is-active', i === this.index));
      this.root.querySelector('[data-quiz-back]').disabled = this.index === 0;
      this.root.querySelector('[data-quiz-count]').textContent = `Question ${this.index + 1} of ${this.steps.length}`;
      this.setProgress((this.index / this.steps.length) * 100);
    }

    setProgress(pct) {
      this.root.querySelector('[data-quiz-progress]').style.width = `${pct}%`;
    }

    restart() {
      this.form.reset();
      this.answers = {};
      this.results.hidden = true;
      this.form.hidden = false;
      this.go(0);
    }

    showResults() {
      const ranked = this.catalog.coffees
        .map((coffee) => scoreCoffee(coffee, this.answers))
        .filter((r) => r.coffee.variants.some((v) => v.available))
        .sort((a, b) => b.score - a.score);

      const grind = grindFor(this.answers);
      this.picks = ranked.slice(0, 3).map((r) => ({ ...r, variant: pickVariant(r.coffee, grind) }));
      this.gear =
        this.catalog.gear.find((g) => g.available && g.tags.includes(`method:${this.answers.method}`)) ?? null;

      this.form.hidden = true;
      this.results.hidden = false;
      this.setProgress(100);
      this.renderResults(grind);
      this.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderResults(grind) {
      const { flavor, method, milk } = this.answers;
      const $ = (sel) => this.results.querySelector(sel);
      const money = window.theme.formatMoney;

      $('[data-quiz-profile-title]').textContent = `The ${LABELS.persona[flavor]} ${LABELS.brewer[method]}`;
      $('[data-quiz-profile-summary]').textContent =
        `You like ${LABELS.flavor[flavor]} coffee${milk === 'milk' ? ' with milk' : milk === 'black' ? ', black' : ''}, ` +
        `brewed as ${LABELS.method[method]}. Ideal roast: ${['', 'light', 'light–medium', 'medium', 'medium–dark', 'dark'][Math.round(idealRoast(this.answers))]}.`;

      const list = $('[data-quiz-matches]');
      if (this.picks.length === 0) {
        list.innerHTML = '<li class="match-empty">No coffees are in stock right now. Check back after Tuesday’s roast!</li>';
        $('[data-sampler]').hidden = true;
        return;
      }

      list.innerHTML = '';
      this.picks.forEach((pick, i) => list.appendChild(this.matchCard(pick, i)));

      $('[data-sampler]').hidden = false;
      $('[data-sampler-grind]').textContent = grind === 'Whole Bean' ? 'your grinder (whole bean)' : grind.toLowerCase();
      const total = this.picks.reduce((sum, p) => sum + (p.variant?.price ?? 0), 0);
      $('[data-sampler-total]').textContent = `${money(total)} for 3 bags`;

      const gearLabel = $('[data-sampler-gear]');
      gearLabel.hidden = !this.gear;
      if (this.gear) {
        $('[data-sampler-gear-title]').textContent = this.gear.title;
        $('[data-sampler-gear-price]').textContent = money(this.gear.price);
      }
    }

    matchCard({ coffee, score, reasons, variant }, index) {
      const li = document.createElement('li');
      li.className = 'match';
      li.style.setProperty('--delay', `${index * 90}ms`);

      const media = coffee.image
        ? `<img src="${coffee.image}" alt="" loading="lazy" width="120" height="120">`
        : `<span class="match__swatch" style="--bag: var(--roast-${coffee.roast})"></span>`;

      li.innerHTML = `
        <a class="match__media" href="${coffee.url}">${media}</a>
        <div class="match__body">
          <p class="eyebrow"></p>
          <h4><a href="${coffee.url}"></a></h4>
          <p class="match__notes"></p>
          <ul class="match__reasons"></ul>
        </div>
        <div class="match__side">
          <div class="match__score" style="--score: ${score}">
            <span>${score}%</span><small>match</small>
          </div>
          <button type="button" class="button button--ghost button--small" data-add-one>Add to bag</button>
        </div>`;
      // Text content is set separately so product data is never parsed as HTML.
      li.querySelector('.eyebrow').textContent = `#${index + 1} · ${coffee.origin ?? ''}`;
      li.querySelector('h4 a').textContent = coffee.title;
      li.querySelector('.match__notes').textContent = coffee.notes.join(' · ');
      const reasonList = li.querySelector('.match__reasons');
      reasons.forEach((r) => {
        const item = document.createElement('li');
        item.textContent = r;
        reasonList.appendChild(item);
      });
      const addOne = li.querySelector('[data-add-one]');
      if (variant) {
        addOne.addEventListener('click', () => this.addSingle(variant, addOne));
      } else {
        li.classList.add('is-unavailable');
        addOne.disabled = true;
        addOne.textContent = 'Sold out';
      }
      return li;
    }

    async addSingle(variant, button) {
      const error = this.root.querySelector('[data-quiz-error]');
      button.disabled = true;
      button.classList.add('is-loading');
      error.hidden = true;
      try {
        await window.theme.cart.add([{ id: variant.id, quantity: 1 }]);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { open: true } }));
        button.textContent = 'Added ✓';
      } catch (err) {
        error.textContent = err.message || 'Could not add that coffee. Please try again.';
        error.hidden = false;
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    }

    async addSampler() {
      const button = this.root.querySelector('[data-sampler-add]');
      const error = this.root.querySelector('[data-quiz-error]');
      const withGear = this.gear && this.root.querySelector('[data-sampler-gear-input]').checked;
      const profile = this.root.querySelector('[data-quiz-profile-title]').textContent;

      const items = this.picks
        .filter((p) => p.variant)
        .map((p) => ({ id: p.variant.id, quantity: 1, properties: { _bundle: 'Brew Profile sampler' } }));
      if (withGear) items.push({ id: this.gear.variantId, quantity: 1 });

      button.disabled = true;
      button.classList.add('is-loading');
      error.hidden = true;

      try {
        await window.theme.cart.add(items);
        const update = { attributes: { 'Brew profile': profile } };
        try {
          // Cart AJAX API applies the code to the cart directly — no redirect, works in theme preview too.
          await window.theme.cart.update(this.discountCode ? { ...update, discount: this.discountCode } : update);
        } catch {
          await window.theme.cart.update(update); // code rejected: keep the items, customer can enter it at checkout
        }
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { open: true } }));
      } catch (err) {
        error.textContent = err.message || 'Something went wrong adding your sampler. Please try again.';
        error.hidden = false;
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    }
  }

  document.querySelectorAll('[data-brew-quiz]').forEach((root) => {
    if (!root.dataset.ready) {
      root.dataset.ready = 'true';
      new BrewQuiz(root);
    }
  });
})();
