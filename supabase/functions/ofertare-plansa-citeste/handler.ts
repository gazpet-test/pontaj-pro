// Citirea unei planse mari cu AI, felie cu felie, si trecerea rezultatului in cantitati.
//
// Plansele de proiect sunt scanari A0 de ~140 milioane de pixeli: nu incap intr-o
// singura citire, iar micsorate devin ilizibile exact unde conteaza. /api/plansa-felii
// (Vercel) le taie in bucati care se suprapun; functia asta le citeste pe rand,
// aduna ce a gasit si, cand termina toata plansa, scrie pozitiile in ofertare_cantitati.
//
// Ce cautam: tabelul de dimensionare (de acolo ies cantitatile reale - la Manastirea
// a scos 18 tronsoane insumand 37.320 m, adica exact totalul pe care memoriul il
// declara dar nu-l detalia), cartusul plansei, adnotarile de pe trasee, subtraversarile.
//
// Nu cerem AI-ului sa masoare din desen: la scara 1:10000 un milimetru inseamna 10
// metri, deci masurarea vizuala nu are precizia unei cantitati de oferta. Se citesc
// CIFRELE SCRISE pe plansa. Masuratorile exacte vin din CAD, cand exista (cad-parse).
//
// Bugetul unei rulari e limitat, deci se citesc cel mult FELII_PE_RULARE bucati si se
// intoarce continua=true; apelantul reia pana termina.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { poateCheltui } from './poarta.ts';
import { cheieVersiune, cheiResetare, elibereazaRezervari, fuzioneazaZone, leaseTransferOcupat, regiuneZona, revNou, rezervaChei, rezervariNoi, scrieCAS, shaGeometrie, transferDeReluat, versiuneIncompatibila } from './concurenta.ts';

// Apelul AI trece prin aiFetch ca testele (poarta_test.ts) să-l poată număra; în producție = fetch.
let aiFetch: typeof fetch = (...a) => fetch(...a);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = 'claude-opus-5';   // plansele cer citire vizuala buna; restul modulului foloseste Sonnet
const PRET_IN = 5 / 1e6, PRET_OUT = 25 / 1e6;
const FELII_PE_RULARE = 4;
// 25.09.2026: concurența e CONFIGURABILĂ (body.paralel, 1..4; implicit 2 = comportamentul vechi). Testul cu 4 se
// face controlat și se MĂSOARĂ (citire_ai.metrici): durata, 429/529, reîncercări, cost. Nu presupunem înjumătățirea.
const PARALEL = 2;
const PARALEL_MAX = 4;
const REINCERCARI = 2;
const COD_VERSIUNE = '2026-09-25.7'; // se schimbă la fiecare modificare a citirii/agregării (proveniență T11)          // doar pe limitări/suprasarcină furnizor (429, 529, 5xx), cu așteptare

const INSTRUCTIUNI = `Esti inginer proiectant de retele de gaze naturale si citesti o BUCATA dintr-o plansa de proiect scanata (schema tehnologica, plan de situatie, profil).

Extrage DOAR ce vezi scris efectiv in aceasta bucata. Nu deduce, nu completa din memorie, nu estima distante din desen.

Raspunde NUMAI cu JSON valid, fara text in jurul lui:
{
  "cartus": {"titlu": null, "plansa_nr": null, "proiect_nr": null, "scara": null, "data": null, "proiectant": null, "beneficiar": null},
  "tabele": [ {"denumire": "ex: Calcul dimensionare", "coloane": ["..."], "randuri": [ {"...": "..."} ]} ],
  "tronsoane": [ {"de_la": null, "la": null, "lungime_m": null, "diametru_mm": null, "material": null, "debit_mch": null, "zona": null, "sursa": "tabel|adnotare"} ],
  "noduri": [ {"numar": null, "denumire": null, "coordonate": null} ],
  "subtraversari": [ {"obstacol": null, "lungime_m": null, "tub_protectie": null, "pozitie": null} ],
  "bransamente": [ {"descriere": null, "numar": null} ],
  "alte_mentiuni": ["note tehnice relevante pentru cantitati sau executie"]
}

Reguli:
- OBLIGATORIU: fiecare rand dintr-un tabel de dimensionare trebuie sa apara SI in "tronsoane", cu sursa "tabel". Tabelul ramane in "tabele" asa cum e; "tronsoane" e lista din care se calculeaza cantitatile, deci nu sari niciun rand.
- Pune sursa "adnotare" DOAR pentru ce citesti de pe desen, nu dintr-un tabel. Daca acelasi tronson apare si in tabel, si scris pe traseu, da-l o singura data, cu sursa "tabel".
- In "zona" pune localitatea/satul/strada de pe randul respectiv, daca tabelul le are.
- Cotele de nivel (altimetrice, de obicei albastre, ex. 42.70) NU sunt lungimi de conducta — nu le pune in lungime_m.
- Lungimile trec-le in METRI (daca pe plansa scrie km, inmulteste cu 1000 si da valoarea in metri).
- Foloseste punctul ca separator zecimal in JSON si NU folosi separator de mii (scrie 4800, nu 4.800).
- Diametrul da-l ca numar in mm (Dn250 -> 250), si NUMAI din coloana al carei antet e diametru (Dn / De / D / Ø / diametru). Coloanele de debit (mc/h, Nmc/h), viteza, presiune, cadere de presiune, diametru interior (Di) NU sunt diametru nominal. Daca nu vezi antetul coloanei in bucata asta si nici nu ai primit antetul mai jos, pune diametru_mm null.
- La fiecare tabel pune in "coloane" antetele EXACT cum sunt scrise, in ordine. In de_la / la pune nodurile sau capetele tronsonului (Nod 1, CT, PRM ...), nu nume de persoane din cartus.
- Daca o sectiune nu apare in aceasta bucata, las-o lista goala sau null. E normal: fiecare bucata vede doar o parte.
- Daca un tabel e taiat de marginea bucatii, transcrie randurile intregi pe care le vezi si atat.
- Nu inventa valori pe care nu le poti citi clar.`;

// R3: rezultatul citirii — ok | partial | sursa_gresita_sigla | ilizibil | citita_fara_date_cantitative.
// Copilot R3: sursa_gresita_sigla DOAR pe identificare pozitivă (plansa.sursa_sigla_dovedita scris de /api/plansa-felii
// din raport 2:1 + <1000px + conținut simplu + text de semnătură suprapus); fără ea: „de reverificat/de randat”.
// Fără succes fals: acoperirea paginii nedemonstrată (tăieri istorice fără semnale, PDF >40MB sărit, fallback după
// randare nereușită) => partial „de verificat”, niciodată ok / citita_fara_date_cantitative. Eșecul tehnic (toate
// zonele căzute la apel, randare eșuată) NU devine „ilizibil” — ilizibil = lectură completă, fără niciun text.
export function rezultatCitire({ plansa, toate, sumar, zoneLipsa, prea_mica }: any): { rezultat: string; motiv: string } {
  const erori = Number(sumar?.erori) || 0, n = toate?.length || 0;
  if (plansa?.sursa_sigla_dovedita === true && plansa?.semnale_sigla?.identificare?.dovedita === true && !plansa?.vectorial)
    return { rezultat: 'sursa_gresita_sigla', motiv: 'imaginea citită e sigla semnăturii (identificare pozitivă: 2:1, <1000px, conținut simplu, text EasySign/„Semnat digital” pe imagine)' };
  if (plansa?.randare_esuata)
    return { rezultat: 'partial', motiv: 'de verificat: randarea paginii a eșuat (eșec tehnic, nu planșă ilizibilă)' };
  if (n && erori >= n) return { rezultat: 'partial', motiv: `de verificat: toate cele ${n} zone au căzut la citire (eșec tehnic, nu planșă ilizibilă) — „reia zonele căzute”` };
  // rândurile de tabel „de verificat” (fără identitate / conflicte) sunt tot date cantitative extrase — doar nesigure
  const date = (Number(sumar?.tronsoane_gasite) || 0) > 0 || (sumar?.tabele || []).length > 0 || (Number(sumar?.lungime_totala_m) || 0) > 0 ||
    (Number(sumar?.randuri_fara_identitate_n) || 0) > 0 || (sumar?.conflicte || []).length > 0;
  const completa = !erori && !(zoneLipsa || []).length && !prea_mica;
  if (!completa) return { rezultat: 'partial', motiv: prea_mica
    ? 'sursă de reverificat/de randat: sub 2000px fără identificare pozitivă de siglă (avertisment de rezoluție, nu verdict)'
    : `lectură incompletă (${erori} zone căzute, ${(zoneLipsa || []).length} zone lipsă)` };
  if (plansa?.acoperire_demonstrata !== true)
    return { rezultat: 'partial', motiv: `de verificat: acoperirea paginii nu e demonstrată (${plansa?.acoperire_motiv ||
      (plansa?.acoperire_demonstrata === false ? 'fallback / analiză sărită' : 'tăiere istorică fără semnale — retaie planșa')})` };
  if (date) return { rezultat: 'ok', motiv: 'date cantitative extrase' };
  const cuText = (toate || []).filter((r: any) => !r?.eroare && ((r?.cartus && Object.values(r.cartus).some(Boolean)) ||
    (r?.alte_mentiuni || []).length || (r?.noduri || []).length)).length;
  return cuText > 0
    ? { rezultat: 'citita_fara_date_cantitative', motiv: 'nu au fost identificate date cantitative în lectura efectuată' }
    : { rezultat: 'ilizibil', motiv: 'lectură completă fără niciun text recunoscut' };
}

// Randare text a citirii unei planșe (aceeași logică ca fn SQL ofertare_plansa_text din backfill-ul 25.09.2026).
function textPlansa(nume: string, c: any): string {
  const L: string[] = [`PLANȘĂ: ${nume}`];
  const cart = (c.felii || []).map((r: any) => r?.cartus).find((x: any) => x && Object.values(x).some(Boolean));
  if (cart) L.push('Cartuș: ' + Object.entries(cart).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; '));
  const s = c.sumar || {};
  L.push(`Rezumat citire AI: ${s.felii_citite ?? 0} zone citite, ${s.tronsoane_gasite ?? 0} tronsoane, lungime totală ${s.lungime_totala_m ?? 0} m, ` +
    `${s.subtraversari ?? 0} subtraversări, ${s.bransamente ?? 0} branșamente${s.erori ? `, ${s.erori} zone cu erori` : ''}.`);
  if ((s.tabele || []).length) L.push('Tabele: ' + s.tabele.join(', '));
  const tr = c.tronsoane_unice || [];
  if (tr.length) {
    L.push('', 'TRONSOANE:');
    for (const t of tr) L.push(`- ${t.de_la ?? '?'} -> ${t.la ?? '?'}: ${t.lungime_m ?? '?'} m` +
      `${t.diametru_mm ? `, Dn ${t.diametru_mm} mm` : ''}${t.material ? `, ${t.material}` : ''}${t.zona ? `, ${t.zona}` : ''}${t.sursa ? ` [${t.sursa}]` : ''}`);
  }
  if (s.randuri_fara_identitate_n || (s.conflicte || []).length) {
    L.push('', `DE VERIFICAT (rânduri de tabel NEincluse în cantități): ${s.total_de_verificat_m ?? 0} m`);
    for (const t of (s.randuri_fara_identitate || [])) L.push(`- ${t.de_la ?? '?'} -> ${t.la ?? '?'}: ${t.lungime_m} m${t.diametru_mm ? `, Dn ${t.diametru_mm} mm` : ''}${t.zona ? ` [${t.zona}]` : ''} — ${t.motiv}`);
    for (const k of (s.conflicte || [])) L.push(`- CONFLICT ${k.nr ? `Nr ${k.nr}` : k.identitate}: ${k.variante.map((v: any) => `${v.lungime_m} m${v.diametru_mm ? ` Dn${v.diametru_mm}` : ''} (${v.zone.join(', ')})`).join(' vs ')}`);
  }
  const sub = (c.felii || []).flatMap((r: any) => r.subtraversari || []);
  if (sub.length) { L.push('', 'SUBTRAVERSĂRI:'); for (const x of sub) L.push(`- ${[x.obstacol, x.lungime_m && `${x.lungime_m} m`, x.tub_protectie, x.pozitie].filter(Boolean).join(', ')}`); }
  const br = (c.felii || []).flatMap((r: any) => r.bransamente || []);
  if (br.length) { L.push('', 'BRANȘAMENTE:'); for (const x of br) L.push(`- ${[x.descriere, x.numar].filter(Boolean).join(', ')}`); }
  if ((c.note_lipite || []).length) { L.push('', 'NOTE (refăcute peste marginea zonelor):'); for (const n of c.note_lipite) L.push(`- ${n.text}`); }
  if (s.lungime_declarata_m) L.push(`Lungime totală declarată pe planșă: ${s.lungime_declarata_m} m`);
  if (s.necorelare_unitate) L.push(`⚠ NECORELARE unitate: ${s.necorelare_unitate}`);
  const alte = [...new Set((c.felii || []).flatMap((r: any) => r.alte_mentiuni || []).filter(Boolean))];
  if (alte.length) { L.push('', 'MENȚIUNI:'); for (const x of alte) L.push(`- ${x}`); }
  return L.join('\n');
}

async function citesteFelie(apiKey: string, jpeg: Uint8Array, eticheta: string, antete = '') {
  let binar = '';
  const bloc = 8192;
  for (let i = 0; i < jpeg.length; i += bloc) {
    binar += String.fromCharCode(...jpeg.subarray(i, i + bloc));
  }
  const b64 = btoa(binar);

  const t0 = Date.now();
  let r: Response, incercari = 0; const coduri: number[] = [];
  for (;;) {
  r = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      // Transcrierea unui tabel scanat nu are ce rationament sa ceara, iar gandirea
      // consuma din acelasi buget: la 4000 de tokeni o felie cu tabel mare a terminat
      // bugetul gandind si n-a mai apucat sa scrie JSON-ul (stop_reason max_tokens,
      // singurul bloc intors fiind cel de gandire). Masurat pe aceeasi felie:
      // cu gandire 6894 tokeni de iesire, fara 4625 - aceeasi informatie, o treime mai ieftin.
      max_tokens: 12000,
      thinking: { type: 'disabled' },
      system: INSTRUCTIUNI,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: `Bucata ${eticheta} din plansa. Extrage ce se vede.` + (antete ? `\nAntetele tabelelor citite in bucatile anterioare (acelasi tabel poate continua aici, fara antet): ${antete}` : '') },
        ],
      }],
    }),
  });
  if ((r.status === 429 || r.status === 529 || r.status >= 500) && incercari < REINCERCARI) {
    coduri.push(r.status); incercari++;
    const ra = Number(r.headers.get('retry-after')) || 0;
    await r.body?.cancel();
    await new Promise((ok) => setTimeout(ok, Math.min(20000, ra ? ra * 1000 : 3000 * 2 ** (incercari - 1))));
    continue;
  }
  break;
  }
  if (r.status >= 400) coduri.push(r.status);
  const _m = { _ms: Date.now() - t0, _reincercari: incercari, _coduri: coduri };
  const j = await r.json();
  const tin = j?.usage?.input_tokens || 0, tout = j?.usage?.output_tokens || 0;
  // Raspunsul poate incepe cu un bloc de gandire, deci textul NU e neaparat content[0]:
  // luat orbeste de pe prima pozitie, ieseau "raspuns gol" pe trei felii din patru si se
  // pierdea tacut trei sferturi din plansa.
  const blocuri = Array.isArray(j?.content) ? j.content : [];
  const txt = blocuri.filter((c: any) => c?.type === 'text').map((c: any) => c.text || '').join('\n');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) {
    const detaliu = j?.error?.message || txt ||
      `fara text (http ${r.status}, stop ${j?.stop_reason}, blocuri ${blocuri.map((c: any) => c?.type).join('+') || 'niciunul'})`;
    return { eticheta, eroare: String(detaliu).slice(0, 300), _tin: tin, _tout: tout, ..._m };
  }
  try {
    return { eticheta, ...JSON.parse(m[0]), _tin: tin, _tout: tout, ..._m };
  } catch (e) {
    return { eticheta, eroare: 'JSON invalid: ' + String((e as Error)?.message).slice(0, 120), _tin: tin, _tout: tout, ..._m };
  }
}

