import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const key = ({ x, y }) => `${x},${y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];

function random(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(rng() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

function findPath(body, target, blocked, width, height, allowTerminal = false) {
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const inside = point => point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
  const queue = [{ path: [body[0]], body }];
  const seen = new Set([key(body[0])]);
  for (let index = 0; index < queue.length; index++) {
    const { path, body: currentBody } = queue[index];
    const head = path.at(-1);
    const occupied = new Set([...blocked, ...currentBody.slice(0, -1).map(key)]);
    if (same(head, target)) return path.slice(1);
    for (const [dx, dy] of directions) {
      const next = { x: head.x + dx, y: head.y + dy };
      const id = key(next);
      if (!inside(next) || occupied.has(id) || seen.has(id)) continue;
      const nextBody = [next, ...currentBody.slice(0, -1)];
      const nextOccupied = new Set([...blocked, ...nextBody.slice(0, -1).map(key)]);
      const canLeave = directions.some(([ex, ey]) => {
        const exit = { x: next.x + ex, y: next.y + ey };
        return inside(exit) && !nextOccupied.has(key(exit));
      });
      if (!canLeave && !(allowTerminal && same(next, target))) continue;
      seen.add(id);
      queue.push({ path: [...path, next], body: nextBody });
    }
  }
  return null;
}

export function buildRounds(calendar, { seed = randomBytes(4).readUInt32LE(), roundCount = 12, foodCount = 30 } = {}) {
  const rng = random(seed);
  const width = calendar.weeks.length;
  const height = 7;
  const contributions = calendar.weeks.flatMap((week, x) => week.contributionDays
    .filter(day => day.contributionCount > 0)
    .map(day => ({ x, y: new Date(`${day.date}T00:00:00Z`).getUTCDay(), date: day.date, level: Math.max(1, levels.indexOf(day.contributionLevel)) })));
  const green = new Map(contributions.map(cell => [key(cell), cell]));
  const empty = Array.from({ length: width * height }, (_, index) => ({ x: Math.floor(index / height), y: index % height })).filter(cell => !green.has(key(cell)));
  const rounds = [];
  let attempts = 0;
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    if (++attempts > roundCount * 100) throw new Error('Unable to generate enough playable rounds');
    const selected = shuffle(contributions, rng);
    let body;
    for (const start of shuffle(empty, rng)) {
      const candidate = Array.from({ length: 4 }, (_, offset) => ({ x: start.x - offset, y: start.y }));
      if (candidate.every(cell => cell.x >= 0 && !green.has(key(cell)))) { body = candidate; break; }
    }
    if (!body) throw new Error('No empty starting space for the snake');
    const initialBody = new Set(body.map(key));
    const food = shuffle(empty.filter(cell => !initialBody.has(key(cell))), rng).slice(0, foodCount)
      .map((cell, index) => ({ ...cell, color: ['#58a6ff', '#f0a44b', '#ef7fb3'][index % 3] }));
    const pendingFood = new Map(food.map(cell => [key(cell), cell]));
    const pendingGreen = new Map(selected.map(cell => [key(cell), cell]));
    const frames = [body.map(cell => ({ ...cell }))];
    const eats = [];
    let foodSinceGreen = 0;
    while (pendingFood.size || pendingGreen.size) {
      const seekGreen = pendingGreen.size > 0 && (foodSinceGreen >= 3 || pendingFood.size === 0);
      const targets = [...(seekGreen ? pendingGreen : pendingFood).values()].sort((a, b) => distance(body[0], a) - distance(body[0], b));
      let path = null;
      for (const target of targets) {
        const blocked = new Set(pendingGreen.keys());
        if (seekGreen) blocked.delete(key(target));
        path = findPath(body, target, blocked, width, height, Boolean(seekGreen && pendingGreen.size === 1 && pendingFood.size === 0));
        if (path) break;
      }
      if (!path) break;
      for (const point of path) {
        body = [point, ...body.slice(0, -1)];
        frames.push(body.map(cell => ({ ...cell })));
        const id = key(point);
        if (pendingFood.has(id)) {
          eats.push({ ...pendingFood.get(id), kind: 'decoration', step: frames.length - 1 });
          pendingFood.delete(id);
          foodSinceGreen++;
        }
        if (pendingGreen.has(id)) {
          eats.push({ ...pendingGreen.get(id), kind: 'contribution', step: frames.length - 1 });
          pendingGreen.delete(id);
          foodSinceGreen = 0;
        }
      }
    }
    // Only show reachable food. Every displayed decoration is eaten before reset.
    const eatenFood = new Set(eats.filter(event => event.kind === 'decoration').map(key));
    const greenEats = eats.filter(event => event.kind === 'contribution');
    const separated = food.length < greenEats.length - 1 || greenEats.every((event, index) => index === 0 || eats.some(foodEvent => foodEvent.kind === 'decoration' && foodEvent.step > greenEats[index - 1].step && foodEvent.step < event.step));
    if (pendingGreen.size || pendingFood.size || !separated || eatenFood.size < Math.min(20, food.length)) {
      roundIndex--;
      continue;
    }
    rounds.push({ frames, food: food.filter(cell => eatenFood.has(key(cell))), eats });
  }
  return { width, height, contributions, rounds, seed };
}

const fraction = value => Number(value.toFixed(7));
function animate(attribute, values, times, duration) {
  return `<animate attributeName="${attribute}" values="${values.join(';')}" keyTimes="${times.map(fraction).join(';')}" dur="${duration}s" repeatCount="indefinite" calcMode="discrete"/>`;
}

export function renderSnake(model, dark) {
  const cellSize = 16;
  const boardWidth = model.width * cellSize;
  const boardHeight = model.height * cellSize;
  const empty = dark ? '#161b22' : '#ebedf0';
  const border = dark ? '#30363d' : '#d0d7de';
  const colors = dark ? [empty, '#0e4429', '#006d32', '#26a641', '#39d353'] : [empty, '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  const durations = model.rounds.map(round => (round.frames.length - 1) * 0.09 + 0.8);
  const duration = durations.reduce((sum, value) => sum + value, 0);
  const green = new Map(model.contributions.map(cell => [key(cell), cell]));
  const rectangle = (cell, fill, extra = '', children = '') => `<rect x="${cell.x * cellSize + 2}" y="${cell.y * cellSize + 2}" width="12" height="12" rx="2" fill="${fill}" ${extra}>${children}</rect>`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boardWidth + 16}" height="160" viewBox="-8 -8 ${boardWidth + 16} 160" data-round-count="${model.rounds.length}" data-seed="${model.seed}" role="img" aria-labelledby="title desc"><title id="title">Contribution snake</title><desc id="desc">Each round eats all green contribution cells gradually, interspersed with randomized decorative food that gives no progress. The snake stays inside the board. Rounds repeat until the next daily generation.</desc><defs><clipPath id="board"><rect width="${boardWidth}" height="${boardHeight}"/></clipPath></defs>`;
  svg += `<g data-kind="fixed-grid" stroke="${border}" stroke-width="0.5">`;
  for (let x = 0; x < model.width; x++) for (let y = 0; y < model.height; y++) {
    const cell = green.get(`${x},${y}`);
    svg += rectangle({ x, y }, colors[cell?.level || 0], cell ? `data-kind="contribution" data-date="${cell.date}"` : '');
  }
  svg += `</g><rect x="0" y="130" width="${boardWidth}" height="8" rx="4" fill="${empty}"/>`;
  let elapsed = 0;
  model.rounds.forEach((round, index) => {
    const start = elapsed / duration;
    const end = (elapsed + durations[index]) / duration;
    const at = step => (elapsed + step * 0.09) / duration;
    const visibilityTimes = index ? [0, start, end] : [0, end];
    const visibilityValues = index ? ['hidden', 'visible', 'hidden'] : ['visible', 'hidden'];
    svg += `<g data-round="${index}" visibility="hidden">${animate('visibility', visibilityValues, visibilityTimes, duration)}<g clip-path="url(#board)">`;
    for (const cell of round.food) {
      const event = round.eats.find(event => event.kind === 'decoration' && same(event, cell));
      svg += rectangle(cell, cell.color, `data-kind="decoration" data-eaten-step="${event.step}"`, animate('fill', [cell.color, empty], [0, at(event.step)], duration));
    }
    const greenEats = round.eats.filter(event => event.kind === 'contribution');
    for (const event of greenEats) svg += rectangle(event, empty, `data-kind="eaten-contribution" opacity="0"`, animate('opacity', [0, 1], [0, at(event.step)], duration));
    for (let part = 3; part >= 0; part--) {
      const positions = round.frames.map(frame => frame[part]);
      const values = positions.map(point => `${point.x * cellSize} ${point.y * cellSize}`);
      const times = positions.map((_, step) => at(step));
      if (index) { values.unshift(values[0]); times.unshift(0); }
      values.push(values.at(-1)); times.push(1);
      const size = [14.4, 12.4, 11, 10][part];
      const margin = (16 - size) / 2;
      svg += `<rect data-kind="snake" data-part="${part}" x="${margin}" y="${margin}" width="${size}" height="${size}" rx="4" fill="${dark ? '#c084fc' : '#9333ea'}"><animateTransform attributeName="transform" type="translate" values="${values.join(';')}" keyTimes="${times.map(fraction).join(';')}" dur="${duration}s" repeatCount="indefinite" calcMode="linear"/></rect>`;
    }
    svg += `</g><rect data-kind="contribution-progress" x="0" y="130" width="0" height="8" rx="4" fill="${colors[4]}">`;
    const widths = [0, ...greenEats.map((_, eat) => boardWidth * (eat + 1) / model.contributions.length)];
    svg += animate('width', widths, [0, ...greenEats.map(event => at(event.step))], duration);
    svg += '</rect></g>';
    elapsed += durations[index];
  });
  return `${svg}</svg>\n`;
}

async function main() {
  const owner = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER;
  if (!owner || !process.env.GITHUB_TOKEN) throw new Error('PROFILE_USER and GITHUB_TOKEN are required');
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-snake' },
    body: JSON.stringify({ query: 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel}}}}}}', variables: { login: owner } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
  const calendar = result.data?.user?.contributionsCollection.contributionCalendar;
  if (!calendar) throw new Error('Contribution calendar unavailable');
  const model = buildRounds(calendar);
  await mkdir('assets', { recursive: true });
  await writeFile('assets/github-snake.svg', renderSnake(model, false));
  await writeFile('assets/github-snake-dark.svg', renderSnake(model, true));
  console.log(JSON.stringify({ rounds: model.rounds.length, greenCells: model.contributions.length, greenEatenEachRound: model.rounds.map(round => round.eats.filter(event => event.kind === 'contribution').length), board: [model.width, model.height], decorationsEachRound: model.rounds.map(round => round.food.length) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
