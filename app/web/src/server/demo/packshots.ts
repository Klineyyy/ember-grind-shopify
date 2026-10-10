/**
 * Branded product packshots for the demo catalog, generated as SVG.
 * Every coffee gets its own bag colour, label, roast meter and a seeded
 * contour-line pattern ("altitude"), so the grid reads as a real range.
 * Rendered to JPEG by scripts/render-packshots.ts.
 */
import { COFFEES, GEAR, type DemoCoffee, type DemoGear } from './catalog.js';

export const PACKSHOT_SIZE = 1200;

const INK = '#1E1A17';
const CREAM = '#FBF6EE';
const ROAST_COLORS = ['#c9a27a', '#a8754a', '#7b4a2b', '#55301b', '#2e1a10'];
const ROAST_LABELS = ['Light', 'Light–Medium', 'Medium', 'Medium–Dark', 'Dark'];

/** Mix a hex colour toward ink so accent-coloured text stays readable on the cream label. */
function darken(hex: string, amount = 0.4) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ir, ig, ib] = [0x1e, 0x1a, 0x17];
  const mix = (c: number, t: number) => Math.round(c + (t - c) * amount).toString(16).padStart(2, '0');
  return `#${mix(r, ir)}${mix(g, ig)}${mix(b, ib)}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function seeded(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function background(caption: string, shadowY = 1075, shadowRx = 340) {
  return `
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="78%">
        <stop offset="0" stop-color="#FAF2E7"/><stop offset="1" stop-color="#E6D3BC"/>
      </radialGradient>
      <filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1200" height="1200" fill="url(#bg)"/>
    <text x="72" y="96" font-family="Inter" font-size="22" font-weight="600" letter-spacing="5" fill="${INK}" opacity=".45">EMBER &amp; GRIND</text>
    <text x="1128" y="96" text-anchor="end" font-family="Inter" font-size="22" letter-spacing="4" fill="${INK}" opacity=".45">${esc(caption)}</text>
    <ellipse cx="600" cy="${shadowY}" rx="${shadowRx}" ry="34" fill="#3a2516" opacity=".28" filter="url(#blur)"/>`;
}

/** Wavy contour lines, seeded per product, used as the label band pattern. */
function contours(seed: string, color: string, x: number, y: number, w: number, h: number) {
  const rand = seeded(seed);
  const lines: string[] = [];
  const count = 9;
  const freq = 0.008 + rand() * 0.01;
  const amp = 8 + rand() * 14;
  for (let i = 0; i < count; i++) {
    const base = y + 10 + (i * (h - 20)) / (count - 1);
    const phase = rand() * Math.PI * 2;
    const pts: string[] = [];
    for (let px = x - 10; px <= x + w + 10; px += 12) {
      const py = base + Math.sin(px * freq + phase) * amp + Math.sin(px * freq * 2.7 + phase) * amp * 0.35;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    lines.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${(0.35 + (i % 3) * 0.2).toFixed(2)}"/>`);
  }
  return lines.join('');
}