// ---- de aici in jos: din ce s-a citit ies cantitatile -----------------------------

const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const text = (v: unknown) => faraDiacritice(String(v ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();

// "4800", "4.800 m", "4,5" -> numar. In scrierea romaneasca punctul e separator de mii
// si virgula e zecimala, dar AI-ul poate scrie oricum, deci ghicim cu grija:
// "4.800" (cel mult 3 cifre inainte, exact 3 dupa) = patru mii opt sute;
// "23630.000" (5 cifre inainte) ramane zecimal — altfel ar iesi 23 de milioane.
function numar(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/^(-?\d{1,3})\.(\d{3})$/, '$1$2');
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Feliile se suprapun ca sa nu taie randuri de tabel pe margine, deci acelasi rand e
// citit de doua ori. Fara eliminarea dublurilor totalul iese umflat — exact genul de
// cifra gresita care ajunge tacut intr-o oferta.
//
// 25.09.2026 (Copilot, runda 3 — înlocuiește dedup-ul pe mulțime și pe MULTISET): rândurile de tabel se deduplică pe
// IDENTITATEA RÂNDULUI, nu pe text. Contraexemplul care a picat multiset-ul: felia A are rândul 37 (300 m Dn40), felia B
// rândul 40 (300 m Dn40) — text identic, două rânduri reale; max(1,1)=1 era greșit, corect = 2.
//   identitate = (document, pagină, tabel identificat, Nr rând); regiunea/felia rămân doar PROVENIENȚĂ.
// - Nr vine din coloana „Nr crt” a fragmentului de tabel din felie. Când Nr și lungimea stau în felii diferite (planșa
//   470: Nr în z?_6, L în z?_7), rândul se împerechează cu felia vecină pe ORIZONTALĂ din aceeași bandă, doar dacă
//   împerecherea e sigură: aceeași ordine a rândurilor (un singur decalaj posibil, |δ| ≤ 2), fiecare pereche are un
//   câmp comun IDENTIC (ex. Strada) și niciun câmp comun contrazis (prefix admis doar pe textul tăiat de margine / „...”).
// - Observațiile aceluiași rând (aceeași identitate) din felii suprapuse = UN rând. Valori diferite (L/Dn/Q) pentru aceeași
//   identitate = CONFLICT raportat, fără alegere automată; rândul NU intră în totalul sigur.
// - Rândul fără identitate sigură (Nr lipsă/ilizibil, împerechere nesigură, tronson nelegat de un rând din tabel) intră
//   la „de verificat”, cu totalul lui separat — nu dispare și nu se contopește pe text.
// - Tabel FĂRĂ coloană Nr (ex. planșa 130): identitatea e POZIȚIA rândului, admisă doar când toate rândurile cu lungime
//   ale tabelului stau într-o singură bandă verticală (fără suprapunere verticală de deosebit) și fragmentele vecine pe
//   orizontală sunt împerecheate sigur; altfel „de verificat”.
// - Adnotările (nu rânduri de tabel) rămân pe regulile existente (R5): dedup pe mulțime, fără multiset, fără identitate.
const E_TRUNCHIAT = /(\.\.\.|…)$/;
const antet = (h: unknown) => text(h).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const E_COL_NR = /^((nr|numar|poz|pozitie)( (crt|curent|tronson|trs|rand))?|crt)$/;
export function nrRand(v: unknown): string | null {
  const m = /^0*(\d{1,5})([a-z]?)$/.exec(text(v).replace(/\s+/g, '').replace(/\.$/, ''));
  return m ? `${Number(m[1])}${m[2]}` : null;
}
// Tronsonul (valori deja normalizate de AI: metri, Dn) corespunde rândului din tabel dacă celulele rândului conțin
// lungimea (în m sau km), Dn-ul și măcar un capăt (de_la / la).
function corespundeRand(t: any, rand: any): boolean {
  const cel = Object.values(rand || {}).map((v) => String(v ?? ''));
  const L = numar(t?.lungime_m);
  if (L && L > 0 && !cel.some((c) => { const x = numar(c); return x !== null && (Math.abs(x - L) <= 0.5 || Math.abs(x * 1000 - L) <= 0.5); })) return false;
  const dn = numar(t?.diametru_mm);
  if (dn !== null && !cel.some((c) => numar(c) === dn)) return false;
  const capete = [t?.de_la, t?.la].map(text).filter(Boolean);
  if (capete.length && !capete.some((x) => cel.some((c) => text(c) === x))) return false;
  return true;
}
// '=' identic | 'p' prefix admis (text tăiat de margine sau marcat „...”) | 'gol' | 'X' contrazis
function comparaCelule(a: unknown, b: unknown, aLaMargine: boolean, bLaMargine: boolean): string {
  const x = text(a), y = text(b);
  if (!x || !y) return 'gol';
  if (x === y) return '=';
  const xs = x.replace(E_TRUNCHIAT, '').trim(), ys = y.replace(E_TRUNCHIAT, '').trim();
  if ((aLaMargine || E_TRUNCHIAT.test(x)) && xs.length >= 3 && y.startsWith(xs)) return 'p';
  if ((bLaMargine || E_TRUNCHIAT.test(y)) && ys.length >= 3 && x.startsWith(ys)) return 'p';
  return 'X';
}
type Fragment = { i: number; felie: number; et: string; pre: string; r: number; c: number; pag: number; sig: string;
  hdr: string[]; colNr: string | null; randuri: Record<string, string>[]; brut: any[] };
// Împerecherea a două fragmente din felii vecine pe orizontală (A în stânga, B în dreapta): decalajul δ (|δ| ≤ 2) la care
// TOATE perechile suprapuse au un câmp comun identic și niciun câmp contrazis. Un singur δ valid = sigur; mai multe = ambiguu.
function perecheFragmente(A: Fragment, B: Fragment): { delta: number } | { ambiguu: true } | { nimic: true } | null {
  const comune = A.hdr.filter((h) => B.hdr.includes(h));
  if (!comune.length || !A.randuri.length || !B.randuri.length) return null;
  const margA = A.hdr[A.hdr.length - 1], margB = B.hdr[0];
  const valide: number[] = [];
  for (let d = -2; d <= 2; d++) {
    let n = 0, ok = true;
    for (let i = 0; i < A.randuri.length && ok; i++) {
      const j = i + d;
      if (j < 0 || j >= B.randuri.length) continue;
      n++;
      let ancora = false;
      for (const h of comune) {
        const c = comparaCelule(A.randuri[i][h], B.randuri[j][h], h === margA, h === margB);
        if (c === 'X') { ok = false; break; }
        if (c === '=') ancora = true;
      }
      if (!ancora) ok = false;
    }
    if (ok && n >= (d === 0 ? 1 : 2)) valide.push(d);          // un decalaj ≠ 0 cere cel puțin 2 perechi confirmate
  }
  if (valide.length === 1) return { delta: valide[0] };
  return valide.length > 1 ? { ambiguu: true } : { nimic: true };
}
// A doua cale, doar între două fragmente CU LUNGIMI (același tabel văzut întreg în două felii vecine, ex. planșa 130):
// decalajul unic la care TOATE perechile suprapuse (min. 2) au aceleași L, Dn și Q. Diferențele de transcriere pe
// celelalte coloane (cod SIRUTA, capete) nu schimbă identitatea; diferența pe L/Dn/Q nu se împerechează aici.
function perecheValori(A: Fragment, B: Fragment, val: Map<string, [number, number | null, number | null]>): { delta: number } | null {
  const valide: number[] = [];
  for (let d = -2; d <= 2; d++) {
    let n = 0, ok = true;
    for (let i = 0; i < A.randuri.length && ok; i++) {
      const j = i + d;
      if (j < 0 || j >= B.randuri.length) continue;
      n++;
      const va = val.get(`${A.i}:${i}`), vb = val.get(`${B.i}:${j}`);
      if (!va || !vb || Math.abs(va[0] - vb[0]) > 1e-6 || va[1] !== vb[1] || va[2] !== vb[2]) ok = false;
    }
    if (ok && n >= 2 && n >= Math.min(A.randuri.length, B.randuri.length) - Math.abs(d)) valide.push(d);
  }
  return valide.length === 1 ? { delta: valide[0] } : null;
}
function aceeasiBanda(plansa: any, a: string, b: string): boolean {
  const g = plansa?.zone_geom, ga = g?.[a.replace(/^z/, '')], gb = g?.[b.replace(/^z/, '')];
  if (!Array.isArray(ga) || !Array.isArray(gb)) return true;                 // fără geometrie: grila din etichetă
  return Number(ga[1]) === Number(gb[1]) && Number(ga[3]) === Number(gb[3]) && Number(ga[4] || 0) === Number(gb[4] || 0);
}
const cheieAdnotare = (t: any, lung: number, dn: number | null) =>
  [text(t?.de_la), text(t?.la), lung, dn ?? '', numar(t?.debit_mch) ?? '', text(t?.zona)].join('|');

export function identificaRanduri(felii: any[], opt: { doc?: unknown; plansa?: any } = {}) {
  const doc = opt.doc ?? '?', plansa = opt.plansa;
  const lista = (felii || []).filter((f: any) => f && !f.eroare);
  const frag: Fragment[] = [];
  const faraIdentitate: any[] = [];
  const adnotari: any[] = [];
  const vazuteAdn = new Set<string>();
  type Obs = { t: any; L: number; dn: number | null; q: number | null; fr: Fragment | null; rand: number; zona: string };
  const obs: Obs[] = [];
  let nObsTabel = 0;                                        // toate lecturile de rânduri de tabel cu lungime
  const nesigur = (t: any, L: number, dn: number | null, motiv: string, et: string) =>
    faraIdentitate.push({ ...t, _zona: t?._zona ?? et, lungime_m: L, diametru_mm: dn, _motiv: motiv });
  lista.forEach((f: any, iF: number) => {
    const et = String(f.eticheta || '').replace('.jpg', '');
    const m = /^(.*?)(\d+)_(\d+)$/.exec(et);
    const pag = Number(regiuneZona(plansa, et)?.pagina) || Number(f?.tronsoane?.[0]?._regiune?.pagina) || 1;
    const aici: Fragment[] = [];
    for (const tb of (Array.isArray(f.tabele) ? f.tabele : [])) {
      const randuriBrute = Array.isArray(tb?.randuri) ? tb.randuri.filter((r: any) => r && typeof r === 'object') : [];
      if (!randuriBrute.length) continue;
      const hdr: string[] = [];
      for (const h of [...(Array.isArray(tb.coloane) ? tb.coloane : []), ...randuriBrute.flatMap((r: any) => Object.keys(r))]) {
        const a = antet(h); if (a && !hdr.includes(a)) hdr.push(a);
      }
      const randuri = randuriBrute.map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [antet(k), String(v ?? '')])));
      const fr: Fragment = { i: frag.length, felie: iF, et, pre: m?.[1] ?? et, r: m ? Number(m[2]) : NaN, c: m ? Number(m[3]) : NaN, pag,
        sig: [...hdr].sort().join('|'), hdr, colNr: hdr.find((h) => E_COL_NR.test(h)) || null, randuri, brut: randuriBrute };
      frag.push(fr); aici.push(fr);
    }
    // tronsoanele cu sursa „tabel” se leagă de rândurile tabelelor din ACEEAȘI felie, în ordine (1:1), cu verificare pe valori
    const tabTr = (f.tronsoane || []).filter((t: any) => text(t?.sursa) === 'tabel');
    const cuL = (t: any) => { const L = numar(t?.lungime_m); return L && L > 0 ? L : null; };
    let leg: { fr: Fragment; rand: number }[] | null = null;
    const concat = (fs: Fragment[]) => fs.flatMap((fr) => fr.randuri.map((_, k) => ({ fr, rand: k })));
    if (tabTr.some(cuL)) {
      const toate = concat(aici);
      if (toate.length === tabTr.length) leg = toate;
      else {
        const dim = aici.filter((fr) => fr.brut.some((r) => tabTr.some((t: any) => cuL(t) && corespundeRand(t, r))));
        const d = concat(dim);
        if (d.length === tabTr.length) leg = d;
      }
    }
    tabTr.forEach((t: any, k: number) => {
      const L = cuL(t);
      if (!L) return;
      nObsTabel++;
      const dn = numar(t?.diametru_mm), q = numar(t?.debit_mch);
      if (!leg) return nesigur(t, L, dn, aici.length
        ? `tronsoanele din felie nu corespund 1:1 cu rândurile tabelului (${tabTr.length} vs ${concat(aici).length}) — rândul nu se poate identifica`
        : 'rând „din tabel” fără tabel transcris în felie — rândul nu se poate identifica', et);
      const x = leg[k];
      if (!corespundeRand(t, x.fr.brut[x.rand])) return nesigur(t, L, dn, 'valorile tronsonului diferă de rândul din tabel (aceeași felie)', et);
      obs.push({ t, L, dn, q, fr: x.fr, rand: x.rand, zona: et });
    });
    for (const t of (f.tronsoane || [])) {
      if (text(t?.sursa) === 'tabel') continue;
      const L = cuL(t); if (!L) continue;
      const dn = numar(t?.diametru_mm), k = cheieAdnotare(t, L, dn);
      if (vazuteAdn.has(k)) continue;
      vazuteAdn.add(k); adnotari.push({ ...t, lungime_m: L, diametru_mm: dn });
    }
  });

  // împerecheri orizontale (aceeași bandă, coloane vecine) => componente = același rând fizic văzut în mai multe felii
  const idNod = new Map<string, number>(); const noduri: { fr: Fragment; rand: number }[] = [];
  const nod = (fr: Fragment, rand: number) => { const k = `${fr.i}:${rand}`; if (!idNod.has(k)) { idNod.set(k, noduri.length); noduri.push({ fr, rand }); } return idNod.get(k)!; };
  frag.forEach((fr) => fr.randuri.forEach((_, k) => nod(fr, k)));
  const uf = noduri.map((_, i) => i);
  const rad = (x: number): number => (uf[x] === x ? x : (uf[x] = rad(uf[x])));
  const vecinNrNesigur = new Set<number>();                 // fragmente cu Nr în felia vecină, dar neîmperecheate sigur
  const vecinNeimp = new Set<number>();                     // fragmente vecine cu câmpuri comune, neîmperecheate sigur
  const valori = new Map<string, [number, number | null, number | null]>(obs.map((o) => [`${o.fr!.i}:${o.rand}`, [o.L, o.dn, o.q]]));
  const perechi: { a: string; b: string; delta: number; prin: string; diferente_text: number }[] = [];
  for (const A of frag) for (const B of frag) {
    if (A.pre !== B.pre || A.r !== B.r || B.c !== A.c + 1 || A.pag !== B.pag || !aceeasiBanda(plansa, A.et, B.et)) continue;
    const pt = perecheFragmente(A, B);
    const pv = pt && 'delta' in pt ? null : perecheValori(A, B, valori);
    const p = pt && 'delta' in pt ? pt : pv;
    // două fragmente vecine CU LUNGIMI, neîmperecheate, contează ca „neîmperecheate” chiar fără coloane comune
    const cuLungimi = (F: Fragment) => F.randuri.some((_, k) => valori.has(`${F.i}:${k}`));
    if (!pt && !pv && !(cuLungimi(A) && cuLungimi(B))) continue;
    if (p && 'delta' in p) {
      let dif = 0;
      const comune = A.hdr.filter((h) => B.hdr.includes(h));
      for (let i = 0; i < A.randuri.length; i++) {
        const j = i + p.delta;
        if (j < 0 || j >= B.randuri.length) continue;
        uf[rad(nod(A, i))] = rad(nod(B, j));
        if (pv) dif += comune.filter((h) => comparaCelule(A.randuri[i][h], B.randuri[j][h], false, false) === 'X').length;
      }
      perechi.push({ a: A.et, b: B.et, delta: p.delta, prin: pv ? 'valori L/Dn/Q' : 'câmp comun + ordine', diferente_text: dif });
    } else {
      vecinNeimp.add(A.i); vecinNeimp.add(B.i);
      if (B.colNr) vecinNrNesigur.add(A.i);
      if (A.colNr) vecinNrNesigur.add(B.i);
    }
  }
  const comp = new Map<number, number[]>();
  noduri.forEach((_, i) => { const r0 = rad(i); if (!comp.has(r0)) comp.set(r0, []); comp.get(r0)!.push(i); });
  const infoComp = new Map<number, { nrs: Map<string, string>; ambiguu: boolean; benzi: Set<number>; vecinNr: boolean; ref: { fr: Fragment; rand: number } }>();
  for (const [r0, membri] of comp) {
    const nrs = new Map<string, string>(); const felii = new Set<number>(); let ambiguu = false, vecinNr = false;
    const benzi = new Set<number>();
    let ref = noduri[membri[0]];
    for (const i of membri) {
      const { fr, rand } = noduri[i];
      if (felii.has(fr.felie)) ambiguu = true;
      felii.add(fr.felie); benzi.add(fr.r);
      if (vecinNrNesigur.has(fr.i)) vecinNr = true;
      if (fr.colNr) { const n = nrRand(fr.randuri[rand][fr.colNr]); if (n && !nrs.has(n)) nrs.set(n, fr.sig); }
      if (fr.felie < ref.fr.felie || (fr.felie === ref.fr.felie && rand < ref.rand)) ref = noduri[i];
    }
    infoComp.set(r0, { nrs, ambiguu, benzi, vecinNr, ref });
  }

  // identitatea fiecărei observații cu lungime
  type Id = { o: Obs; id: string; tip: 'nr' | 'pozitie'; nr: string | null; tabel: string };
  const cuId: Id[] = [];
  const candPoz: { o: Obs; c: any }[] = [];
  for (const o of obs) {
    const c = infoComp.get(rad(nod(o.fr!, o.rand)))!;
    const fr = o.fr!;
    if (c.ambiguu) { nesigur(o.t, o.L, o.dn, 'împerechere ambiguă: rândul se leagă de două rânduri din aceeași felie', o.zona); continue; }
    if (c.nrs.size > 1) { nesigur(o.t, o.L, o.dn, `Nr diferit pentru același rând în felii vecine (${[...c.nrs.keys()].join(' / ')})`, o.zona); continue; }
    if (c.nrs.size === 1) {
      const [nr, sig] = [...c.nrs.entries()][0];
      cuId.push({ o, id: `doc ${doc}|p${fr.pag}|${sig}|nr ${nr}`, tip: 'nr', nr, tabel: sig }); continue;
    }
    if (fr.colNr) { nesigur(o.t, o.L, o.dn, 'Nr lipsă sau ilizibil pe rând', o.zona); continue; }
    if (c.vecinNr) { nesigur(o.t, o.L, o.dn, 'Nr în felia vecină, dar împerecherea rândurilor nu e sigură (ordine/câmp comun)', o.zona); continue; }
    candPoz.push({ o, c });
  }
  // poziția ca identitate: doar tabel într-o singură bandă verticală, fragmente vecine împerecheate sigur
  const pePag = new Map<number, typeof candPoz>();
  for (const x of candPoz) pePag.set(x.o.fr!.pag, [...(pePag.get(x.o.fr!.pag) || []), x]);
  for (const [, xs] of pePag) {
    const benzi = new Set<number>(xs.flatMap((x) => [...x.c.benzi]));
    for (const x of xs) {
      const fr = x.o.fr!;
      if (benzi.size > 1) { nesigur(x.o.t, x.o.L, x.o.dn, 'tabel fără coloană Nr pe mai multe benzi — rândurile din suprapunerea verticală nu se pot deosebi', x.o.zona); continue; }
      if (vecinNeimp.has(fr.i) || Number.isNaN(fr.r)) { nesigur(x.o.t, x.o.L, x.o.dn, 'tabel fără coloană Nr, fragmente vecine neîmperecheate sigur — poziția rândului nu e sigură', x.o.zona); continue; }
      const ref = x.c.ref;
      cuId.push({ o: x.o, id: `doc ${doc}|p${fr.pag}|${ref.fr.sig}|poz ${ref.fr.et}#${ref.rand + 1}`, tip: 'pozitie', nr: null, tabel: ref.fr.sig });
    }
  }
  // același Nr sub două tabele (antete) diferite pe aceeași pagină => tabelul nu e identificat sigur
  const tabelePeNr = new Map<string, Set<string>>();
  for (const x of cuId) if (x.tip === 'nr') { const k = `${x.o.fr!.pag}|${x.nr}`; tabelePeNr.set(k, (tabelePeNr.get(k) || new Set()).add(x.tabel)); }
  const grupuri = new Map<string, Id[]>();
  for (const x of cuId) {
    if (x.tip === 'nr' && tabelePeNr.get(`${x.o.fr!.pag}|${x.nr}`)!.size > 1) {
      nesigur(x.o.t, x.o.L, x.o.dn, `Nr ${x.nr} apare în tabele cu antete diferite pe aceeași pagină — tabelul nu e identificat sigur`, x.o.zona); continue;
    }
    grupuri.set(x.id, [...(grupuri.get(x.id) || []), x]);
  }
  // observațiile aceleiași identități: valori identice => un rând; diferite => CONFLICT (fără alegere automată)
  const sigure: any[] = [], conflicte: any[] = [];
  const egal = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) < 1e-6;
  for (const [id, xs] of grupuri) {
    const b = xs[0];
    const dn = xs.map((x) => x.o.dn).find((v) => v !== null) ?? null;
    const q = xs.map((x) => x.o.q).find((v) => v !== null) ?? null;
    const zone = [...new Set(xs.map((x) => x.o.zona))];
    const difera = xs.some((x) => Math.abs(x.o.L - b.o.L) > 1e-6 || !egal(x.o.dn, dn) || !egal(x.o.q, q));
    if (difera) {
      const variante = new Map<string, any>();
      for (const x of xs) {
        const k = `${x.o.L}|${x.o.dn ?? ''}|${x.o.q ?? ''}`;
        const v = variante.get(k) || { lungime_m: x.o.L, diametru_mm: x.o.dn, debit_mch: x.o.q, zone: [] as string[] };
        if (!v.zone.includes(x.o.zona)) v.zone.push(x.o.zona);
        variante.set(k, v);
      }
      const vs = [...variante.values()];
      const ce = [vs.some((v) => Math.abs(v.lungime_m - b.o.L) > 1e-6) && 'lungime', vs.some((v) => !egal(v.diametru_mm, dn)) && 'diametru',
        vs.some((v) => !egal(v.debit_mch, q)) && 'debit'].filter(Boolean).join('/');
      conflicte.push({ identitate: id, tip: b.tip, nr: b.nr, tabel: b.tabel, motiv: `${ce} diferit(e) între lecturile aceluiași rând — nu se alege automat`,
        variante: vs, de_la: b.o.t?.de_la ?? null, la: b.o.t?.la ?? null, zona: b.o.t?.zona ?? null });
      continue;
    }
    sigure.push({ ...b.o.t, lungime_m: b.o.L, diametru_mm: dn, ...(q !== null ? { debit_mch: q } : {}),
      _identitate: id, _identitate_tip: b.tip, _nr: b.nr, _observatii: zone });
  }
  const suma = (l: any[]) => +l.reduce((s, t) => s + (Number(t.lungime_m) || 0), 0).toFixed(1);
  return {
    sigure, faraIdentitate, conflicte, adnotari, observatii_tabel: nObsTabel, perechi,
    total_sigur_m: suma(sigure),
    // de verificat = observațiile fără identitate (brut, fiecare lectură) + varianta MAXIMĂ a fiecărui conflict (plafon)
    total_de_verificat_m: +(suma(faraIdentitate) + conflicte.reduce((s, c) => s + Math.max(...c.variante.map((v: any) => v.lungime_m)), 0)).toFixed(1),
    prin: { nr: sigure.filter((t) => t._identitate_tip === 'nr').length, pozitie: sigure.filter((t) => t._identitate_tip === 'pozitie').length },
  };
}

