/**
 * Ember & Grind demo catalog — the single source of truth for both the
 * store seeder (products, metafields, stock) and the simulated sales history.
 *
 * `demand` is average units/day across all variants; `coverDays` is how many
 * days of stock the seeder loads. Together they produce a deliberate mix of
 * critical, high, watch, healthy and overstocked products on the dashboard.
 */

export interface DemoCoffee {
  handle: string;
  title: string;
  origin: string;
  process: string;
  altitude: string;
  roast: 1 | 2 | 3 | 4 | 5;
  notes: string[];
  methods: string[];
  profile: { sweetness: number; acidity: number; body: number; bitterness: number; fruit: number };
  decaf?: boolean;
  price250: number;
  description: string;
  demand: number;
  coverDays: number;
  /** Multiplier applied to the last 7 days of simulated sales. */
  spike?: number;
  /** Packshot colours: bag body and label accent. */
  bag: string;
  accent: string;
}

export interface DemoGear {
  handle: string;
  title: string;
  price: number;
  cost: number;
  tags: string[];
  description: string;
  demand: number;
  coverDays: number;
}

export const GRINDS = ['Whole Bean', 'Espresso', 'Filter', 'French Press'] as const;
/** Share of a coffee's demand per variant. 1kg bags only come whole bean or espresso. */
export const VARIANT_MIX: { size: '250g' | '1kg'; grind: (typeof GRINDS)[number]; share: number }[] = [
  { size: '250g', grind: 'Whole Bean', share: 0.3 },
  { size: '250g', grind: 'Espresso', share: 0.22 },
  { size: '250g', grind: 'Filter', share: 0.2 },
  { size: '250g', grind: 'French Press', share: 0.1 },
  { size: '1kg', grind: 'Whole Bean', share: 0.1 },
  { size: '1kg', grind: 'Espresso', share: 0.08 },
];

export const COFFEES: DemoCoffee[] = [
  {
    handle: 'ethiopia-yirgacheffe-konga',
    bag: '#2F4B3A',
    accent: '#8FB8DE',
    title: 'Ethiopia Yirgacheffe Konga',
    origin: 'Ethiopia',
    process: 'Washed',
    altitude: '1,950 masl',
    roast: 1,
    notes: ['Jasmine', 'Blueberry', 'Bergamot'],
    methods: ['pour-over', 'drip'],
    profile: { sweetness: 7, acidity: 9, body: 3, bitterness: 1, fruit: 9 },
    price250: 19,
    description: 'Floral and tea-like with a blueberry finish. Our most-requested filter coffee.',
    demand: 7,
    coverDays: 6,
    spike: 1.7,
  },
  {
    handle: 'colombia-huila-la-esperanza',
    bag: '#7A2E2A',
    accent: '#E8A25B',
    title: 'Colombia Huila La Esperanza',
    origin: 'Colombia',
    process: 'Washed, 36h fermentation',
    altitude: '1,750 masl',
    roast: 2,
    notes: ['Red apple', 'Caramel', 'Cocoa nib'],
    methods: ['pour-over', 'drip', 'espresso'],
    profile: { sweetness: 8, acidity: 6, body: 5, bitterness: 2, fruit: 6 },
    price250: 17,
    description: 'Juicy and sweet with a caramel backbone. Works in almost any brewer.',
    demand: 5,
    coverDays: 45,
  },
  {
    handle: 'brazil-santa-ines',
    bag: '#4A3324',
    accent: '#D9A066',
    title: 'Brazil Santa Inês',
    origin: 'Brazil',
    process: 'Natural',
    altitude: '1,150 masl',
    roast: 4,
    notes: ['Hazelnut', 'Milk chocolate', 'Brown sugar'],
    methods: ['espresso', 'moka', 'french-press'],
    profile: { sweetness: 8, acidity: 2, body: 8, bitterness: 4, fruit: 2 },
    price250: 16,
    description: 'Nutty, chocolatey and low in acidity. The backbone of a great flat white.',
    demand: 8,
    coverDays: 16,
    spike: 1.4,
  },
  {
    handle: 'kenya-gakuyuini',
    bag: '#3B2340',
    accent: '#E06C75',
    title: 'Kenya Gakuyuini AA',
    origin: 'Kenya',
    process: 'Washed',
    altitude: '1,800 masl',
    roast: 2,
    notes: ['Blackcurrant', 'Grapefruit', 'Tomato vine'],
    methods: ['pour-over'],
    profile: { sweetness: 6, acidity: 10, body: 5, bitterness: 2, fruit: 10 },
    price250: 22,
    description: 'Big, savoury-sweet blackcurrant intensity. For people who like their coffee loud.',
    demand: 3,
    coverDays: 11,
  },
  {
    handle: 'sumatra-kerinci',
    bag: '#1F2A2E',
    accent: '#B08968',
    title: 'Sumatra Kerinci',
    origin: 'Sumatra',
    process: 'Wet-hulled',
    altitude: '1,500 masl',
    roast: 5,
    notes: ['Cedar', 'Dark chocolate', 'Tobacco'],
    methods: ['french-press', 'moka', 'espresso'],
    profile: { sweetness: 4, acidity: 1, body: 10, bitterness: 8, fruit: 1 },
    price250: 18,
    description: 'Earthy, heavy and syrupy. Made for the French press and a cold morning.',
    demand: 2,
    coverDays: 70,
  },
  {
    handle: 'guatemala-huehuetenango',
    bag: '#5B4636',
    accent: '#C9504A',
    title: 'Guatemala Huehuetenango',
    origin: 'Guatemala',
    process: 'Washed',
    altitude: '1,650 masl',
    roast: 3,
    notes: ['Milk chocolate', 'Red apple', 'Almond'],
    methods: ['drip', 'pour-over', 'french-press'],
    profile: { sweetness: 7, acidity: 5, body: 6, bitterness: 3, fruit: 5 },
    price250: 17,
    description: 'Clean, sweet and balanced — the coffee we drink when we are not thinking about coffee.',
    demand: 4,
    coverDays: 26,
  },
  {
    handle: 'ember-house-espresso',
    bag: '#1E1A17',
    accent: '#E0662B',
    title: 'Ember House Espresso',
    origin: 'Brazil & Colombia blend',
    process: 'Natural + washed',
    altitude: '1,200–1,700 masl',
    roast: 4,
    notes: ['Dark chocolate', 'Toffee', 'Cherry'],
    methods: ['espresso', 'moka'],
    profile: { sweetness: 8, acidity: 3, body: 9, bitterness: 5, fruit: 3 },
    price250: 16,
    description: 'Our house blend. Built for milk, forgiving on the grinder, rich on its own.',
    demand: 9,
    coverDays: 20,
  },
  {
    handle: 'decaf-colombia-swiss-water',
    bag: '#26415C',
    accent: '#F2B66D',
    title: 'Decaf Colombia Swiss Water',
    origin: 'Colombia',
    process: 'Swiss Water decaf',
    altitude: '1,600 masl',
    roast: 3,
    notes: ['Cocoa', 'Panela', 'Orange'],
    methods: ['espresso', 'pour-over', 'french-press', 'drip', 'moka'],
    profile: { sweetness: 7, acidity: 4, body: 6, bitterness: 3, fruit: 4 },
    decaf: true,
    price250: 18,
    description: 'Chemical-free decaf that actually tastes like coffee. All flavour, no jitters.',
    demand: 1,
    coverDays: 220,
  },
  {
    handle: 'rwanda-huye-mountain',
    bag: '#6B2D4E',
    accent: '#D96C8C',
    title: 'Rwanda Huye Mountain',
    origin: 'Rwanda',
    process: 'Washed',
    altitude: '1,900 masl',
    roast: 2,
    notes: ['Red grape', 'Hibiscus', 'Honey'],
    methods: ['pour-over', 'drip'],
    profile: { sweetness: 8, acidity: 8, body: 4, bitterness: 1, fruit: 8 },
    price250: 20,
    description: 'Bright red-grape acidity with a honeyed finish. A limited lot from Huye.',
    demand: 2.5,
    coverDays: 8,
  },
  {
    handle: 'costa-rica-tarrazu-honey',
    bag: '#8A5A2B',
    accent: '#F2A65A',
    title: 'Costa Rica Tarrazú Honey',
    origin: 'Costa Rica',
    process: 'Yellow honey',
    altitude: '1,700 masl',
    roast: 3,
    notes: ['Peach', 'Brown sugar', 'Cacao'],
    methods: ['pour-over', 'espresso', 'drip'],
    profile: { sweetness: 9, acidity: 6, body: 6, bitterness: 2, fruit: 7 },
    price250: 19,
    description: 'Honey-processed for stone-fruit sweetness. Lovely as a lighter espresso.',
    demand: 3,
    coverDays: 34,
  },
];