function beanIcon(cx: number, cy: number, scale: number, fill: string, slit: string) {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) rotate(35)">
    <ellipse rx="6.5" ry="9" fill="${fill}"/>
    <path d="M-1.6 7.6c2.4-2.3 0.4-5.2 2.4-7.4 1.3-1.4 2.2-1.6 1.6-4.4" fill="none" stroke="${slit}" stroke-width="1.3" stroke-linecap="round"/>
  </g>`;
}

export function coffeePackshot(coffee: DemoCoffee, index: number) {
  const label = { x: 395, y: 372, w: 410, h: 560 };
  const startsWithOrigin = coffee.title.startsWith(coffee.origin);
  const big = startsWithOrigin ? coffee.origin : coffee.title.split(' ')[0];
  const rest = coffee.title.slice(big.length).trim();
  const bigSize = Math.min(60, Math.floor(370 / (big.length * 0.66)));
  const processLine = `${coffee.process} · ${coffee.altitude}`.toUpperCase();
  const processSize = Math.min(16, Math.floor(360 / (processLine.length * 0.78)));

  const notes = coffee.notes.map((n) => n.toUpperCase());
  const notesLines = notes.join(' · ').length > 26 ? [notes.slice(0, 2).join(' · '), notes.slice(2).join(' · ')] : [notes.join(' · ')];

  const beans = ROAST_COLORS.map((color, i) => {
    const cx = 600 + (i - 2) * 38;
    return `<ellipse cx="${cx}" cy="772" rx="11" ry="16" transform="rotate(28 ${cx} 772)" fill="${i < coffee.roast ? ROAST_COLORS[i] : '#E4D9CC'}"/>`;
  }).join('');

  const crimp = Array.from({ length: 44 }, (_, i) => `<line x1="${352 + i * 11.6}" y1="176" x2="${352 + i * 11.6}" y2="236" stroke="#000" stroke-opacity=".18" stroke-width="2"/>`).join('');
  const bagPath = 'M342 230 L858 230 L884 1028 Q886 1062 852 1062 L348 1062 Q314 1062 316 1028 Z';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
    ${background(`N° ${String(index + 1).padStart(2, '0')} · ${coffee.roast <= 2 ? 'FILTER ROAST' : coffee.roast >= 4 ? 'ESPRESSO ROAST' : 'OMNI ROAST'}`)}
    <defs>
      <linearGradient id="shade" x1="0" x2="1">
        <stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".16" stop-color="#000" stop-opacity="0"/>
        <stop offset=".8" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".3"/>
      </linearGradient>
      <clipPath id="band"><rect x="${label.x}" y="${label.y}" width="${label.w}" height="150" rx="18"/></clipPath>
    </defs>

    <!-- bag -->
    <path d="${bagPath}" fill="${coffee.bag}"/>
    <rect x="342" y="170" width="516" height="72" rx="6" fill="${coffee.bag}"/>
    <rect x="342" y="170" width="516" height="72" rx="6" fill="#000" opacity=".22"/>
    ${crimp}
    <circle cx="600" cy="300" r="24" fill="#000" opacity=".25"/><circle cx="600" cy="300" r="12" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="3"/>

    <!-- label -->
    <rect x="${label.x}" y="${label.y}" width="${label.w}" height="${label.h}" rx="18" fill="${CREAM}"/>
    <g clip-path="url(#band)">
      <rect x="${label.x}" y="${label.y}" width="${label.w}" height="150" fill="${coffee.accent}"/>
      ${contours(coffee.handle, '#ffffff', label.x, label.y, label.w, 150)}
    </g>
    <rect x="${label.x}" y="${label.y + 132}" width="${label.w}" height="18" fill="${CREAM}"/>
    <circle cx="600" cy="${label.y + 132}" r="34" fill="${CREAM}"/>
    ${beanIcon(600, label.y + 132, 2.6, INK, CREAM)}
    <text x="600" y="${label.y + 210}" text-anchor="middle" font-family="Inter" font-size="17" font-weight="600" letter-spacing="6" fill="${INK}" opacity=".7">EMBER &amp; GRIND</text>

    <text x="600" y="${label.y + 278}" text-anchor="middle" font-family="Fraunces" font-weight="800" font-size="${bigSize}" fill="${INK}">${esc(big.toUpperCase())}</text>
    ${rest ? `<text x="600" y="${label.y + 322}" text-anchor="middle" font-family="Fraunces" font-style="italic" font-size="30" fill="${INK}">${esc(rest)}</text>` : ''}
    <line x1="520" x2="680" y1="${label.y + 348}" y2="${label.y + 348}" stroke="${INK}" stroke-opacity=".2" stroke-width="2"/>
    <text x="600" y="${label.y + 380}" text-anchor="middle" font-family="Inter" font-size="${processSize}" font-weight="600" letter-spacing="2" fill="${INK}" opacity=".6">${esc(processLine)}</text>

    ${beans}
    <text x="600" y="${label.y + 446}" text-anchor="middle" font-family="Inter" font-size="15" letter-spacing="3" fill="${INK}" opacity=".55">${esc(ROAST_LABELS[coffee.roast - 1].toUpperCase())} ROAST</text>

    ${notesLines
      .map((line, i) => `<text x="600" y="${label.y + 492 + i * 26}" text-anchor="middle" font-family="Inter" font-size="17" font-weight="600" letter-spacing="2.5" fill="${darken(coffee.accent)}">${esc(line)}</text>`)
      .join('')}
    <text x="600" y="${label.y + label.h - 18}" text-anchor="middle" font-family="Inter" font-size="15" letter-spacing="3" fill="${INK}" opacity=".5">${coffee.decaf ? 'DECAF · ' : ''}250 G · ROASTED TO ORDER</text>

    <path d="${bagPath}" fill="url(#shade)"/>
  </svg>`;
}