// PE / OL / PEHD etc. din textul liber citit de AI (sau din denumirea poziției) — '' când nu se știe
function materialNorm(x: unknown): string {
  const t = faraDiacritice(String(x || '')).toUpperCase();
  if (/\bPE(HD|100|80)?\b|POLIETILEN/.test(t)) return 'PE';
  if (/\bOL\b|OTEL|L\d{3}|\bST\s?\d/.test(t)) return 'OL';
  return '';
}

// Cantitatile deja existente vin din memoriu (partea scrisa). Plansa da a doua sursa
// pentru aceleasi diametre, deci nu duplicam pozitii: completam `cantitate_plansa` si
// notam diferenta. Pozitia se adauga doar daca diametrul nu exista deloc in oferta.
// Primeste lista deja filtrata (vezi `pentruCantitati` mai jos).
// R4 (lease expirat): `detineLease` se verifică ÎNAINTE de FIECARE scriere în ofertare_cantitati, nu doar la eliberare —
// altfel o rulare care a „adormit” peste 5 min (lease preluat între timp de alta) ar scrie peste cantitățile noului deținător.
export class LeasePierdut extends Error { constructor() { super('lease pierdut'); } }
// R4 (Copilot, atomic): scrierile NU se mai fac aici una câte una — se strâng în `ops` și se aplică printr-un singur
// RPC (ofertare_transfer_plansa_cantitati): verificare lease (FOR UPDATE pe doc) + update/insert idempotent + transfer
// stare='facut', totul în aceeași tranzacție. Lease pierdut => 0 scrieri.
// 25.09.2026 (identitate de rând): `tronsoane` = DOAR rândurile cu identitate sigură (fără conflict, Dn standard); restul
// (fără identitate / conflicte / nestandard) NU se promovează în cantitate_plansa — se menționează în diferenta_nota (`rest`).
export type RestTransfer = { peDn: Record<string, { n: number; m: number }>; global: string };
export const randuri = (n: number) => `${n} ${n === 1 ? 'rând' : 'rânduri'}`;
export function notaRestTransfer(idr: { faraIdentitate: any[]; conflicte: any[]; total_de_verificat_m: number }, nestandard: any[] = []): RestTransfer {
  const fmt = (x: number) => (+x.toFixed(1)).toLocaleString('ro-RO');
  const peDn: Record<string, { n: number; m: number }> = {};
  for (const t of idr.faraIdentitate) {
    const k = t.diametru_mm ? String(t.diametru_mm) : '?';
    const g = peDn[k] || (peDn[k] = { n: 0, m: 0 });
    g.n++; g.m += Number(t.lungime_m) || 0;
  }
  const p: string[] = [];
  if (idr.faraIdentitate.length) p.push(`${randuri(idr.faraIdentitate.length)} de tabel fără identitate sigură (${fmt(idr.faraIdentitate.reduce((s, t) => s + (Number(t.lungime_m) || 0), 0))} m)`);
  if (idr.conflicte.length) p.push(`${idr.conflicte.length} conflict${idr.conflicte.length === 1 ? '' : 'e'} (același rând citit diferit: ` +
    idr.conflicte.slice(0, 6).map((c: any) => `${c.nr ? `Nr ${c.nr}` : 'rând'} ${c.variante.map((v: any) => `${fmt(v.lungime_m)} m${v.diametru_mm ? ` Dn${v.diametru_mm}` : ''}`).join(' / ')}`).join('; ') + ')');
  if (nestandard.length) {
    const dns = [...new Set(nestandard.map((t: any) => Number(t.diametru_mm)))].sort((a, b) => a - b);
    p.push(`Dn nestandard ${dns.map((d) => `Dn${d}`).join(', ')}: ${fmt(nestandard.reduce((s: number, t: any) => s + (Number(t.lungime_m) || 0), 0))} m`);
  }
  return { peDn, global: p.join('; ') };
}
async function treciInCantitati(supa: any, doc: any, tronsoane: any[], nrPlansa: string | null, rulare: string, rest?: RestTransfer) {
  const ops: any[] = [];
  const fmtR = (x: number) => (+x.toFixed(1)).toLocaleString('ro-RO');
  const sufixRest = (dn: number | null) => {
    const p: string[] = [];
    const x = dn !== null ? rest?.peDn?.[String(dn)] : null;
    if (x) p.push(`${randuri(x.n)} Dn${dn} fără identitate sigură (${fmtR(x.m)} m)`);
    if (rest?.global) p.push(`pe planșă: ${rest.global}`);
    return p.length ? ` De verificat, NEincluse în cifra din planșă: ${p.join('; ')}.` : '';
  };
  // 25.09.2026 (Jakarinos): gruparea era DOAR pe diametru — Dn110 PE și Dn110 OL (sau SDR11 vs SDR17) se
  // adunau într-o singură cifră. Acum cheia e diametru + material; SDR-ul rămâne în specificații.
  const peDiametru = new Map<string, { dn: number; mat: string; m: number; n: number; zone: Set<string>; sdr: Set<string> }>();
  for (const t of tronsoane) {
    if (!t.diametru_mm) continue;
    const mat = materialNorm(t.material);
    const cheie = `${t.diametru_mm}|${mat}`;
    const g = peDiametru.get(cheie) || { dn: t.diametru_mm, mat, m: 0, n: 0, zone: new Set<string>(), sdr: new Set<string>() };
    g.m += t.lungime_m; g.n += 1;
    const z = String(t.zona || t.de_la || '').trim();
    if (z) g.zone.add(z);
    const sdr = /sdr\s*(\d+)/i.exec(String(t.material || ''))?.[1];
    if (sdr) g.sdr.add(`SDR${sdr}`);
    peDiametru.set(cheie, g);
  }
  if (!peDiametru.size) return { adaugate: 0, actualizate: 0, ambigue: [], pe_diametre: {} };

  const eticheta = nrPlansa ? `Planșa ${nrPlansa}` : `Planșa „${doc.nume_original}”`;
  const { data: existente } = await supa.from('ofertare_cantitati')
    .select('id, denumire, categorie, um, cantitate, status')
    .eq('licitatie_id', doc.licitatie_id);
  // NU se mai filtreaza dupa numele categoriei. Pana la 11.09.2026 aici scria
  // `r.categorie === 'Rețea distribuție'`, iar in aceeasi zi categoriile au fost rescrise
  // dintr-un dictionar determinist: 'Rețea distribuție' a devenit 'Conducte și montaj',
  // deci lista a ramas GOALA si fiecare diametru din plansa s-ar fi adaugat ca rand nou
  // in loc sa completeze cantitate_plansa pe pozitia din memoriu — adica exact verificarea
  // care a gasit cei 7.340 m lipsa la Mostistea. Fara nicio eroare, fara niciun log.
  // Acum candidatii se aleg dupa CE SUNT (conducta in metri, nu tub de protectie), nu dupa
  // cum se cheama categoria in luna asta.
  const eConducta = (r: any) =>
    (r.um == null || /^(m|ml)$/i.test(String(r.um).trim())) &&
    !/tub|protec/i.test(faraDiacritice(r.denumire || ''));
  const retea = (existente || []).filter(eConducta);

  const ambigue: any[] = [];
  const peDiametreRaport: Record<string, number> = {};

  for (const g of [...peDiametru.values()].sort((a, b) => b.dn - a.dn)) {
    const dn = g.dn;
    const m = +g.m.toFixed(1);
    peDiametreRaport[`Dn${dn}${g.mat ? ' ' + g.mat : ''}`] = m;
    let candidati = retea.filter((r: any) =>
      new RegExp(`(?:\\bdn|\\bde|ø|Ø|φ)\\s*${dn}\\b`, 'i').test(faraDiacritice(r.denumire || '')));
    // mai multe poziții pe același diametru => încearcă să departajezi după material, înainte de „ambiguu"
    if (candidati.length > 1 && g.mat) {
      const peMat = candidati.filter((r: any) => materialNorm(r.denumire) === g.mat);
      if (peMat.length) candidati = peMat;
    }
    // Daca acelasi diametru apare pe mai multe pozitii (doua localitati, doua loturi, doua
    // materiale), NU ghicim care e. Pana acum `.find()` lua prima si suprascria tacut — iar
    // o plansa ulterioara putea suprascrie ce pusese cea dinainte. Ambiguitatea se RAPORTEAZA.
    if (candidati.length > 1) {
      ambigue.push({ dn, material: g.mat || null, metri: m, pozitii: candidati.slice(0, 6).map((r: any) => ({ id: r.id, denumire: r.denumire })) });
      continue;
    }
    const potrivit = candidati[0];

    if (potrivit) {
      const dinMemoriu = potrivit.cantitate === null ? null : Number(potrivit.cantitate);
      const nota = dinMemoriu === null
        ? `${eticheta} dă ${m.toLocaleString('ro-RO')} m pe ${g.n} tronsoane.`
        : Math.abs(dinMemoriu - m) < 1
          ? `${eticheta} confirmă: ${m.toLocaleString('ro-RO')} m.`
          : `Memoriu ${dinMemoriu.toLocaleString('ro-RO')} m vs ${eticheta.toLowerCase()} ${m.toLocaleString('ro-RO')} m ` +
            `(${m - dinMemoriu > 0 ? '+' : ''}${(m - dinMemoriu).toLocaleString('ro-RO')} m, pe ${g.n} tronsoane citite din tabel).`;
      const patch: Record<string, unknown> = { cantitate_plansa: m, diferenta_nota: nota + sufixRest(dn), updated_at: new Date().toISOString() };
      // daca cineva a validat deja pozitia, nu-i schimbam decizia — doar ii aratam nota
      if (potrivit.status === 'extras' && dinMemoriu !== null && Math.abs(dinMemoriu - m) >= 1) patch.status = 'diferenta';
      delete patch.updated_at; // îl pune RPC-ul (now())
      ops.push({ op: 'update', id: potrivit.id, patch });
    } else {
      // idempotent: cheia licitatie + Dn/material (denumire) + sursă; se verifică existența imediat înainte de insert
      const denumire = `Conductă distribuție gaze${g.mat ? ' ' + g.mat : ''} Dn${dn}`;
      const sursa = `${eticheta} — tabel de dimensionare, citit automat din scanare`;
      ops.push({ op: 'insert', row: {
        // categoria o pune trigger-ul din dictionar (fn_categorie_cantitate)
        denumire,
        um: 'm', cantitate: m, cantitate_plansa: m,
        status: 'extras', extras_de_ai: true,
        sursa,
        specificatii: [[...g.sdr].join('/'), [...g.zone].slice(0, 12).join(', ') || `${g.n} tronsoane`].filter(Boolean).join(' · '),
        diferenta_nota: `Diametru care nu apare în cantitățile din memoriu. ${g.n} tronsoane citite din tabelul planșei.` + sufixRest(dn),
      } });
    }
  }

  // randul de total, daca exista, primeste si el valoarea din plansa
  const total = +[...peDiametru.values()].reduce((s, g) => s + g.m, 0).toFixed(1);
  const randTotal = retea.find((r: any) => /total/i.test(r.denumire || ''));
  if (randTotal) {
    const dinMemoriu = randTotal.cantitate === null ? null : Number(randTotal.cantitate);
    ops.push({ op: 'update', id: randTotal.id, patch: {
      cantitate_plansa: total,
      diferenta_nota: (dinMemoriu !== null && Math.abs(dinMemoriu - total) >= 1
        ? `Memoriu ${dinMemoriu.toLocaleString('ro-RO')} m vs ${eticheta.toLowerCase()} ${total.toLocaleString('ro-RO')} m.`
        : `${eticheta} confirmă totalul: ${total.toLocaleString('ro-RO')} m.`) + sufixRest(null),
    } });
  }

  const { data: rez, error } = await supa.rpc('ofertare_transfer_plansa_cantitati',
    { p_doc_id: doc.id, p_rulare: rulare, p_randuri: ops });
  if (error) throw new Error(error.message || String(error));
  if (rez?.eroare === 'lease_pierdut') throw new LeasePierdut();
  if (!rez?.ok) throw new Error(`transfer: răspuns neașteptat ${JSON.stringify(rez).slice(0, 120)}`);
  const adaugate = rez.adaugate ?? 0, actualizate = rez.actualizate ?? 0;

  return { adaugate, actualizate, ambigue, total_m: total, pe_diametre: peDiametreRaport };
}


