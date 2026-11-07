import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Add food only on empty cells along the existing route. Keep the contribution
// cells and the original progress-bar animations unchanged.
export function decorateSnake(svg, { count = 30 } = {}) {
  if (svg.includes('data-kind="decoration"')) throw new Error('Snake is already decorated');
  const head = svg.match(/@keyframes s0\{((?:[^{}]*\{[^{}]*\})+)\}/)?.[1];
  if (!head) throw new Error('Cannot find the snake head animation');
  const frames = [];
  for (const match of head.matchAll(/([\d.% ,]+)\{transform:translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\}/g)) {
    for (const selector of match[1].split(',')) {
      frames.push({ time: parseFloat(selector), x: Number(match[2]), y: Number(match[3]) });
    }
  }
  frames.sort((a, b) => a.time - b.time);
  if (frames.length < 2 || frames[0].time !== 0) throw new Error('Unsupported head keyframes');

  const cells = [...svg.matchAll(/<rect class="c(?: [^"]+)?"[^>]*\/>/g)].map(match => {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
    return { markup: match[0], x: Number(attributes.x), y: Number(attributes.y), empty: attributes.class === 'c' };
  });
  if (!cells.length) throw new Error('Cannot find contribution grid');
  const xs = [...new Set(cells.map(cell => cell.x))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map(cell => cell.y))].sort((a, b) => a - b);
  const step = xs.length > 1 ? xs[1] - xs[0] : ys[1] - ys[0];
  if (!(step > 0)) throw new Error('Cannot determine grid spacing');
  const offsetX = xs[0];
  const offsetY = ys[0];

  const candidates = [];
  for (const cell of cells.filter(cell => cell.empty)) {
    const x = cell.x - offsetX;
    const y = cell.y - offsetY;
    // The SVG compresses straight runs into two keyframes. Interpolate each
    // run to recover when the head first reaches this grid coordinate.
    for (let index = 1; index < frames.length; index++) {
      const a = frames[index - 1];
      const b = frames[index];
      let fraction;
      if (a.y === b.y && y === a.y && a.x !== b.x) fraction = (x - a.x) / (b.x - a.x);
      else if (a.x === b.x && x === a.x && a.y !== b.y) fraction = (y - a.y) / (b.y - a.y);
      if (fraction === undefined || fraction < 0 || fraction > 1) continue;
      const time = a.time + fraction * (b.time - a.time);
      if (time > 0.1 && time < 98) candidates.push({ ...cell, time });
      break; // A revisit must not delay eating a block.
    }
  }
  candidates.sort((a, b) => a.time - b.time);
  const amount = Math.min(Math.max(0, Math.floor(count)), candidates.length);
  const colors = ['#58a6ff', '#f0a44b', '#ef7fb3'];
  const decorations = [];
  const styles = [];
  for (let index = 0; index < amount; index++) {
    const cell = candidates[Math.floor((index + 0.5) * candidates.length / amount)];
    const id = `decor${index}`;
    const color = colors[index % colors.length];
    const time = Number(cell.time.toFixed(4));
    styles.push(`@keyframes ${id}{0%,${(time - 0.01).toFixed(4)}%{fill:${color}}${(time + 0.01).toFixed(4)}%,100%{fill:var(--ce)}}.c.${id}{fill:${color};animation-name:${id}}`);
    const replacement = cell.markup.replace('class="c"', `class="c ${id}" data-kind="decoration" data-eaten-at="${time}"`);
    svg = svg.replace(cell.markup, replacement);
    decorations.push({ x: cell.x, y: cell.y, time, color });
  }
  svg = svg.replace('</style>', `${styles.join('')}</style>`);
  svg = svg.replace('</desc>', ' Blue, orange and pink blocks are decorative; only green contribution blocks advance the progress bar.</desc>');
  return { svg, decorations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('Pass one or more generated snake SVG paths');
  for (const path of paths) {
    const { svg, decorations } = decorateSnake(await readFile(path, 'utf8'));
    await writeFile(path, svg);
    console.log(`${path}: added ${decorations.length} decorative blocks; contribution progress unchanged.`);
  }
}
