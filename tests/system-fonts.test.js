import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractWindowsFontRegistryFamilies,
  normalizeFontFamilyList,
  parseFontFamilyFromBuffer
} from '../src/editor/server.js';

test('extractWindowsFontRegistryFamilies reads display names from registry output', () => {
  const output = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    '    Arial (TrueType)    REG_SZ    arial.ttf',
    '    Montserrat SemiBold (TrueType)    REG_SZ    Montserrat-SemiBold.ttf',
    '    Segoe UI Variable (TrueType)    REG_SZ    SegUIVar.ttf'
  ].join('\r\n');

  assert.deepEqual(extractWindowsFontRegistryFamilies(output), [
    'Arial',
    'Montserrat SemiBold',
    'Segoe UI Variable'
  ]);
});

test('normalizeFontFamilyList deduplicates and sorts font names', () => {
  assert.deepEqual(normalizeFontFamilyList([
    'Verdana',
    '  arial  ',
    'Arial',
    '',
    'Montserrat   ExtraBold'
  ]), [
    'arial',
    'Montserrat ExtraBold',
    'Verdana'
  ]);
});

test('parseFontFamilyFromBuffer reads the internal CSS family name', () => {
  const font = createMinimalNameTableFont('Boxpot');

  assert.equal(parseFontFamilyFromBuffer(font), 'Boxpot');
});

test('font family list preserves registry aliases for fonts with mismatched internal names', () => {
  assert.deepEqual(normalizeFontFamilyList([
    'Problems in Winsconsin',
    'Problem in Wisconsin'
  ]), [
    'Problem in Wisconsin',
    'Problems in Winsconsin'
  ]);
});

function createMinimalNameTableFont(familyName) {
  const encodedName = Buffer.from([...familyName].flatMap((character) => {
    const code = character.charCodeAt(0);
    return [code >> 8, code & 0xff];
  }));
  const buffer = Buffer.alloc(12 + 16 + 6 + 12 + encodedName.length);
  buffer.writeUInt32BE(0x00010000, 0);
  buffer.writeUInt16BE(1, 4);
  buffer.write('name', 12, 4, 'ascii');
  buffer.writeUInt32BE(28, 20);
  buffer.writeUInt32BE(18 + encodedName.length, 24);
  const nameOffset = 28;
  buffer.writeUInt16BE(0, nameOffset);
  buffer.writeUInt16BE(1, nameOffset + 2);
  buffer.writeUInt16BE(18, nameOffset + 4);
  const recordOffset = nameOffset + 6;
  buffer.writeUInt16BE(3, recordOffset);
  buffer.writeUInt16BE(1, recordOffset + 2);
  buffer.writeUInt16BE(0x0409, recordOffset + 4);
  buffer.writeUInt16BE(1, recordOffset + 6);
  buffer.writeUInt16BE(encodedName.length, recordOffset + 8);
  buffer.writeUInt16BE(0, recordOffset + 10);
  encodedName.copy(buffer, nameOffset + 18);
  return buffer;
}