// ---- 25.09.2026 „note tăiate" (lic. 95, PL5 Vâlcelele) ------------------------------
// Un rând lung de text (ex. „Lungimea totală a rețelei de alimentare cu gaze naturale este de ...")
// e mai lat decât o felie + suprapunere, deci fiecare felie îl vede tăiat și cifra se pierde.
// După citirea completă: feliile care raportează text tăiat se recitesc ÎN PERECHE cu vecina din
// dreapta (două imagini într-un singur apel), iar modelul reface doar rândurile care trec peste margine.
const MARCAJ_TAIAT = /(t[aă]iat|trunchiat|partial lizibil|\.\.\.|…)/i;
const MAX_PERECHI = 6;
// Prioritate: rândurile tăiate care par să poarte cifre utile (lungime totală, Dn, cantități) trec primele —
// pe PL5 Vâlcelele primele 6 perechi (de sus) au fost nume de străzi, iar nota cu lungimea era jos.
const UTIL = /lungime|total|cantit|diametr|\bdn\b|\bde\b|\bpe ?100\b|sdr|\d+[.,]?\d*\s*(m|ml|km)\b|l\s*=/i;
function perechiDeLipit(felii: any[], toateNumele: Set<string>, facute = new Set<string>()): [string, string][] {
  const out: { p: [string, string]; scor: number }[] = [];
  const vazute = new Set<string>();
  for (const f of felii) {
    const texte = [...(f.alte_mentiuni || []), ...(f.tabele || []).map((t: any) => t?.denumire)].filter(Boolean).map(String);
    const taiate = texte.filter((t) => MARCAJ_TAIAT.test(t));
    if (!taiate.length) continue;
    const scor = taiate.some((t) => UTIL.test(faraDiacritice(t))) ? 1 : 0;
    const m = /^(.*?)(\d+)_(\d+)$/.exec(String(f.eticheta || ''));
    if (!m) continue;
    const [, pre, r, c] = m;
    const dreapta = `${pre}${r}_${Number(c) + 1}`, stanga = `${pre}${r}_${Number(c) - 1}`;
    const vecin = toateNumele.has(dreapta) ? [f.eticheta, dreapta] : toateNumele.has(stanga) ? [stanga, f.eticheta] : null;
    if (!vecin) continue;
    const k = vecin.join('+');
    if (vazute.has(k) || facute.has(k)) continue;
    vazute.add(k); out.push({ p: vecin as [string, string], scor });
  }
  return out.sort((a, b) => b.scor - a.scor).map((x) => x.p);
}

