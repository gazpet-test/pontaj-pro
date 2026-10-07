// semnaturaCms.ts — desfacerea unui fișier semnat electronic (CMS / PKCS#7 cu conținut atașat: .p7s, .p7m).
// Sursa unică pentru edge ofertare-seap-import și ofertare-seap-veghe (07.10.2026, PR #644). Înainte, cele două funcții
// aveau câte o copie identică („edge functions nu pot importa cod una din alta” — dar pot importa din _shared).
// Workerul NAS are parserul DER propriu (continutP7s, worker/ofertare/seap.ts), care aruncă eroare la semnătura detașată.
//
// Conținutul semnat stă într-un OCTET STRING ASN.1 care, la fișierele mari, e tăiat în bucăți de ~64KB, fiecare cu propriul
// antet. Se parcurge structura și se lipesc bucățile în ordine; altfel antetele rămân în mijlocul fișierului și îl strică.
const OID_DATA = new Uint8Array([0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01]);

function antet(b: Uint8Array, i: number) {
  const tip = b[i]; i += 1;
  let lung = b[i]; i += 1;
  if (lung === 0x80) return { tip, lung: null as number | null, start: i };
  if (lung & 0x80) {
    const n = lung & 0x7f;
    lung = 0;
    for (let k = 0; k < n; k++) lung = lung * 256 + b[i + k];
    i += n;
  }
  return { tip, lung: lung as number | null, start: i };
}

function lipeste(b: Uint8Array, start: number, capat: number): Uint8Array {
  const bucati: Uint8Array[] = [];
  let i = start;
  while (i < capat && i < b.length) {
    const a = antet(b, i);
    if (a.tip === 0x00) break;
    if (a.lung === null) { bucati.push(lipeste(b, a.start, capat)); break; }
    if (a.tip === 0x04) bucati.push(b.subarray(a.start, a.start + a.lung));
    else if (a.tip === 0x24) bucati.push(lipeste(b, a.start, a.start + a.lung));
    i = a.start + a.lung;
  }
  const total = bucati.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of bucati) { out.set(x, p); p += x.length; }
  return out;
}


function cautaSecventa(hay: Uint8Array, ac: Uint8Array): number {
  for (let i = 0; i <= hay.length - ac.length; i++) {
    let ok = true;
    for (let j = 0; j < ac.length; j++) if (hay[i + j] !== ac[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/** Conținutul unui fișier semnat CMS cu conținut ATAȘAT (.p7s / .p7m). `desfacut` = true doar dacă s-a extras efectiv un
 *  conținut nenul — numai atunci numele pierde extensia de semnătură.
 *  Dacă desfacerea nu reușește:
 *    - .p7s → comportamentul istoric: aceiași octeți, numele fără .p7s (SEAP pune .p7s pe documentele semnate cu conținut);
 *    - .p7m → numele RĂMÂNE cu .p7m, iar apelantul îl refuză (semnaturaFaraContinut). O semnătură detașată „Caiet.pdf.p7m”
 *      nu are voie să intre sub numele / cheia documentului real „Caiet.pdf” (Copilot conv. 3, NO-GO r1 pe #644). */
export function desfaSemnatura(buf: Uint8Array, nume: string): { buf: Uint8Array; nume: string; desfacut: boolean } {
  if (!/\.p7[ms]$/i.test(nume)) return { buf, nume, desfacut: false };
  const numeReal = nume.replace(/\.p7[ms]$/i, '');
  const esuat = { buf, nume: /\.p7m$/i.test(nume) ? nume : numeReal, desfacut: false };
  const poz = cautaSecventa(buf, OID_DATA);
  if (poz < 0) return esuat;
  const dupaOid = antet(buf, poz + OID_DATA.length);
  if (dupaOid.tip !== 0xa0) return esuat;
  const capat = dupaOid.lung === null ? buf.length : dupaOid.start + dupaOid.lung;
  const c = antet(buf, dupaOid.start);
  if (c.tip === 0x04 && c.lung !== null) return { buf: buf.subarray(c.start, c.start + c.lung), nume: numeReal, desfacut: c.lung > 0 };
  if (c.tip === 0x24 || c.lung === null) {
    const sfarsit = c.lung === null ? capat : c.start + c.lung;
    const out = lipeste(buf, c.start, sfarsit);
    if (out.length) return { buf: out, nume: numeReal, desfacut: true };
  }
  return esuat;
}

/** true = semnătură .p7m din care nu s-a putut scoate conținutul (de regulă detașată): NU se urcă și nu ia cheia
 *  documentului semnat. .p7s rămâne pe comportamentul istoric (vezi desfaSemnatura). */
export const semnaturaFaraContinut = (numeOriginal: string, r: { desfacut: boolean }) => /\.p7m$/i.test(String(numeOriginal ?? '')) && !r.desfacut;
