import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRounds, renderSnake } from './generate-snake.mjs';

function calendar(points) {
  return { weeks: Array.from({ length: 53 }, (_, x) => ({ contributionDays: Array.from({ length: 7 }, (_, y) => {
    const day = new Date(Date.UTC(2025, 10, 2 + x * 7 + y));
    return { date: day.toISOString().slice(0, 10), contributionCount: points.some(point => point.x === x && point.y === y) ? 1 : 0, contributionLevel: 'FOURTH_QUARTILE' };
  }) })) };
}
const key = point => `${point.x},${point.y}`;

for (const points of [[], [{ x: 52, y: 3 }], [2, 3, 4, 5].map(y => ({ x: 52, y })), [{ x: 0, y: 0 }, { x: 52, y: 0 }, { x: 0, y: 6 }, { x: 52, y: 6 }, { x: 26, y: 3 }]]) {
  test(`bounded movement, complete contributions and randomized resets: ${points.length} green cells`, () => {
    const model = buildRounds(calendar(points), { seed: 42 });
    const green = new Set(points.map(key));
    assert.equal(model.rounds.length, 12);
    assert.deepEqual(new Set(model.contributions.map(key)), green);
    const layouts = new Set();
    for (const round of model.rounds) {
      const greenEats = round.eats.filter(event => event.kind === 'contribution');
      const foodEats = round.eats.filter(event => event.kind === 'decoration');
      assert.equal(greenEats.length, green.size, 'Every contribution cell must be eaten');
      for (let i = 1; i < greenEats.length; i++) assert.ok(round.eats.some(event => event.kind === 'decoration' && event.step > greenEats[i - 1].step && event.step < greenEats[i].step), 'Green cells should be separated by decorative food');
      assert.equal(foodEats.length, round.food.length, 'All visible decoration food must be eaten before reset');
      assert.ok(round.food.length >= 20);
      assert.equal(new Set(round.eats.map(key)).size, round.eats.length, 'Food may only be credited once per round');
      for (const cell of round.food) assert.ok(!green.has(key(cell)), 'Decoration cannot overwrite a contribution');
      layouts.add(round.food.map(key).sort().join(';'));
      const seenGreen = new Set();
      for (let step = 0; step < round.frames.length; step++) {
        const body = round.frames[step];
        assert.equal(new Set(body.map(key)).size, body.length, 'The snake cannot intersect itself');
        for (let part = 0; part < body.length; part++) {
          const point = body[part];
          assert.ok(Number.isInteger(point.x) && point.x >= 0 && point.x < model.width);
          assert.ok(Number.isInteger(point.y) && point.y >= 0 && point.y < model.height);
          if (part) assert.equal(Math.abs(point.x - body[part - 1].x) + Math.abs(point.y - body[part - 1].y), 1, 'Snake segments stay connected');
          if (step && part) assert.deepEqual(point, round.frames[step - 1][part - 1]);
        }
        if (step) assert.equal(Math.abs(body[0].x - round.frames[step - 1][0].x) + Math.abs(body[0].y - round.frames[step - 1][0].y), 1);
        if (green.has(key(body[0])) && !seenGreen.has(key(body[0]))) {
          seenGreen.add(key(body[0]));
          assert.ok(greenEats.some(event => event.step === step && key(event) === key(body[0])));
        }
      }
      for (const event of round.eats) assert.equal(key(event), key(round.frames[event.step][0]), 'Food disappears exactly at the head position');
    }
    assert.equal(layouts.size, model.rounds.length, 'Every reset uses a different food layout');
    const dark = renderSnake(model, true);
    const light = renderSnake(model, false);
    for (const svg of [dark, light]) {
      assert.equal((svg.match(/data-kind="contribution"/g) || []).length, green.size, 'One fixed contribution grid is shared by all rounds');
      const bars = [...svg.matchAll(/data-kind="contribution-progress"[^>]*>([\s\S]*?)<\/rect>/g)];
      assert.equal(bars.length, 12);
      bars.forEach((bar, index) => {
        const values = bar[1].match(/values="([^"]+)"/)[1].split(';').map(Number);
        const greenEats = model.rounds[index].eats.filter(event => event.kind === 'contribution').length;
        assert.equal(values.length - 1, greenEats, 'Only green food events advance the progress bar');
        assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= model.width * 16));
      });
      for (const match of svg.matchAll(/keyTimes="([^"]+)"/g)) {
        const times = match[1].split(';').map(Number);
        assert.equal(times[0], 0);
        assert.ok(times.every((value, index) => value >= 0 && value <= 1 && (!index || value > times[index - 1])), 'Animation times must be strictly ordered');
      }
      assert.ok(!svg.includes('NaN'));
    }
  });
}