const INSTRUCTIUNI_LIPIRE = `Primesti DOUA bucati ALATURATE din aceeasi plansa de proiect: prima e in STANGA, a doua imediat in DREAPTA ei (se suprapun ~12% pe margine).
Unele randuri de text (note, cartus, legenda, tabele) sunt taiate de marginea dintre ele. Reconstituie DOAR randurile care continua dintr-o bucata in cealalta, citind textul complet de la stanga la dreapta. Nu repeta textul care e deja intreg intr-o singura bucata.
Raspunde NUMAI cu JSON valid: {"randuri": [{"text": "randul complet", "lungime_m": null, "diametru_mm": null}]}
- lungime_m / diametru_mm: numai daca randul chiar scrie o lungime cu unitate de lungime (m, ml, km) sau un diametru. Daca unitatea e alta (mp, mc, ha) lasa lungime_m null si copiaza textul exact, cu unitatea lui. Fara separator de mii.
- Nu inventa: daca un cuvant tot nu se poate citi, pune [?] in locul lui.`;

async function lipestePereche(apiKey: string, st: Uint8Array, dr: Uint8Array, eticheta: string) {
  const b64 = (u: Uint8Array) => { let b = ''; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(b); };
  const r = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000, thinking: { type: 'disabled' }, system: INSTRUCTIUNI_LIPIRE,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'STANGA:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(st) } },
        { type: 'text', text: 'DREAPTA:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(dr) } },
        { type: 'text', text: `Perechea ${eticheta}. Reconstituie randurile taiate intre ele.` },
      ] }],
    }),
  });
  const j = await r.json();
  const tin = j?.usage?.input_tokens || 0, tout = j?.usage?.output_tokens || 0;
  const txt = (Array.isArray(j?.content) ? j.content : []).filter((c: any) => c?.type === 'text').map((c: any) => c.text || '').join('\n');
  const m = txt.match(/\{[\s\S]*\}/);
  try { return { eticheta, randuri: m ? (JSON.parse(m[0]).randuri || []) : [], _tin: tin, _tout: tout }; }
  catch { return { eticheta, randuri: [], eroare: 'JSON invalid', _tin: tin, _tout: tout }; }
}

// „Lungimea totală a rețelei ... este de 12.345 m" — cifra declarată pe planșă (CONTROL, nu cantitate).
// 25.09.2026 (Copilot, fixture PL5 Vâlcelele): nota spune „54200mp" — mărime de lungime cu unitate de SUPRAFAȚĂ.
// NU se „corectează" în 54.200 m: se raportează ca necorelare și decide omul (memoriu / F3 / clarificare).
// Se acceptă doar unitatea scrisă explicit în text; lungime_m dat de model fără unitate în text e ignorat.
function lungimeDeclarata(note: any[]): { m: number | null; necorelare: string | null; sursa: string | null } {
  for (const n of note) {
    const brut = String(n?.text || '');
    const t = faraDiacritice(brut).toLowerCase();
    if (!/lungime\w*\s+total/.test(t)) continue;
    const supr = /(\d[\d.,]*)\s*(mp|m2|m²|mc|m3|ha)\b/.exec(t);
    if (supr) return { m: null, necorelare: `„${brut.slice(0, 160)}" — lungime exprimată în ${supr[2]} (unitate de suprafață/volum). Nu se convertește automat; verifică memoriul și F3.`, sursa: n.perechea || null };
    const km = /(\d[\d.,]*)\s*km\b/.exec(t);
    if (km) { const v = numar(km[1]); if (v) return { m: v * 1000, necorelare: null, sursa: n.perechea || null }; }
    const m = /(\d[\d.,]*)\s*(m|ml|metri)\b/.exec(t);
    if (m) { const v = numar(m[1]); if (v) return { m: v, necorelare: null, sursa: n.perechea || null }; }
  }
  return { m: null, necorelare: null, sursa: null };
}

// Dependențele externe, injectabile ca handlerul să poată fi testat fără rețea (poarta_test.ts):
// supa = client service_role (DB + storage), getUser(jwt) -> uid|null, fetch = apelul AI.
export const MOTIV_DN_ABSENT = 'diametru absent din tabel — de verificat';
// Agregarea tronsoanelor unice (R5). Cu tabel: DOAR tabelul intră în cantități; toate adnotările rămân
// neconfirmate (cele pe diametre absente din tabel sunt listate separat, cu motiv). Adnotare cu aceeași
// lungime ±1% ca un rând de tabel (orice Dn) => avertisment posibila_dublura (fără deduplicare).
// 25.09.2026 (identitate de rând): `unice` = rândurile de tabel cu identitate SIGURĂ + adnotările unice; `tabelNesigur` =
// rândurile de tabel „de verificat” (fără identitate / conflicte). Ele NU intră în cantități, dar existența lor înseamnă
// „există tabel” => adnotările rămân în afara totalului (R5), chiar dacă niciun rând de tabel n-a ieșit sigur.
export function agregaTronsoane(unice: any[], opt: { tabelNesigur?: any[] } = {}) {
  const dinTabel = unice.filter((t: any) => text(t?.sursa) === 'tabel');
  const nesigure = opt.tabelNesigur || [];
  const existaTabel = dinTabel.length > 0 || nesigure.length > 0;
  const cheieDM = (t: any) => `${t.diametru_mm || 0}|${materialNorm(t.material)}`;
  const acoperitDeTabel = new Set([...dinTabel, ...nesigure].map(cheieDM));
  const adnotari = existaTabel ? unice.filter((t: any) => text(t?.sursa) !== 'tabel') : [];
  const adnotariDiametruAbsent = adnotari.filter((t: any) => t.diametru_mm && !acoperitDeTabel.has(cheieDM(t)))
    .map((t: any) => ({ ...t, doar_adnotare: true, motiv: MOTIV_DN_ABSENT }));
  const pentruCantitati = existaTabel ? [...dinTabel] : [...unice];
  const adnotariNeconfirmate = adnotari;
  const avertismenteDublura: any[] = [];
  for (const a of adnotari) {
    const L = Number(a.lungime_m);
    if (!(L > 0)) continue;
    const idx = dinTabel.findIndex((t: any) => Math.abs(Number(t.lungime_m) - L) <= 0.01 * Math.max(L, Number(t.lungime_m)));
    if (idx < 0) continue;
    const gem = dinTabel[idx];
    avertismenteDublura.push({
      tip: 'posibila_dublura',
      mesaj: `posibila_dublura: adnotarea Dn${a.diametru_mm} ${a.lungime_m} m (${a._zona || '?'}) are aceeași lungime (±1%) ca rândul de tabel #${idx + 1} Dn${gem.diametru_mm} ${gem.lungime_m} m ${gem.de_la ?? '?'}→${gem.la ?? '?'} — posibil același tronson; adnotarea NU e numărată`,
      adnotare: { diametru_mm: a.diametru_mm, lungime_m: a.lungime_m, zona: a._zona ?? null },
      rand_tabel: { index: idx, diametru_mm: gem.diametru_mm, lungime_m: gem.lungime_m, de_la: gem.de_la ?? null, la: gem.la ?? null, zona: gem._zona ?? null },
    });
  }
  return { dinTabel, pentruCantitati, adnotariNeconfirmate, adnotariDiametruAbsent, avertismenteDublura };
}

