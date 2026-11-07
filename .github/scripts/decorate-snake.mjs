import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

// Add food only on empty cells along the existing route. Keep the contribution
// cells and the original progress-bar animations unchanged.
export function decorateSnake(svg, { count = 30, rounds = 12, seed = randomBytes(4).readUInt32LE() } = {}) {
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
  const duration = Number(svg.match(/\.s\{[^}]*?(\d+)ms/)?.[1]);
  if (!duration) throw new Error('Cannot determine snake duration');
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
  const layers = [];
  const rand = () => {
    let v = seed += 0x6D2B79F5;
    v = Math.imul(v ^ v >>> 15, v | 1);
    v ^= v + Math.imul(v ^ v >>> 7, v | 61);
    return ((v ^ v >>> 14) >>> 0) / 4294967296;
  };
  for (let round = 0; round < rounds; round++) {
    const pool = [...candidates];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let index = 0; index < amount; index++) {
      const cell = pool[index];
      const id = `bonus${round}_${index}`;
      const color = colors[index % colors.length];
      const start = 100 * round / rounds;
      const eaten = 100 * (round + cell.time / 100) / rounds;
      const keyframes = round === 0
        ? `0%{opacity:1}${eaten.toFixed(6)}%,100%{opacity:0}`
        : `0%{opacity:0}${start.toFixed(6)}%{opacity:1}${eaten.toFixed(6)}%,100%{opacity:0}`;
      styles.push(`@keyframes ${id}{${keyframes}}.${id}{opacity:${round === 0 ? 1 : 0};animation:${id} ${duration * rounds}ms steps(1,end) infinite}`);
      layers.push(`<rect class="${id}" data-kind="decoration" data-round="${round}" data-eaten-at="${cell.time.toFixed(4)}" x="${cell.x}" y="${cell.y}" width="12" height="12" rx="2" fill="${color}"/>`);
      decorations.push({ round, x: cell.x, y: cell.y, time: cell.time, color });
    }
  }
  svg = svg.replace('</style>', `${styles.join('')}</style>`);
  const snakeStart = svg.indexOf('<rect class="s ');
  if (snakeStart < 0) throw new Error('Cannot find snake body');
  const firstProgress = svg.indexOf('<rect class="u ');
  const layerPosition = firstProgress < 0 ? snakeStart : firstProgress;
  svg = svg.slice(0, layerPosition) + layers.join('') + svg.slice(layerPosition);
  const width = xs.at(-1) - offsetX + step;
  const height = ys.at(-1) - offsetY + step;
  svg = svg.replace('<rect class="s ', `<defs><clipPath id="snake-board"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#snake-board)"><rect class="s `);
  svg = svg.replace('</svg>', '</g></svg>');
  svg = svg.replace('</desc>', ' Blue, orange and pink blocks are decorative; only green contribution blocks advance the progress bar.</desc>');
  return { svg, decorations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('Pass one or more generated snake SVG paths');
  const seed = randomBytes(4).readUInt32LE();
  for (const path of paths) {
    const { svg, decorations } = decorateSnake(await readFile(path, 'utf8'), { seed });
    await writeFile(path, svg);
    console.log(`${path}: added ${decorations.length} decorative blocks; contribution progress unchanged.`);
  }
}
