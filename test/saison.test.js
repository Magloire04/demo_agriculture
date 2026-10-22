import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saisonDe } from '../server/saison.js';

const d = (iso) => new Date(iso);

test('Sud : deux saisons des pluies, transitions inconnues', () => {
  assert.equal(saisonDe('Atlantique', d('2026-05-10T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Ouémé', d('2026-08-15T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Mono', d('2026-09-20T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Littoral', d('2026-11-05T12:00:00Z')), null);
  assert.equal(saisonDe('Couffo', d('2027-01-10T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Plateau', d('2026-03-25T12:00:00Z')), null);
});

test('Zou et Collines : août inconnu (petite saison sèche faible)', () => {
  assert.equal(saisonDe('Zou', d('2026-08-15T12:00:00Z')), null);
  assert.equal(saisonDe('Collines', d('2026-06-15T12:00:00Z')), 'pluies');
});

test('Nord et Alibori', () => {
  assert.equal(saisonDe('Borgou', d('2026-04-15T12:00:00Z')), null);
  assert.equal(saisonDe('Donga', d('2026-07-01T12:00:00Z')), 'pluies');
  assert.equal(saisonDe('Atacora', d('2027-02-01T12:00:00Z')), 'seche');
  assert.equal(saisonDe('Alibori', d('2026-05-15T12:00:00Z')), null);
  assert.equal(saisonDe('Alibori', d('2026-06-02T12:00:00Z')), 'pluies');
});

test('heure de Porto-Novo, département inconnu', () => {
  assert.equal(saisonDe('Atlantique', d('2026-03-31T23:30:00Z')), 'pluies'); // 1er avril à Porto-Novo
  assert.equal(saisonDe(null, d('2026-05-10T12:00:00Z')), null);
  assert.equal(saisonDe('Inconnu', d('2026-05-10T12:00:00Z')), null);
});