export type Deps = {
  SERVICE: string; API_KEY: string | undefined;
  supa: any; getUser: (jwt: string) => Promise<string | null>; fetch: typeof fetch;
};
export function depsReale(): Deps {
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return {
    SERVICE, API_KEY: Deno.env.get('ANTHROPIC_API_KEY'), supa: createClient(SUPA_URL, SERVICE), fetch,
    getUser: async (jwt) => {
      const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: u } = await anon.auth.getUser(jwt);
      return u?.user?.id || null;
    },
  };
}
const MESAJ_FARA_DREPT = 'Fără drept pe acest document — citirea planșei costă și o pornește doar ownerul sau responsabilul licitației.';

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const { SERVICE, API_KEY, supa } = deps;
  aiFetch = deps.fetch;
  if (!API_KEY) return json({ error: 'lipseste ANTHROPIC_API_KEY' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer(\s+|$)/i, '').trim();
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  let uidApelant: string | null = null;
  if (!SERVICE || jwt !== SERVICE) { // SERVICE gol/nesetat nu devine niciodată „cheie valabilă”
    uidApelant = await deps.getUser(jwt);
    if (!uidApelant) return json({ error: 'unauthorized' }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const docId = Number(body?.doc_id);
  const deLa = Number(body?.de_la) || 0;
  if (!docId) return json({ error: 'doc_id lipsa' }, 400);

  const { data: doc } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, analiza, eroare').eq('id', docId).maybeSingle();
  // 25.09.2026 (audit țintit, CLAUDE.md 7d): cea mai scumpă citire (Opus pe imagini) — poarta pe cheltuială
  // și pe server: doar ownerul sau responsabilul licitației (poateCheltui, poarta.ts).
  // Poarta vine ÎNAINTE de 404: un user fără drept primește ACELAȘI 403 dacă doc_id există sau nu
  // (nu poate enumera id-urile). Ownerul / apelul intern cu service key primesc 404 pe doc inexistent.
  // Storage și AI rulează strict după poartă.
  if (uidApelant) {
    const [{ data: prof }, { data: lic }] = await Promise.all([
      supa.from('profiles').select('is_owner').eq('id', uidApelant).maybeSingle(),
      doc ? supa.from('ofertare_licitatii').select('responsabil_id').eq('id', doc.licitatie_id).maybeSingle()
          : Promise.resolve({ data: null }),
    ]);
    if (!poateCheltui({ is_owner: prof?.is_owner, responsabil_id: lic?.responsabil_id }, uidApelant))
      return json({ error: MESAJ_FARA_DREPT }, 403);
  }
  if (!doc) return json({ error: 'document inexistent' }, 404);

  const plansa = doc.analiza?.plansa;
  if (!plansa?.cale_felii) return json({ error: 'plansa nu e taiata in felii — ruleaza intai /api/plansa-felii' }, 400);
  if (plansa.citibila === false) return json({ error: 'plansa a fost marcata drept necitibila', motiv: plansa.motiv }, 400);

  const { data: fisiere, error: eList } = await supa.storage.from('ofertare').list(plansa.cale_felii, { limit: 100 });
  if (eList) return json({ error: eList.message }, 500);
  const felii = (fisiere || []).filter((f: any) => f.name.endsWith('.jpg')).sort((a: any, b: any) => a.name.localeCompare(b.name));
  if (!felii.length) return json({ error: 'nicio felie in storage' }, 404);
  // 25.09.2026 (Jakarinos): manifestul zonelor AȘTEPTATE (scris de /api/plansa-felii). O felie care n-a ajuns
  // în storage nu dădea nicio eroare — planșa părea citită complet, cu un total scurt.
  const peStorage = new Set<string>(felii.map((f: any) => f.name.replace('.jpg', '')));
  const zoneLipsa: string[] = (plansa.zone_asteptate || []).map((z: string) => `z${z}`).filter((z: string) => !peStorage.has(z));

  // proveniența rulării (T11): ce versiune de cod/prompt, ce model — calculată ÎNAINTE de orice citire,
  // ca reluarea să poată refuza amestecul de versiuni (R4/C4) fără cost.
  const promptSha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(INSTRUCTIUNI))))
    .slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  // + ce s-a citit (tăiere, grilă, fișier): diferențele aici => 409 chiar și cu mixare_permisa (concurenta.ts)
  const versiuneCur = { functie: 'ofertare-plansa-citeste', cod: COD_VERSIUNE, model: MODEL, prompt_sha: promptSha,
    taiat_la: plansa.taiat_la || null, cale_felii: plansa.cale_felii, geom_sha: await shaGeometrie(plansa),
    fisier: doc.nume_original, fisier_path: doc.fisier_path || null };
  const cheieVers = cheieVersiune(versiuneCur);
  const mixarePermisa = body?.mixare_permisa === true;

  // Pasul „lipește notele tăiate" — apel separat (bugetul de timp al unei rulări), cerut de UI după citire.
  if (body?.doar_lipire === true) {
    const ca = doc.analiza?.citire_ai;
    if (!ca?.gata) return json({ error: 'planșa nu e citită complet' }, 400);
    // R4 (runda 3): perechile se REZERVĂ înainte de AI (cheie „lipire:zA+zB”) — două taburi pe „note tăiate” nu mai
    // plătesc aceleași perechi; dacă toate perechile rămase sunt în lucru în alt tab => 409, zero AI.
    const taiatL = plansa.taiat_la || null, rulareL = crypto.randomUUID();
    const cheiePer = (p: string[]) => `lipire:${p.join('+')}`;
    const rzL = await rezervaChei(supa, docId, doc, rulareL, taiatL, (d: any, altii: Map<string, any>) => {
      const caX = d.analiza?.citire_ai;
      if (!caX?.gata || (caX.taiat_la || null) !== (ca.taiat_la || null))
        return { cand: [], lot: [], stop: { status: 409, error: 'Citirea planșei s-a schimbat între timp (altă tăiere/recitire) — reia „lipește”.' } };
      const facuteX = new Set<string>([...(caX.note_lipite_perechi || []), ...(caX.note_lipite || []).map((n: any) => n.perechea)].filter(Boolean).map(String));
      const toate = perechiDeLipit(caX.felii || [], peStorage, facuteX);
      // un „citește” de la zero în curs (alt tab) va înlocui citirea — notele lipite acum s-ar pierde după plată => 409
      const reset = cheiResetare(altii);
      if (reset.length) return { cand: toate.map(cheiePer), lot: [], blocat: reset, nota: 'o citire „de la zero” e în curs în alt tab (ar înlocui notele)' };
      const libere = toate.filter((p) => !altii.has(cheiePer(p))).slice(0, MAX_PERECHI);
      return { cand: toate.map(cheiePer), lot: libere.map(cheiePer), perechi: libere };
    });
    if (!rzL.ok) return rzL.inLucru
      ? json({ error: rzL.inLucru.mesaj, in_lucru: rzL.inLucru.chei, rezervat_pana_la: rzL.inLucru.pana_la, cost_usd: 0 }, 409)
      : json({ error: rzL.stop?.error || 'rezervare eșuată' }, rzL.stop?.status || 409);
    const perechi: [string, string][] = rzL.plan.perechi || [];
    const rez: any[] = [];
    try {
      for (let i = 0; i < perechi.length; i += PARALEL) {
        rez.push(...await Promise.all(perechi.slice(i, i + PARALEL).map(async ([a, b]) => {
          const [x, y] = await Promise.all([a, b].map((n) => supa.storage.from('ofertare').download(`${plansa.cale_felii}/${n}.jpg`)));
          if (!x.data || !y.data) return { eticheta: `${a}+${b}`, randuri: [], eroare: 'descarcare esuata' };
          return await lipestePereche(API_KEY, new Uint8Array(await x.data.arrayBuffer()), new Uint8Array(await y.data.arrayBuffer()), `${a}+${b}`);
        })));
      }
    } catch (e) {
      if (rzL.rezervat) await elibereazaRezervari(supa, docId, rulareL, taiatL); // altfel expiră singură
      throw e;
    }
    const tinL = rez.reduce((q, r) => q + (r._tin || 0), 0), toutL = rez.reduce((q, r) => q + (r._tout || 0), 0);
    if (rez.length) await supa.from('ai_usage_log').insert({ function_name: 'ofertare-plansa-citeste', model: MODEL, tokens_in: tinL, tokens_out: toutL,
      cost_usd: +(tinL * PRET_IN + toutL * PRET_OUT).toFixed(4), ref_table: 'ofertare_documente_atribuire', ref_id: docId });
    let ld: any = null, note: any[] = [], citireAi2: any = null, decl: number | null = null;
    // R4: scriere compare-and-set — notele se refac peste citirea PROASPĂTĂ dacă între timp a scris altcineva
    const w = await scrieCAS(supa, docId, rzL.doc, (d: any) => {
      const caX = d.analiza?.citire_ai;
      if (!caX?.gata || (caX.taiat_la || null) !== (ca.taiat_la || null))
        return { stop: { status: 409, error: 'Citirea planșei s-a schimbat între timp (altă tăiere/recitire) — notele nu s-au salvat. Reia „lipește”.' } };
      const facuteX = new Set<string>([...(caX.note_lipite_perechi || []), ...(caX.note_lipite || []).map((n: any) => n.perechea)].filter(Boolean).map(String));
      const vazut = new Set<string>();
      note = [...(caX.note_lipite || []), ...rez.flatMap((r: any) => (r.randuri || []).map((n: any) => ({ ...n, perechea: r.eticheta })))
      ].filter((n: any) => { const k = text(n.text); if (!k || vazut.has(k)) return false; vazut.add(k); return true; });
      ld = lungimeDeclarata(note);
      decl = ld.m;
      const toateFacute = new Set([...facuteX, ...rez.map((r: any) => r.eticheta)]);
      citireAi2 = { ...caX, rev: revNou(), note_lipite: note, note_lipite_perechi: [...toateFacute],
        perechi_ramase: Math.max(0, perechiDeLipit(caX.felii || [], peStorage, toateFacute).length), sumar: { ...caX.sumar, note_lipite: note.length, perechi_lipite: rez.length, ...(decl ? { lungime_declarata_m: decl } : {}),
        ...(ld.necorelare ? { necorelare_unitate: ld.necorelare } : {}),
        // proveniența vizuală: ce document, ce pagină, ce zone/imagini au dat cifra
        provenienta: { doc_id: docId, fisier: d.nume_original, pagina: 1, dpi: plansa.dpi || null, cale_felii: plansa.cale_felii, zone: ld.sursa } } };
      const rzCurat = d.analiza?.rezervari_zone ? { rezervari_zone: rezervariNoi(d.analiza.rezervari_zone, taiatL, Date.now(), { scoateRulare: rulareL }) } : {};
      const upd2: Record<string, unknown> = { analiza: { ...d.analiza, citire_ai: citireAi2, ...rzCurat }, analiza_la: new Date().toISOString(),
        text_extras: textPlansa(d.nume_original, citireAi2) };
      // lungimea declarată e o dată utilă => planșa nu mai e „fără rezultat" (nu mai intră în clarificarea automată)
      if (decl && d.eroare === 'citită fără rezultat') upd2.eroare = null;
      return { upd: upd2 };
    });
    if (!w.ok) {
      if (rzL.rezervat) await elibereazaRezervari(supa, docId, rulareL, taiatL);
      return json({ error: w.stop.error, cost_usd: +(tinL * PRET_IN + toutL * PRET_OUT).toFixed(4) }, w.stop.status);
    }
    let clar: unknown = null;
    if ((w.rezultat.upd as any).eroare === null) {
      const { data, error } = await supa.rpc('ofertare_clarificare_planse_auto', { p_licitatie_id: doc.licitatie_id });
      clar = error ? { eroare: error.message } : data;
    }
    return json({ document: doc.nume_original, necorelare_unitate: ld.necorelare, perechi: rez.length, perechi_ramase: citireAi2.perechi_ramase, note, lungime_declarata_m: decl, clarificare: clar,
      cost_usd: +(tinL * PRET_IN + toutL * PRET_OUT).toFixed(4) });
  }

  // 25.09.2026 (audit T4/C3): reluare PE ZONE, fără a retăia și fără a plăti din nou zonele bune.
  //  mod 'continua'   = citește zonele fără rezultat (browser închis la mijloc)
  //  mod 'reia_erori' = citește DOAR zonele căzute (body.sari = zonele deja reîncercate în trecerea asta)
  // Reluarea e permisă numai pe aceeași tăiere (plansa.taiat_la), altfel zonele nu corespund.
  const ca0 = doc.analiza?.citire_ai;
  const mod = body?.mod === 'continua' || body?.mod === 'reia_erori' ? body.mod : null;
  const acelasiTaiat = !!ca0 && (ca0.taiat_la || null) === (plansa.taiat_la || null);
  if (mod && !acelasiTaiat) return json({ error: 'Citirea salvată e pe altă tăiere a planșei — pornește „citește” din nou.' }, 409);
  // R4/C4: o citire nu se continuă cu altă versiune de cod/prompt/model (implicit mixare_permisa=false)
  const resetare = !mod && deLa === 0; // „citește" de la zero: citirea veche se înlocuiește (nu se amestecă)
  if (!resetare) {
    const incomp = versiuneIncompatibila(ca0, versiuneCur, mixarePermisa);
    if (incomp) return json({ error: incomp, versiune_salvata: ca0?.versiune || null, versiune_curenta: versiuneCur }, 409);
  }
  const numeZona = (f: any) => String(f.name || '').replace('.jpg', '');
  const sari = new Set<string>((Array.isArray(body?.sari) ? body.sari : []).map(String));
  const taiatCur = plansa.taiat_la || null;
  const rulareNoua = crypto.randomUUID(); // invocarea curentă: rezervări + lease de transfer
  // R4 (Copilot, runda 3): lotul se calculează pe documentul PROASPĂT și se REZERVĂ (CAS pe analiza.rezervari_zone)
  // ÎNAINTE de apelul AI. Zonele rezervate de altă rulare pe aceeași tăiere nu intră în lot (nu se plătesc de două ori);
  // dacă toate candidatele sunt rezervate => 409 „în lucru în alt tab”, zero AI, zero scrieri. Rezervare expirată => preluare.
  //  mod 'reia_erori' = zonele căzute (fără cele din `sari`) · 'continua' = zonele fără rezultat ·
  //  „citește” pe runde (de_la) = de la poziția de_la încolo; la de_la>0 o zonă citită deja BINE în citirea curentă
  //  (ex. de un tab care a făcut „continuă” între timp) nu se mai plătește.
  const planifica = (d: any, altii: Map<string, any>, incercare: number) => {
    const caD = d.analiza?.citire_ai;
    if (incercare > 0 && !resetare) { // documentul s-a schimbat între timp: aceleași verificări ca la început
      if (!caD || (caD.taiat_la || null) !== taiatCur)
        return { cand: [], lot: [], stop: { status: 409, error: 'Citirea salvată e pe altă tăiere a planșei — pornește „citește” din nou.' } };
      const inc = versiuneIncompatibila(caD, versiuneCur, mixarePermisa);
      if (inc) return { cand: [], lot: [], stop: { status: 409, error: inc } };
    }
    const exist: any[] = resetare ? [] : (caD?.felii || []);
    const rezPe = new Map(exist.map((r: any) => [String(r.eticheta || '').replace('.jpg', ''), r]));
    const cand: string[] = (mod === 'reia_erori'
      ? felii.filter((f: any) => rezPe.get(numeZona(f))?.eroare && !sari.has(numeZona(f)))
      : mod === 'continua'
        ? felii.filter((f: any) => !rezPe.has(numeZona(f)))
        : felii.slice(deLa).filter((f: any) => resetare || !(rezPe.has(numeZona(f)) && !rezPe.get(numeZona(f)).eroare))
    ).map(numeZona);
    // R4 (verificator, runda 1 — defect major): „citește” de la zero NU cooperează. Scrierea lui pleacă de la baza []
    // (înlocuiește citirea), deci la reîncercarea CAS ar arunca rezultatele PLĂTITE ale rulării care ține zonele rezervate
    // (reprodus: 6 zone, două bucle „citește” => 8 apeluri AI sau 4 zone plătite și pierdute). Orice rezervare activă a
    // altei rulări pe tăierea asta (zone sau perechi de note) => 409 „în lucru în alt tab”, zero AI, zero scrieri.
    const ordonate = (chei: string[]) => [...cand.filter((z) => chei.includes(z)), ...chei.filter((z) => !cand.includes(z))];
    if (resetare && altii.size)
      return { cand, lot: [], blocat: ordonate([...altii.keys()]), nota: 'o citire de la zero nu se amestecă cu o citire în curs', exist, altii };
    // Simetric: cât timp un „citește” de la zero al altei rulări e în zbor, nimeni nu scrie în citirea pe care o va
    // înlocui (continuă / reia / runda următoare a altei bucle) — rezultatele lor s-ar pierde după plată.
    const reset = cheiResetare(altii);
    if (!resetare && reset.length)
      return { cand, lot: [], blocat: ordonate(reset), nota: 'o citire „de la zero” e în curs în alt tab (ar înlocui citirea)', exist, altii };
    return { cand, lot: cand.filter((z) => !altii.has(z)).slice(0, FELII_PE_RULARE), exist, altii, resetare };
  };
  const rz = await rezervaChei(supa, docId, doc, rulareNoua, taiatCur, planifica);
  if (!rz.ok) return rz.inLucru
    ? json({ error: rz.inLucru.mesaj, in_lucru: rz.inLucru.chei, rezervat_pana_la: rz.inLucru.pana_la, citite_acum: 0, cost_usd: 0 }, 409)
    : json({ error: rz.stop?.error || 'rezervare eșuată' }, rz.stop?.status || 409);
  const docBaza = rz.doc;                                   // documentul după rezervare = baza scrierii rezultatului
  const existente: any[] = rz.plan.exist;
  const rezervateAlt: Map<string, any> = rz.plan.altii;     // zone lăsate altei rulări (nu se așteaptă după ele)
  const inPlan = new Set<string>(rz.plan.lot);
  const lot = felii.filter((f: any) => inPlan.has(numeZona(f)));
  const deLaUrmator = mod ? deLa + lot.length : (lot.length ? felii.indexOf(lot[lot.length - 1]) + 1 : deLa);
  // 25.09.2026 (Vâlcelele, schema tehnologică): tabelul de dimensionare se întinde pe multe zone, dar antetul e
  // doar în prima — zonele fără antet ghiceau coloanele (debitul citit ca diametru: Dn43/48/56/96/98).
  // Antetele găsite în zonele deja citite se dau mai departe.
  const anteteCunoscute = [...new Set(existente
    .flatMap((r: any) => (r.tabele || []).map((t: any) => `${t.denumire || 'tabel'}: ${(t.coloane || []).join(' | ')}`))
    .filter((x: string) => x.includes('|')))].slice(0, 4).join(' ;; ');
  const paralel = Math.max(1, Math.min(PARALEL_MAX, Math.floor(Number(body?.paralel)) || PARALEL));
  const tRunda = Date.now();
  const rezultate: any[] = [];
  try {
    for (let i = 0; i < lot.length; i += paralel) {
      const grup = lot.slice(i, i + paralel);
      const parti = await Promise.all(grup.map(async (f: any) => {
        const { data: bin, error } = await supa.storage.from('ofertare').download(`${plansa.cale_felii}/${f.name}`);
        if (error || !bin) return { eticheta: numeZona(f), eroare: error?.message || 'descarcare esuata' };
        return await citesteFelie(API_KEY, new Uint8Array(await bin.arrayBuffer()), f.name.replace('.jpg', ''), anteteCunoscute);
      }));
      rezultate.push(...parti);
    }
  } catch (e) {
    if (rz.rezervat) await elibereazaRezervari(supa, docId, rulareNoua, taiatCur); // altfel expiră singură
    throw e;
  }

  const tin = rezultate.reduce((s, r) => s + (r._tin || 0), 0);
  const tout = rezultate.reduce((s, r) => s + (r._tout || 0), 0);
  await supa.from('ai_usage_log').insert({
    function_name: 'ofertare-plansa-citeste', model: MODEL,
    tokens_in: tin, tokens_out: tout,
    cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4),
    ref_table: 'ofertare_documente_atribuire', ref_id: docId,
  });

  // Metrici pe rundă (măsurare, nu presupunere): durata, concurența, reîncercări, coduri HTTP de limitare, cost.
  const metricaRunda = {
    de_la: deLa, zone: lot.length, paralel, durata_ms: Date.now() - tRunda,
    zona_ms: rezultate.map((r: any) => r._ms || null),
    reincercari: rezultate.reduce((q, r) => q + (r._reincercari || 0), 0),
    limitari: rezultate.flatMap((r: any) => r._coduri || []),
    erori: rezultate.filter((r: any) => r.eroare).length,
    cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4), la: new Date().toISOString(),
  };
  // proveniența pe zonă (versiunea) și pe tronson: zona + regiunea în coordonate PDF (R4/T11)
  for (const r of rezultate) {
    r._versiune = cheieVers;
    const reg = regiuneZona(plansa, r.eticheta);
    for (const t of (r.tronsoane || [])) { t._zona = r.eticheta; if (reg) t._regiune = reg; }
  }
  const inLot = new Set(lot.map(numeZona));

  // Tot ce urmează se calculează dintr-o BAZĂ (analiza salvată). La conflict de scriere (alt tab / altă rulare a
  // scris între timp) baza e recitită și rezultatele rundei se fuzionează pe zone peste ea (scrieCAS).
  let ctx: any = null;
  const construieste = (d: any, incercare: number) => {
    const plansaD = d.analiza?.plansa || plansa;
    const caB = d.analiza?.citire_ai;
    if (incercare > 0) {
      if ((plansaD.taiat_la || null) !== (plansa.taiat_la || null))
        return { stop: { status: 409, error: 'Planșa a fost retăiată în timpul citirii — rezultatele rundei nu se amestecă cu noua tăiere. Pornește „citește” din nou.' } };
      if (!resetare && caB) {
        const incomp = versiuneIncompatibila(caB, versiuneCur, mixarePermisa);
        if (incomp) return { stop: { status: 409, error: incomp } };
      }
    }
    // baza: la „citește" de la zero, citirea veche se înlocuiește; altfel se pornește de la ce e salvat ACUM
    const baza: any[] = resetare ? [] : (incercare === 0 ? existente : ((caB?.taiat_la || null) === (plansa.taiat_la || null) ? (caB?.felii || []) : []));
    const rulare = resetare ? rulareNoua : (caB?.rulare || rulareNoua);
    const toate = fuzioneazaZone(baza, rezultate);
    const cuRezultat = new Set(toate.map((r: any) => String(r.eticheta || '').replace('.jpg', '')));
    const gata = felii.every((f: any) => cuRezultat.has(numeZona(f)));
    // zonele rezervate de altă rulare nu țin bucla deschisă: le termină rularea care le-a rezervat
    const maiSunt = mod === 'reia_erori'
      ? felii.some((f: any) => { const n = numeZona(f); return !inLot.has(n) && !sari.has(n) && !rezervateAlt.has(n) && toate.find((r: any) => r.eticheta === n)?.eroare; })
      : felii.some((f: any) => { const n = numeZona(f); return !cuRezultat.has(n) && !rezervateAlt.has(n); });

  // sumar peste tot ce s-a citit pana acum, ca sa se vada imediat ce a iesit.
  // Se numara tronsoanele UNICE: cu suprapunerea dintre felii, acelasi rand apare de
  // doua ori si totalul ar iesi umflat.
  const brute = toate.flatMap((r: any) => r.tronsoane || []);
  // 25.09.2026 (Copilot, runda 3): rândurile de tabel se deduplică pe IDENTITATEA rândului (doc, pagină, tabel, Nr);
  // fără identitate sigură / cu conflict => „de verificat”, în afara cantităților. Adnotările: dedup pe mulțime (R5).
  const idr = identificaRanduri(toate, { doc: docId, plansa: plansaD });
  const unice = [...idr.sigure, ...idr.adnotari];
  const tabelNesigur = [...idr.faraIdentitate, ...idr.conflicte.flatMap((c: any) => c.variante.map((v: any) => ({ ...v, sursa: 'tabel' })))];
  // Acelasi tronson poate fi citit de doua ori: o data din tabelul de dimensionare si o
  // data din adnotarea de pe traseu — aceeasi teava, dar cu alte denumiri de capete
  // ("Nod 2 -> Nod 3" vs "Limita Intravilan -> Limita UAT Ulmeni"), deci deduplicarea pe
  // text nu le poate lega. Tabelul e enumerarea completa si autoritara, deci cand exista
  // tabel se numara doar el; adnotarile raman doar pe plansele fara tabel.
  // Masurat la Manastirea: cu adnotarile adunate ieseau 42.490 m, fara ele exact 37.320 m,
  // adica fix cat declara memoriul.
  // 25.09.2026 (Jakarinos): „există tabel => ignorăm TOATE adnotările" pierdea tronsoanele de pe un
  // diametru/material pe care tabelul nu-l are deloc (tabel parțial, alt obiect pe aceeași planșă).
  // Regula: tabelul rămâne autoritar pe diametrele lui; adnotările pe diametre ABSENTE din tabel se numără
  // și se marchează; restul adnotărilor sunt păstrate ca neconfirmate, vizibile pt control uman.
  // 25.09.2026 (R5, cazul 470): diametrul unei adnotări poate fi citit greșit (1.370 m „Dn250” = rândul 8 Dn200
  // 1.370 m) — adnotările pe diametre ABSENTE din tabel NU mai intră în total; rămân observații „de verificat”.
  const { dinTabel, pentruCantitati, adnotariNeconfirmate, adnotariDiametruAbsent, avertismenteDublura } = agregaTronsoane(unice, { tabelNesigur });
  // Diametre nominale reale (PE SR EN 1555 + OL DN). Orice altceva = citire greșită probabilă (debit, Di, viteză)
  // => NU intră în cantități, se raportează „de verificat".
  const DN_STANDARD = new Set([16,20,25,32,40,50,63,65,75,80,90,100,110,125,140,150,160,180,200,225,250,280,300,315,350,355,400,450,500,560,600,630,700,800]);
  const nestandard = pentruCantitati.filter((t: any) => t.diametru_mm && !DN_STANDARD.has(Number(t.diametru_mm)));
  if (nestandard.length) {
    const deScos = new Set(nestandard);
    pentruCantitati.splice(0, pentruCantitati.length, ...pentruCantitati.filter((t: any) => !deScos.has(t)));
  }
  // Ce NU intră în cantitate_plansa (se menționează în diferenta_nota la transfer, fără să se promoveze): rândurile de tabel
  // fără identitate sigură (pe Dn), conflictele, Dn-urile nestandard.
  const restTransfer = notaRestTransfer(idr, nestandard);
  // 25.09.2026 (audit T5/T6): similaritatea lungimilor e AVERTISMENT, nu deduplicare — nu se scoate nimic din total.
  const avertismente: string[] = avertismenteDublura.map((a: any) => a.mesaj);
  const grupe = new Map<string, number>();
  // rândurile cu Nr diferit sunt dovedit distincte — avertismentul rămâne doar pentru cele identificate prin poziție
  for (const t of dinTabel.filter((x: any) => x._identitate_tip !== 'nr')) { const k = `${t.lungime_m}|${t.diametru_mm}`; grupe.set(k, (grupe.get(k) || 0) + 1); }
  const repetate = [...grupe.entries()].filter(([, n]) => n > 1);
  if (repetate.length) avertismente.push(`${repetate.length} grupuri de rânduri din tabel au aceeași lungime și același Dn (ex. ${repetate.slice(0, 3).map(([k, n]) => `${k.replace('|', ' m Dn')} ×${n}`).join(', ')}) — pot fi tronsoane reale diferite sau rânduri citite de două ori; neverificat`);
  if (idr.faraIdentitate.length || idr.conflicte.length)
    avertismente.push(`${randuri(idr.faraIdentitate.length)} de tabel fără identitate sigură și ${idr.conflicte.length} ` +
      `conflict${idr.conflicte.length === 1 ? '' : 'e'} (același rând citit cu valori diferite): ${idr.total_de_verificat_m} m de verificat — NU intră în cantități`);
  if (!pentruCantitati.some((t: any) => t.material)) avertismente.push('Materialul (PE/OL, SDR) nu apare pe niciun tronson citit — nu se completează din presupuneri');
  const nrPlansa = toate.map((r: any) => r?.cartus?.plansa_nr).find(Boolean) ||
    d.analiza?.cartus?.plansa_nr || null;
  const sumar: Record<string, unknown> = {
    felii_citite: toate.length,
    tronsoane_gasite: pentruCantitati.length,
    tronsoane_brute: brute.length,
    adnotari_lasate_deoparte: adnotariNeconfirmate.length,
    ...(nestandard.length ? { diametre_nestandard: [...new Set(nestandard.map((t: any) => Number(t.diametru_mm)))].sort((a, b) => a - b),
      nestandard_m: +nestandard.reduce((q: number, t: any) => q + (Number(t.lungime_m) || 0), 0).toFixed(1) } : {}),
    ...(avertismenteDublura.length ? { posibile_dubluri: avertismenteDublura } : {}),
    adnotari_numarate_in_plus: 0, // R5: nicio adnotare nu mai intră în total când există tabel
    adnotari_diametru_absent: adnotariDiametruAbsent.map((t: any) => ({ diametru_mm: t.diametru_mm, material: t.material ?? null,
      lungime_m: t.lungime_m, de_la: t.de_la ?? null, la: t.la ?? null, zona: t._zona ?? null, motiv: MOTIV_DN_ABSENT })),
    adnotari_neconfirmate_m: +adnotariNeconfirmate.reduce((s: number, t: any) => s + (Number(t.lungime_m) || 0), 0).toFixed(1),
    lungime_totala_m: +pentruCantitati.reduce((s: number, t: any) => s + t.lungime_m, 0).toFixed(1),
    // identitatea rândurilor de tabel (Copilot runda 3): totalul sigur = rânduri cu identitate sigură, fără conflict (înainte
    // de filtrul de Dn nestandard); „de verificat” = fără identitate + conflicte; niciunul din ele nu intră în cantități
    total_sigur_m: idr.total_sigur_m,
    total_de_verificat_m: idr.total_de_verificat_m,
    conflicte: idr.conflicte.slice(0, 60),
    randuri_fara_identitate: idr.faraIdentitate.slice(0, 200).map((t: any) => ({ zona: t._zona ?? null, de_la: t.de_la ?? null, la: t.la ?? null,
      lungime_m: t.lungime_m, diametru_mm: t.diametru_mm ?? null, debit_mch: numar(t.debit_mch), motiv: t._motiv })),
    randuri_fara_identitate_n: idr.faraIdentitate.length,
    identitate_randuri: { lecturi_tabel: idr.observatii_tabel, randuri_sigure: idr.sigure.length, prin_nr: idr.prin.nr, prin_pozitie: idr.prin.pozitie,
      fara_identitate: idr.faraIdentitate.length, conflicte: idr.conflicte.length },
    tabele: [...new Set(toate.flatMap((r: any) => (r.tabele || []).map((t: any) => t.denumire)).filter(Boolean))],
    subtraversari: toate.flatMap((r: any) => r.subtraversari || []).length,
    bransamente: toate.flatMap((r: any) => r.bransamente || []).length,
    erori: toate.filter((r: any) => r.eroare).length,
    zone_cazute: toate.filter((r: any) => r.eroare).map((r: any) => r.eticheta),
    avertismente,
    validat: false, // totalurile din citirea pe zone rămân NEVALIDATE până la reconcilierea cu memoriul/F3
    ...(zoneLipsa.length ? { zone_lipsa: zoneLipsa } : {}),
    ...(plansaD.rezolutie_redusa ? { rezolutie_redusa: plansaD.rezolutie_redusa } : {}),
  };

  // Cand s-a citit toata plansa, cifrele trec singure in cantitati. Daca pasul asta
  // crapa, citirea (partea scumpa) tot se salveaza — eroarea se raporteaza, nu se arunca.
  //
  // DAR numai daca TOATE feliile au fost citite. Pana la 11.09.2026 conditia era doar `gata`:
  // o felie esuata nu aduce niciun tronson, deci totalul iesea scurt — si era comparat cu
  // memoriul ca si cum ar fi complet, producand o diferenta FALSA care arata exact ca una
  // reala. Mai bine nu transferam si spunem de ce, decat sa dam o cifra in care nu se poate
  // avea incredere. Feliile esuate se pot relua, citirea deja platita nu se pierde.
  // R4: transferul se face DUPĂ scrierea reușită (CAS), o singură dată pe rulare: dacă baza are deja transferul
  // (sau „în curs") pe aceeași rulare, a doua rulare concurentă nu-l mai repetă (fără poziții duble).
  let cantitati: unknown = null;
  let deTransferat = false;
  const cantBaza = caB?.rulare === rulare ? caB?.sumar?.cantitati : null;
  if (gata && zoneLipsa.length) {
    cantitati = { amanat: `${zoneLipsa.length} zone din planșă lipsesc din storage (${zoneLipsa.slice(0, 6).join(', ')}) — ` +
      `cifrele NU s-au trecut in cantitati. Retaie planșa („recitește") și citește din nou.` };
    sumar.cantitati = cantitati;
  } else if (gata && sumar.erori) {
    cantitati = { amanat: `${sumar.erori} feli${sumar.erori === 1 ? 'e' : 'i'} n-au putut fi citite — ` +
      `cifrele NU s-au trecut in cantitati, fiindca totalul ar fi incomplet si ar arata ca o diferenta reala. ` +
      `Apasă „🔁 reia zonele căzute” (se citesc doar zonele căzute) și transferul se face singur.` };
    sumar.cantitati = cantitati;
  } else if (gata && cantBaza && !transferDeReluat(cantBaza)) {
    cantitati = cantBaza; sumar.cantitati = cantBaza; // făcut (sau în curs <5 min) de rularea concurentă
    // R4 risc 1: {eroare} sau in_curs mai vechi de 5 min (worker omorât) => se reia (treciInCantitati e idempotent pe potrivire)
  } else if (gata) {
    deTransferat = true;
    cantitati = { in_curs: true, la: new Date().toISOString() };
    sumar.cantitati = cantitati;
  }

  // 25.09.2026 (bug Răzvan, lic. 95): citirea se salva doar în `analiza`, iar documentul rămânea
  // „neprocesat" fără text — Rezumatul îl număra la „rămase de citit" și UI-ul oferea recitire plătită.
  // La final: procesat + text_extras (randare text a citirii, pt cerințe/clarificări/căutare);
  // dacă TOATE feliile au căzut: eroare. Pe runde intermediare statusul nu se atinge.
  const metrici = [...(baza.length ? (caB?.metrici || []) : []), { ...metricaRunda, mod: mod || 'complet', ...(incercare ? { cas_reincercari: incercare } : {}) }];
  if (gata) sumar.metrici = {
    runde: metrici.length, paralel: [...new Set(metrici.map((m: any) => m.paralel))],
    durata_s: Math.round(metrici.reduce((q: number, m: any) => q + m.durata_ms, 0) / 1000),
    reincercari: metrici.reduce((q: number, m: any) => q + m.reincercari, 0),
    limitari: metrici.flatMap((m: any) => m.limitari).length,
    cost_usd: +metrici.reduce((q: number, m: any) => q + m.cost_usd, 0).toFixed(3),
  };
  const versiuniZone = [...new Set(toate.map((r: any) => r._versiune || 'necunoscuta'))];
  if (versiuniZone.length > 1) sumar.versiuni_mixte = versiuniZone; // doar cu mixare_permisa=true
  const versiune = { ...versiuneCur, pagina: 1, dpi: plansaD.dpi || null };
  const citireAi: any = { felii: toate, sumar, tronsoane_unice: unice, metrici, model: MODEL, versiune, taiat_la: plansaD.taiat_la || null,
    gata, actualizat: new Date().toISOString(), rev: revNou(), rulare,
    ...(caB?.transfer ? { transfer: caB.transfer } : {}), // lease-ul de transfer al altei rulări nu se șterge
    ...(caB?.rulare === rulare && caB?.note_lipite ? { note_lipite: caB.note_lipite, note_lipite_perechi: caB.note_lipite_perechi } : {}) };
  // rezervările: ale rulării curente se eliberează odată cu scrierea rezultatului; ale altora (active) rămân
  const rzCurat = d.analiza?.rezervari_zone ? { rezervari_zone: rezervariNoi(d.analiza.rezervari_zone, taiatCur, Date.now(), { scoateRulare: rulareNoua }) } : {};
  const upd: Record<string, unknown> = { analiza: { ...d.analiza, citire_ai: citireAi, ...rzCurat }, analiza_la: new Date().toISOString() };
  // 25.09.2026 (audit țintit): PL1–PL4 Vâlcelele au fost „citite" pe sigla semnăturii (900x450) și au ieșit
  // procesat fără eroare — butoanele le socoteau citite. O sursă sub 2000px pe latura mare nu e o planșă:
  // rezultatul NU poate fi „procesat".
  const prea_mica = !plansaD.vectorial && Math.max(Number(plansaD.latime) || 0, Number(plansaD.inaltime) || 0) > 0 &&
    Math.max(Number(plansaD.latime) || 0, Number(plansaD.inaltime) || 0) < 2000;
  if (gata && prea_mica) {
    upd.status_procesare = 'eroare';
    upd.eroare = `Nu s-a citit desenul: sursa are doar ${plansaD.latime}x${plansaD.inaltime}px (sub pragul de rezoluție; siglă nedovedită). Retaie planșa („citește") — PDF-ul vectorial se randează acum.`;
  } else if (gata) {
    if (toate.length && (sumar.erori as number) >= toate.length) {
      upd.status_procesare = 'eroare';
      upd.eroare = `Citire planșă eșuată pe toate cele ${toate.length} zone: ` + String(toate.find((r: any) => r.eroare)?.eroare || '').slice(0, 200);
    } else {
      // 25.09.2026 (audit T3): zone căzute => 'partial', nu 'procesat' (stare onestă; se reiau doar ele)
      upd.status_procesare = (sumar.erori as number) || zoneLipsa.length ? 'partial' : 'procesat';
      upd.text_extras = textPlansa(d.nume_original, citireAi);
      // 25.09.2026: citită dar nimic extras (0 tronsoane, 0 tabele, 0 m) — rămâne procesat, dar marcat
      // ca să fie interogabil și UI-ul să ofere „recitește fin".
      const gol = !(sumar.tronsoane_gasite as number) && !(sumar.tabele as unknown[]).length && !(sumar.lungime_totala_m as number) &&
        !(sumar.randuri_fara_identitate_n as number) && !(sumar.conflicte as unknown[]).length
      upd.eroare = zoneLipsa.length ? `${zoneLipsa.length} zone lipsă (retaie planșa)` : sumar.erori ? `${sumar.erori} zone căzute — „🔁 reia zonele căzute”` : gol ? 'citită fără rezultat' : null;
      upd.procesat_la = new Date().toISOString();
    }
  }
  // R3 (25.09.2026): rezultatul citirii ca stare distinctă — analiza.plansa.rezultat (+ citire_ai.rezultat).
  // sursa_gresita_sigla DOAR cu dovadă (plansa.sursa_sigla_dovedita, scrisă de /api/plansa-felii); pragul
  // de 2000px rămâne avertisment. citita_fara_date_cantitative DOAR pe lectură completă (toate zonele).
  if (gata) {
    const r = rezultatCitire({ plansa: plansaD, toate, sumar, zoneLipsa, prea_mica });
    citireAi.rezultat = r.rezultat;
    upd.analiza = { ...d.analiza, citire_ai: citireAi, ...rzCurat,
      plansa: { ...plansaD, rezultat: r.rezultat, rezultat_motiv: r.motiv, rezultat_la: new Date().toISOString(), rezultat_sursa: 'extractor', rezultat_cod: COD_VERSIUNE } };
    // `eroare` păstrează formatele vechi, doar „citită fără rezultat” se desparte în cele două formulări
    if (upd.eroare === 'citită fără rezultat') upd.eroare = r.rezultat === 'ilizibil' ? 'ilizibilă' : r.rezultat === 'citita_fara_date_cantitative' ? 'citită fără date cantitative' : 'de verificat: ' + r.motiv.replace(/^de verificat: /, '');
    // fără succes fals: un rezultat partial nu rămâne „procesat”
    if (r.rezultat === 'partial' && upd.status_procesare === 'procesat') {
      upd.status_procesare = 'partial';
      if (!upd.eroare) upd.eroare = r.motiv.slice(0, 200);
    }
  }
  ctx = { toate, gata, maiSunt, sumar, cantitati, deTransferat, pentruCantitati, nrPlansa, rulare, citireAi, restTransfer };
  return { upd };
  };

  const w = await scrieCAS(supa, docId, docBaza, construieste);
  if (!w.ok) {
    if (rz.rezervat) await elibereazaRezervari(supa, docId, rulareNoua, taiatCur); // altfel expiră singură
    return json({ error: w.stop.error, citite_acum: lot.length, cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4) }, w.stop.status);
  }
  const { toate, gata, maiSunt, sumar, upd } = { ...ctx, upd: w.rezultat.upd };
  let { cantitati } = ctx;

  // Transferul în cantități — după scrierea câștigătoare, SERIALIZAT (R4/Copilot pct. 4): întâi lease prin CAS pe
  // citire_ai.transfer = {stare:'in_curs', de_la, rulare}; doar deținătorul transferă, ceilalți sar și raportează.
  // `rulare` aici = invocarea curentă (rulareNoua), nu citire_ai.rulare (comună rundelor aceleiași citiri).
  if (ctx.deTransferat) {
    const deLaLease = new Date().toISOString();
    let lease = await scrieCAS(supa, docId, { ...w.doc, analiza: upd.analiza }, (d: any) => {
      const caX = d.analiza?.citire_ai;
      if (!caX?.gata) return { stop: { status: 409, error: 'citirea nu mai e completă' } };
      const ocupat = leaseTransferOcupat(caX.transfer, rulareNoua, tRunda);
      if (ocupat) return { stop: { status: 200, sarit: ocupat } };
      return { upd: { analiza: { ...d.analiza, citire_ai: { ...caX, rev: revNou(), transfer: { stare: 'in_curs', de_la: deLaLease, rulare: rulareNoua } } } } };
    });
    if (lease.ok) {
      try {
        // deținerea lease-ului (rulare + stare in_curs) se verifică ÎN tranzacția RPC-ului, sub FOR UPDATE pe doc
        cantitati = await treciInCantitati(supa, { ...w.doc, id: docId }, ctx.pentruCantitati, ctx.nrPlansa, rulareNoua, ctx.restTransfer);
      } catch (e) {
        cantitati = e instanceof LeasePierdut
          ? { sarit: 'lease pierdut (expirat, preluat de altă rulare) — nu s-a mai scris', lease_pierdut: true }
          : { eroare: String((e as Error)?.message || e).slice(0, 200) };
      }
      sumar.cantitati = cantitati;
      if ((cantitati as any)?.lease_pierdut) { /* nu eliberăm: lease-ul e al altei rulări */ } else {
      const eroare = !!(cantitati as any)?.eroare;
      // eliberare: rezultatul + starea lease-ului (facut / eroare => poate fi reluat), doar dacă încă îl deținem
      await scrieCAS(supa, docId, lease.doc ? { ...lease.doc, analiza: lease.rezultat.upd.analiza } : w.doc, (d: any) => {
        const caX = d.analiza?.citire_ai;
        if (caX?.transfer?.rulare !== rulareNoua || caX?.transfer?.de_la !== deLaLease) return { stop: { status: 409, error: 'lease pierdut' } };
        return { upd: { analiza: { ...d.analiza, citire_ai: { ...caX, rev: revNou(), sumar: { ...caX.sumar, cantitati },
          transfer: { ...caX.transfer, stare: eroare ? 'eroare' : 'facut', la: new Date().toISOString() } } } } };
      });
      }
    } else {
      // alt deținător (sau conflict persistent): NU se transferă; se raportează
      cantitati = { sarit: lease.stop?.sarit || lease.stop?.error || 'lease indisponibil', transfer_in_curs_alta_rulare: !!lease.stop?.sarit };
      sumar.cantitati = cantitati;
    }
  }

  // 25.09.2026: planșă citită dar inutilizabilă (nimic extras / toate zonele căzute) => ciornă AUTOMATĂ de
  // clarificare (idempotentă, o ciornă per licitație pe lot; NU se trimite nimic). Rulează aici, server-side,
  // indiferent cine a apăsat butonul. Eșecul ei nu strică citirea.
  let clarificare: unknown = null;
  if (gata && (upd.status_procesare === 'eroare' || upd.eroare === 'ilizibilă' || upd.eroare === 'citită fără date cantitative')) {
    try {
      const { data, error } = await supa.rpc('ofertare_clarificare_planse_auto', { p_licitatie_id: doc.licitatie_id });
      clarificare = error ? { eroare: error.message } : data;
    } catch (e) { clarificare = { eroare: String((e as Error)?.message || e).slice(0, 120) }; }
  }

  return json({
    document: doc.nume_original, citite_acum: lot.length, din: felii.length, sumar, cantitati,
    cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4),
    clarificare, continua: maiSunt && lot.length > 0, de_la_urmator: gata ? null : deLaUrmator,
    ...(rezervateAlt.size ? { in_lucru_alt_tab: [...rezervateAlt.keys()].filter((k) => !k.startsWith('lipire:')) } : {}),
    reincercate: mod === 'reia_erori' ? [...sari, ...inLot] : undefined, zone_cazute: sumar.zone_cazute,
    lipire_necesara: gata ? perechiDeLipit(toate, peStorage).slice(0, MAX_PERECHI).length : 0,
    ...(w.incercari > 1 ? { scriere_concurenta: { incercari: w.incercari } } : {}),
  });
}
