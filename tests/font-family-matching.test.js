import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMatchingFontFaces,
  levenshteinDistance,
  normalizeFontFamilyFingerprint
} from '../src/editor/public/font-family-matching.js';

test('font matching prefers exact family names', () => {
  const faces = [
    { id: 'a', family: 'Problem in Wisconsin' },
    { id: 'b', family: 'Problems in Winsconsin' }
  ];
  assert.deepEqual(findMatchingFontFaces('Problem in Wisconsin', faces), [faces[0]]);
});

test('font matching resolves conservative registry/internal family mismatches', () => {
  const face = { id: 'font-file', family: 'Problems in Winsconsin' };
  assert.deepEqual(findMatchingFontFaces('Problem in Wisconsin', [face]), [face]);
  assert.deepEqual(findMatchingFontFaces('Totally Different Font', [face]), []);
});

test('font matching normalization and distance remain deterministic', () => {
  assert.equal(normalizeFontFamilyFingerprint('  Problem-in Wisconsin '), 'probleminwisconsin');
  assert.equal(levenshteinDistance('problem', 'problems'), 1);
});

