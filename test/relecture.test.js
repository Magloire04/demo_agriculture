import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { exporterCsv, importerCsv } from '../scripts/relecture/csv.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/solutions.json', import.meta.url), 'utf8'));

// Remplace une cellule d'une ligne repérée par sa clé (colonnes : cle;type;fr;fon;voix;source).
function modifier(csv, cle, colonne, valeur) {
  const index = { fon: 3, voix: 4 }[colonne];
  return csv.split('\r\n').map((ligne) => {
    if (!ligne.startsWith(`"${cle}";`)) return ligne;
    const cellules = ligne.split('";"');
    cellules[index] = valeur.replace(/"/g, '""');
    return cellules.join('";"');
  }).join('\r\n');
}

test('aller-retour sans changement : aucune alerte, données identiques', () => {
  const donnees = fixture();
  const csv = exporterCsv(donnees);
  assert.ok(csv.startsWith('﻿"cle";"type";"fr";"fon";"voix";"source"\r\n'));
  assert.ok(csv.includes('"gestes.fumure";"geste";'));
  assert.ok(csv.includes('"cas.haricot-foreurs.traitement.securite";"securite";'));
  const r = importerCsv(csv, donnees);
  assert.deepEqual(r.alertes, []);
  assert.deepEqual(r.donnees, fixture());
});

test('point-virgule et guillemets dans un texte survivent à l’aller-retour', () => {
  const donnees = fixture();
  donnees.gestes.fumure.fon = 'fon ; avec « guillemets » et "doubles"';
  donnees.gestes.fumure.voix = 'voix ; "citée"';
  const r = importerCsv(exporterCsv(donnees), donnees);
  assert.deepEqual(r.alertes, []);
  assert.equal(r.donnees.gestes.fumure.fon, 'fon ; avec « guillemets » et "doubles"');
  assert.equal(r.donnees.gestes.fumure.voix, 'voix ; "citée"');
});

test('fon corrigé sans la voix : une alerte nommant la clé', () => {
  const donnees = fixture();
  const csv = modifier(exporterCsv(donnees), 'gestes.desherber', 'fon', 'desherber fon corrigé');
  const r = importerCsv(csv, donnees);
  assert.equal(r.donnees.gestes.desherber.fon, 'desherber fon corrigé');
  assert.equal(r.alertes.length, 1);
  assert.ok(r.alertes[0].includes('gestes.desherber'));
  const lesDeux = modifier(csv, 'gestes.desherber', 'voix', 'desherber voix corrigée');
  assert.deepEqual(importerCsv(lesDeux, donnees).alertes, []);
});

test('clé inconnue : une alerte', () => {
  const donnees = fixture();
  const csv = `${exporterCsv(donnees)}"gestes.inexistant";"geste";"x";"y";"z";""\r\n`;
  const r = importerCsv(csv, donnees);
  assert.equal(r.alertes.length, 1);
  assert.ok(r.alertes[0].includes('gestes.inexistant'));
});

test('cellule fon vide : une alerte, valeur précédente gardée', () => {
  const donnees = fixture();
  const csv = modifier(modifier(exporterCsv(donnees), 'gestes.visiter', 'fon', ''), 'gestes.visiter', 'voix', '');
  const r = importerCsv(csv, donnees);
  assert.equal(r.donnees.gestes.visiter.fon, 'visiter fon');
  assert.equal(r.donnees.gestes.visiter.voix, 'visiter fon');
  assert.ok(r.alertes.some((a) => a.includes('gestes.visiter')));
});

test('fichier mal encodé (ANSI) : import refusé, rien n’est modifié', () => {
  const donnees = fixture();
  const csv = exporterCsv(donnees);
  // Excel en « CSV (point-virgule) » : lettres fon devenues « ? », accents devenus U+FFFD.
  const ansi = csv.replace(/[ɔɛɖ]/g, '?').replace(/é/g, '�');
  assert.throws(() => importerCsv(ansi, donnees), /UTF-8/);
  const lettresFonPerdues = modifier(modifier(csv, 'gestes.fumure', 'fon', 'fumure ?on'), 'gestes.fumure', 'voix', 'fumure ?on');
  assert.throws(() => importerCsv(lettresFonPerdues, donnees), /UTF-8/);
  assert.deepEqual(donnees, fixture());
});

test('colonnes manquantes : message clair', () => {
  const donnees = fixture();
  const sansCle = exporterCsv(donnees).replace('"cle";', '"clef";');
  assert.throws(() => importerCsv(sansCle, donnees), /colonnes manquantes : cle/i);
});
