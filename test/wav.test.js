import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembler, ecrireWav, lireWav, reechantillonner } from '../server/wav.js';

const sinus = (f, fe, duree, a = 10_000) => Int16Array.from({ length: Math.round(fe * duree) }, (_, i) => Math.round(a * Math.sin((2 * Math.PI * f * i) / fe)));
const efficace = (e) => Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length);

// WAV écrit à la main : en-tête « fmt » au choix, blocs supplémentaires avant « data ».
function wavBrut({ canaux = 1, bits = 16, frequence = 16000, avantData = Buffer.alloc(0), donnees = Buffer.alloc(4) }) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(canaux, 10);
  fmt.writeUInt32LE(frequence, 12);
  fmt.writeUInt32LE((frequence * canaux * bits) / 8, 16);
  fmt.writeUInt16LE((canaux * bits) / 8, 20);
  fmt.writeUInt16LE(bits, 22);
  const data = Buffer.alloc(8);
  data.write('data', 0, 'latin1');
  data.writeUInt32LE(donnees.length, 4);
  const corps = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, avantData, data, donnees]);
  const tete = Buffer.alloc(8);
  tete.write('RIFF', 0, 'latin1');
  tete.writeUInt32LE(corps.length, 4);
  return Buffer.concat([tete, corps]);
}

test('écrire puis lire un WAV rend les mêmes échantillons', () => {
  const echantillons = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const tampon = ecrireWav({ frequence: 16000, echantillons });
  assert.equal(tampon.length, 54);
  assert.equal(tampon.toString('latin1', 0, 4), 'RIFF');
  assert.deepEqual(lireWav(tampon), { frequence: 16000, echantillons });
});

test('lireWav saute un bloc LIST et refuse un WAV stéréo, 8 bits, tronqué ou qui n’en est pas un', () => {
  const liste = Buffer.concat([Buffer.from('LIST', 'latin1'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO', 'latin1')]);
  const donnees = Buffer.from([0x10, 0x00, 0xf0, 0xff]); // 16 puis -16
  assert.deepEqual(lireWav(wavBrut({ frequence: 24000, avantData: liste, donnees })), { frequence: 24000, echantillons: Int16Array.from([16, -16]) });
  assert.throws(() => lireWav(wavBrut({ canaux: 2 })), /^Error: WAV non pris en charge/);
  assert.throws(() => lireWav(wavBrut({ bits: 8 })), /^Error: WAV non pris en charge/);
  assert.throws(() => lireWav(wavBrut({ donnees: Buffer.alloc(40) }).subarray(0, 50)), /^Error: WAV non pris en charge/);
  assert.throws(() => lireWav(Buffer.from('oops')), /^Error: WAV non pris en charge/);
});

test('24 kHz vers 16 kHz : longueur, amplitude et fréquence gardées pour 1 kHz', () => {
  const sortie = reechantillonner(sinus(1000, 24000, 1), 24000, 16000);
  assert.equal(sortie.length, 16000);
  const rapport = efficace(sortie.subarray(500, 15500)) / efficace(sinus(1000, 16000, 1));
  assert.ok(rapport > 0.95 && rapport < 1.05, String(rapport));
  let passages = 0;
  for (let i = 501; i < 15500; i++) if ((sortie[i - 1] < 0) !== (sortie[i] < 0)) passages++;
  assert.ok(Math.abs(passages - 1875) < 20, String(passages));
});

test('24 kHz vers 16 kHz : 10 kHz est coupé, sans repliement', () => {
  const sortie = reechantillonner(sinus(10000, 24000, 1), 24000, 16000);
  assert.ok(efficace(sortie.subarray(500, 15500)) < 0.05 * efficace(sinus(10000, 24000, 1)));
});

test('assembler met un silence entre deux sons', () => {
  assert.deepEqual([...assembler([Int16Array.from([1, 2]), Int16Array.from([3])], 1000, 3)], [1, 2, 0, 0, 0, 3]);
});
