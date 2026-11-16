// Regula de relevanta a radarului SEAP, scoasa din index.ts ca sa poata fi testata cu
// vitest (fara dependente de Deno). Comportamentul e cel din index.ts; singura schimbare
// de continut: prefixul CPV 45255 (lucrari de constructii de instalatii de suprafata
// pentru petrol si gaze) intra in CPV_OK.
// Ordinea din esteRelevant conteaza si NU se schimba:
//   cuvinte-cheie -> excluderi -> bransament -> CPV
// (un anunt cu "linie electrica" si CPV 45255 ramane exclus).

export const CPV_OK = ['45231', '45232', '45255', '45333', '65210', '65200'];
export const KEYWORDS = [
  'gaze naturale', 'gaz metan', 'distributie gaze', 'transport gaze', 'retea de gaze', 'retele de gaze',
  'conducta de gaz', 'conducte de gaz', 'bransament gaz', 'bransamente gaz', 'statie de reglare', 'srm ',
  'alimentare cu apa', 'retea de apa', 'retele de apa', 'canalizare', 'aductiune', 'apa uzata', 'gospodarie de apa',
];
export const EXCLUDE = [
  ' lea ', 'lea 0,4', '0,4 kv', '0.4 kv', '20 kv', '110 kv', 'linii electrice', 'linie electrica',
  'retele electrice', 'retea electrica', 'electricitate', 'iluminat public', 'post de transformare',
  'posturi de transformare', 'anvelopat', 'fibra optica', '45231400', '45231600', '45231500',
];

// Fara diacritice + litere mici (semnele combinate U+0300..U+036F, ca in sursa initiala)
const SEMNE_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export const noDia = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(SEMNE_RE, '');

export function esteRelevant(titlu, cpv) {
  const t = ' ' + noDia(titlu) + ' ' + noDia(cpv) + ' ';
  if (KEYWORDS.some((k) => t.includes(k))) return true;
  if (EXCLUDE.some((k) => t.includes(k))) return false;
  if (t.includes('bransament')) return true;
  return CPV_OK.some((p) => String(cpv ?? '').trim().startsWith(p));
}

export function detectSeg(autoritate, titlu, cpv) {
  const t = noDia(String(autoritate ?? '') + ' ' + String(titlu ?? '') + ' ' + String(cpv ?? ''));
  if (t.includes('transgaz')) return 'transgaz';
  if (t.includes('romgaz')) return 'romgaz';
  if (t.includes('conpet')) return 'conpet';
  if (/gaze|gaz metan|bransament/.test(t)) return 'distributie';
  return 'altele';
}