/* ------------------------------ Brewing gear ------------------------------ */

/** Where each illustration touches the ground, so its shadow sits underneath it. */
const GEAR_BASE: Record<string, { y: number; rx: number }> = {
  'v60-ceramic-dripper': { y: 872, rx: 270 },
  'paper-filters-100': { y: 912, rx: 230 },
  'french-press-600ml': { y: 1004, rx: 190 },
  'stovetop-moka-pot-3-cup': { y: 1004, rx: 210 },
  'espresso-tamper-58mm': { y: 1022, rx: 220 },
};

const GEAR_ART: Record<string, string> = {
  'v60-ceramic-dripper': `
    <defs><linearGradient id="cer" x1="0" x2="1"><stop offset="0" stop-color="#E9E4DC"/><stop offset=".45" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9D2C7"/></linearGradient></defs>
    <ellipse cx="600" cy="840" rx="250" ry="44" fill="#D6CEC2"/><ellipse cx="600" cy="826" rx="250" ry="44" fill="url(#cer)"/>
    <path d="M360 430 L840 430 L668 800 L532 800 Z" fill="url(#cer)"/>
    <path d="M840 470 C960 470 980 640 860 650 L828 652 L846 612 C900 606 900 520 822 512 Z" fill="url(#cer)"/>
    <ellipse cx="600" cy="430" rx="240" ry="46" fill="#F3EFE9"/><ellipse cx="600" cy="436" rx="214" ry="34" fill="#5A3A2A"/>
    <ellipse cx="600" cy="440" rx="200" ry="26" fill="#3A2216"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${420 + i * 80} 480 Q${470 + i * 70} 640 ${545 + i * 28} 790" stroke="#D9D2C7" stroke-width="5" fill="none"/>`).join('')}
    <path d="M360 430 L532 800 L668 800 L840 430" fill="none" stroke="#C9C1B5" stroke-width="3"/>`,
  'paper-filters-100': `
    ${[2, 1, 0]
      .map(
        (i) => `<g transform="translate(${i * 46 - 46} ${i * -26}) rotate(${(i - 1) * 5} 600 700)">
      <path d="M380 440 L820 440 L670 900 L530 900 Z" fill="#FFFDF8" stroke="#E0D6C6" stroke-width="3"/>
      ${Array.from({ length: 14 }, (_, k) => `<line x1="${388 + k * 31}" y1="440" x2="${392 + k * 31}" y2="458" stroke="#D8CCB8" stroke-width="3"/>`).join('')}
      <path d="M530 900 L670 900" stroke="#D8CCB8" stroke-width="10"/></g>`
      )
      .join('')}
    <rect x="470" y="640" width="260" height="96" rx="10" fill="#E0662B"/>
    <text x="600" y="702" text-anchor="middle" font-family="Fraunces" font-weight="800" font-size="52" fill="#fff">100</text>`,
  'french-press-600ml': `
    <defs><linearGradient id="glass" x1="0" x2="1"><stop offset="0" stop-color="#DDEAF0" stop-opacity=".55"/><stop offset=".3" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#C7D9E2" stop-opacity=".6"/></linearGradient>
    <linearGradient id="steel" x1="0" x2="1"><stop offset="0" stop-color="#5C5C5C"/><stop offset=".4" stop-color="#C9C9C9"/><stop offset="1" stop-color="#4A4A4A"/></linearGradient></defs>
    <rect x="590" y="190" width="20" height="240" fill="url(#steel)"/><circle cx="600" cy="186" r="30" fill="#1E1A17"/>
    <path d="M470 400 Q600 360 730 400 L736 430 L464 430 Z" fill="#1E1A17"/>
    <rect x="480" y="430" width="240" height="560" rx="14" fill="url(#glass)" stroke="#9FB3BD" stroke-width="3"/>
    <rect x="486" y="600" width="228" height="384" rx="10" fill="#4A2A18"/><rect x="486" y="600" width="228" height="26" fill="#B98552" opacity=".8"/>
    <rect x="490" y="560" width="220" height="10" rx="4" fill="url(#steel)"/>
    <rect x="466" y="452" width="268" height="18" rx="4" fill="url(#steel)"/><rect x="466" y="960" width="268" height="40" rx="8" fill="url(#steel)"/>
    <path d="M734 520 C860 520 860 860 734 860" stroke="#1E1A17" stroke-width="34" fill="none" stroke-linecap="round"/>`,
  'stovetop-moka-pot-3-cup': `
    <defs><linearGradient id="alu" x1="0" x2="1"><stop offset="0" stop-color="#7D7D7D"/><stop offset=".25" stop-color="#E6E6E6"/><stop offset=".5" stop-color="#A9A9A9"/><stop offset=".75" stop-color="#DADADA"/><stop offset="1" stop-color="#6E6E6E"/></linearGradient></defs>
    <path d="M440 1000 L760 1000 L720 730 L480 730 Z" fill="url(#alu)"/>
    <rect x="470" y="700" width="260" height="36" fill="#8C8C8C"/>
    <path d="M480 700 L720 700 L770 430 L430 430 Z" fill="url(#alu)"/>
    <path d="M430 430 L770 430 L740 380 L460 380 Z" fill="#BDBDBD"/>
    <ellipse cx="600" cy="372" rx="40" ry="22" fill="#1E1A17"/>
    <path d="M430 440 L360 400 L392 470 Z" fill="#B5B5B5"/>
    <path d="M770 450 L870 470 L860 690 L800 690" stroke="#1E1A17" stroke-width="42" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    ${[520, 600, 680].map((x) => `<line x1="${x}" y1="440" x2="${x + (x - 600) * 0.1}" y2="690" stroke="#000" stroke-opacity=".12" stroke-width="3"/>`).join('')}`,
  'espresso-tamper-58mm': `
    <defs><linearGradient id="st" x1="0" x2="1"><stop offset="0" stop-color="#6A6A6A"/><stop offset=".35" stop-color="#F0F0F0"/><stop offset="1" stop-color="#5A5A5A"/></linearGradient>
    <linearGradient id="wal" x1="0" x2="1"><stop offset="0" stop-color="#3B2416"/><stop offset=".4" stop-color="#7A4B2C"/><stop offset="1" stop-color="#2E1B10"/></linearGradient></defs>
    <ellipse cx="600" cy="988" rx="190" ry="34" fill="#4A4A4A"/>
    <rect x="410" y="830" width="380" height="158" fill="url(#st)"/><ellipse cx="600" cy="830" rx="190" ry="34" fill="#DADADA"/>
    <path d="M540 830 L560 700 L640 700 L660 830 Z" fill="url(#st)"/>
    <path d="M560 700 C470 640 470 420 600 360 C730 420 730 640 640 700 Z" fill="url(#wal)"/>
    <ellipse cx="600" cy="366" rx="60" ry="14" fill="#E0662B"/>`,
};

export function gearPackshot(gear: DemoGear) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
    ${background('BREW GEAR', GEAR_BASE[gear.handle]?.y, GEAR_BASE[gear.handle]?.rx)}
    ${GEAR_ART[gear.handle] ?? ''}
    <text x="600" y="1150" text-anchor="middle" font-family="Fraunces" font-style="italic" font-size="34" fill="${INK}" opacity=".7">${esc(gear.title)}</text>
  </svg>`;
}

export function allPackshots() {
  return [
    ...COFFEES.map((c, i) => ({ handle: c.handle, alt: `${c.title} — Ember & Grind coffee bag`, svg: coffeePackshot(c, i) })),
    ...GEAR.map((g) => ({ handle: g.handle, alt: g.title, svg: gearPackshot(g) })),
  ];
}
