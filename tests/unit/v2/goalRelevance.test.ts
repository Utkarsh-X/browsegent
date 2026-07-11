import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreGoalRelevance, compareGoalRelevance } from '../../../src/v2/planner/GoalRelevance';
import type { ProjectionItemKind } from '../../../src/v2/brain1/projectionTypes';

function named(name: string): { name: string; text?: string; role?: string; kind: ProjectionItemKind } {
  return { name, kind: 'button' };
}

function namedWithRole(name: string, role: string, kind: ProjectionItemKind): { name: string; text?: string; role: string; kind: ProjectionItemKind } {
  return { name, role, kind };
}

test('goal-relevant name scores higher than irrelevant name', () => {
  const relevant = scoreGoalRelevance('find climate data visualization', named('Climate data visualization'));
  const irrelevant = scoreGoalRelevance('find climate data visualization', named('Settings'));
  assert.ok(relevant.score > irrelevant.score, `relevant (${relevant.score}) should beat irrelevant (${irrelevant.score})`);
});

test('stopword-only name scores zero', () => {
  const result = scoreGoalRelevance('find climate data visualization', named('the and with'));
  assert.equal(result.score, 0);
});

test('compareGoalRelevance returns left when left is more relevant', () => {
  const result = compareGoalRelevance(
    'open account settings',
    named('Account settings'),
    named('Account'),
  );
  assert.equal(result, 'left');
});

test('compareGoalRelevance returns right when right is more relevant', () => {
  const result = compareGoalRelevance(
    'find latest news',
    named('Contact'),
    named('Latest news'),
  );
  assert.equal(result, 'right');
});

test('compareGoalRelevance returns tie when both are equally relevant', () => {
  const result = compareGoalRelevance(
    'search for articles',
    named('Search articles'),
    named('Search articles'),
  );
  assert.equal(result, 'tie');
});

test('phrase match scores higher than scattered token match', () => {
  // "climate data" appears as contiguous phrase in the first item
  const phraseItem = named('Climate data portal');
  // tokens match individually but not contiguously
  const scatteredItem = named('Data entry for climate research');
  const phraseScore = scoreGoalRelevance('find climate data', phraseItem);
  const scatteredScore = scoreGoalRelevance('find climate data', scatteredItem);
  assert.ok(phraseScore.phraseMatches > 0, 'phrase match expected');
  assert.ok(phraseScore.score > scatteredScore.score, `phrase (${phraseScore.score}) should beat scattered (${scatteredScore.score})`);
});

test('tokens shorter than 3 characters are excluded', () => {
  const result = scoreGoalRelevance('go to a map', named('Go'));
  // "go", "to", "a" are all < 3 chars, only "map" qualifies
  assert.equal(result.tokenMatches, 0); // "Go" name doesn't contain "map"
});

test('relevance uses text field as well as name', () => {
  const item: { name: string; text: string; role: string; kind: ProjectionItemKind } = { name: 'Button', text: 'Search for recipes', role: 'button', kind: 'button' };
  const result = scoreGoalRelevance('search for recipes', item);
  assert.ok(result.tokenMatches > 0);
});

test('empty goal produces zero score', () => {
  const result = scoreGoalRelevance('', named('Anything'));
  assert.equal(result.score, 0);
});

test('empty name/text produces zero score', () => {
  const result = scoreGoalRelevance('find something', { name: '', text: '', kind: 'button' as ProjectionItemKind });
  assert.equal(result.score, 0);
});
