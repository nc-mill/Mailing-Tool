import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBudget } from './check-bundle-budget.mjs';

test('pod limitem projde', () => {
  const result = evaluateBudget({
    firstLoadBytes: 200 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: [],
  });
  assert.equal(result.ok, true);
});

test('nad limitem spadne a řekne o kolik', () => {
  const result = evaluateBudget({
    firstLoadBytes: 300 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /o 50/);
});

test('graf v základním balíku je chyba, i když se do limitu vejde', () => {
  const result = evaluateBudget({
    firstLoadBytes: 100 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: ['recharts'],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /recharts/);
});

test('vypíše všechny zakázané moduly naráz, ne jen první', () => {
  const result = evaluateBudget({
    firstLoadBytes: 100 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: ['recharts', 'query-builder'],
  });
  assert.match(result.message, /recharts/);
  assert.match(result.message, /query-builder/);
});