export const GEAR: DemoGear[] = [
  { handle: 'v60-ceramic-dripper', title: 'V60 Ceramic Dripper', price: 28, cost: 11, tags: ['method:pour-over'], description: 'The classic cone dripper. Spiral ribs, one big hole, endless control.', demand: 0.8, coverDays: 40 },
  { handle: 'paper-filters-100', title: 'Paper Filters (100)', price: 8, cost: 2.2, tags: ['method:pour-over', 'method:drip'], description: 'Oxygen-bleached filters that won’t flavour your cup.', demand: 1.5, coverDays: 9 },
  { handle: 'french-press-600ml', title: 'French Press 600ml', price: 39, cost: 16, tags: ['method:french-press'], description: 'Borosilicate glass and a double mesh filter for a cleaner press.', demand: 0.4, coverDays: 90 },
  { handle: 'stovetop-moka-pot-3-cup', title: 'Stovetop Moka Pot (3 cup)', price: 34, cost: 13, tags: ['method:moka'], description: 'Italian aluminium moka pot. Rich, intense, stovetop coffee.', demand: 0.3, coverDays: 160 },
  { handle: 'espresso-tamper-58mm', title: 'Espresso Tamper 58mm', price: 32, cost: 9, tags: ['method:espresso'], description: 'Weighted stainless tamper for level, consistent pucks.', demand: 0.5, coverDays: 30 },
];

export const variantPrice = (coffee: DemoCoffee, size: '250g' | '1kg') =>
  size === '250g' ? coffee.price250 : Math.round(coffee.price250 * 3.4);

/** Cost of goods ~32% of price. */
export const variantCost = (price: number) => Math.round(price * 0.32 * 100) / 100;

export const variantSku = (coffee: DemoCoffee, size: string, grind: string) =>
  `EG-${coffee.handle.split('-').slice(0, 2).join('-').toUpperCase()}-${size.toUpperCase()}-${grind.replace(/\s/g, '').slice(0, 3).toUpperCase()}`;

/** Look up the demo demand profile for a synced product (by title). */
export function demandProfileFor(title: string, variantTitle: string | null) {
  const coffee = COFFEES.find((c) => c.title === title);
  if (coffee) {
    const mix = VARIANT_MIX.find((m) => variantTitle === `${m.size} / ${m.grind}`);
    return { demand: coffee.demand * (mix?.share ?? 0.1), spike: coffee.spike ?? 1 };
  }
  const gear = GEAR.find((g) => g.title === title);
  if (gear) return { demand: gear.demand, spike: 1 };
  return null;
}
