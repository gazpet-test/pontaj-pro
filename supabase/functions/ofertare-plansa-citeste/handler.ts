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
const COD_VERSIUNE = '2026-09-26.11'; // se schimbă la fiecare modificare a citirii/agregării (proveniență T11)          // doar pe limitări/suprasarcină furnizor (429, 529, 5xx), cu așteptare

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
// Runda 7: exportată (testele raportului); rândul reconciliat arată Nr și feliile din care vine (COPILOT-REG-2); golurile din
// secvența Nr și comasările neconfirmate apar ca linii ⚠ (B3, B4).
export function textPlansa(nume: string, c: any): string {
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
      `${t.diametru_mm ? `, Dn ${t.diametru_mm} mm` : ''}${t.material ? `, ${t.material}` : ''}${t.zona ? `, ${t.zona}` : ''}${t.sursa ? ` [${t.sursa}]` : ''}` +
      `${t._nr ? ` (Nr ${t._nr}` : ''}${(t._observatii || []).length > 1 ? `${t._nr ? '; ' : ' ('}văzut în ${t._observatii.join(', ')})` : t._nr ? ')' : ''}`);
  }
  if (s.randuri_fara_identitate_n || (s.conflicte || []).length) {
    L.push('', `DE VERIFICAT (rânduri de tabel NEincluse în cantități): ${s.total_de_verificat_m ?? 0} m`);
    for (const t of (s.randuri_fara_identitate || [])) L.push(`- ${t.de_la ?? '?'} -> ${t.la ?? '?'}: ${t.lungime_m} m${t.diametru_mm ? `, Dn ${t.diametru_mm} mm` : ''}${t.zona ? ` [${t.zona}]` : ''} — ${t.motiv}`);
    for (const k of (s.conflicte || [])) L.push(`- CONFLICT ${k.nr ? `Nr ${k.nr}` : k.identitate}: ${k.variante.map((v: any) => `${v.lungime_m} m${v.diametru_mm ? ` Dn${v.diametru_mm}` : ''} (${v.zone.join(', ')})`).join(' vs ')}`);
  }
  for (const x of (s.nr_lipsa || [])) L.push(`⚠ ${textNrLipsa(x).replace(/^secvență Nr incompletă/, 'SECVENȚĂ Nr INCOMPLETĂ')} — totalul sigur e incomplet`);
  for (const x of (s.comasari_neconfirmate || [])) L.push(`⚠ COMASARE NECONFIRMATĂ: Nr ${x.nr} din ${x.a} și ${x.b} (benzi diferite) numărate o dată — posibil două tabele identice`);
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
// 26.09.2026 (verificator runda 3 → runda 4). Principiul (Copilot): niciodată pierdere sau umflare TĂCUTĂ — ce nu e sigur
// merge la „de verificat”, cu total separat și motiv:
// - poziția e identitate DOAR dacă niciun fragment din tabel (grupul de fragmente împerecheate sigur) nu are coloană Nr;
//   rândul fără Nr dintr-un fragment împerecheat cu unul care are Nr => „rând în afara fragmentului cu Nr” (BLOCANT: rândul
//   de margine transcris doar în felia cu lungimi se număra o dată prin poziție și încă o dată prin Nr în banda vecină);
// - același (tabel, Nr) pe noduri din aceeași felie în componente diferite, sau în benzi/coloane nevecine => „Nr repetat”;
// - aceeași identitate din componente diferite cu text contrazis pe o coloană comună (Strada / De la) => nu se contopește;
// - cheia de poziție conține indexul tabelului din felie; tabel fără Nr repetat identic în aceeași felie => de verificat;
// - număr diferit de rânduri între fragmentele împerecheate: `perechi[].neimperecheate`; Nr fără nicio lungime => `nrFaraLungime`.
// 26.09.2026 (verificator runda 4 → runda 5):
// - poziția e interzisă și în COLOANA de felii a unui tabel cu Nr (fragment dintr-un grup cu Nr, ±1 coloană, orice bandă),
//   chiar dacă perechea din banda rândului n-a reușit (felia cu Nr netranscrisă / căzută / cu antete transcrise altfel) —
//   altfel rândurile din suprapunerea verticală se numărau o dată prin poziție și o dată prin Nr în banda vecină (V1–V4);
// - `perechi[].neimperecheate` > 0 ajunge în sumar (`perechi_neimperecheate`) + avertisment.
// 26.09.2026 (verificator runda 5 → runda 6): vecinătatea feliilor se decide pe GEOMETRIA REALĂ (plansa.zone_geom), nu pe
// indicii din etichetă. Tăietorul (/api/plansa-felii) fixează ultima coloană/bandă la marginea planșei (left = min(c·pas,
// W − latura)), deci felia `_N+1` poate acoperi și `_N-1` (|Δc| = 2) — regula pe etichetă ±1 nu o vedea și fâșia de lungimi
// din felia fixată se număra a doua oară prin poziție. Două felii sunt vecine/suprapuse dacă dreptunghiurile lor (aceeași
// sursă/pagină) se intersectează sau se ating (toleranță TOL_GEOM_PX). Pe relația asta se aplică: împerecherea fragmentelor
// (aceeași bandă, oricât de departe în etichetă), „Nr repetat” (felii care nu se ating => de verificat) și poziția interzisă
// în coloana unui tabel cu Nr (intervalul x al feliei atinge intervalul x al unui fragment dintr-un grup cu Nr, orice bandă).
// Fără geometrie: împerecherea și „Nr repetat” rămân pe etichetă (vecinele ±1 se suprapun mereu; |Δ| ≥ 2 => de verificat),
// iar poziția e interzisă pe toată pagina unui tabel cu Nr (suprapunerea nu se poate exclude). Runda 7: și pentru tabelele
// FĂRĂ Nr (B1, mai jos) — fallback-ul fără geometrie nu mai poate umfla totalul pe nicio cale cunoscută.
// 26.09.2026 (runda 7, Copilot + verificatorii rundei 6): cele 4 căi TĂCUTE rămase devin VIZIBILE:
// - B1: fără geometrie, două grupuri de poziție (tabele fără Nr) pe aceeași bandă la |Δc| ≥ 2 — coloana fixată `_N+1` poate
//   acoperi `_N-1` => grupul din dreapta la „de verificat” (MOTIV_FARA_GEOM_COLOANA_FIXATA); cel din stânga rămâne o dată;
// - B2: transcriere dublă PARȚIALĂ a unui tabel fără Nr în aceeași felie (secvența L/Dn/Q e o sub-secvență — prefix, bucată
//   contiguă sau cu rânduri omise — a altui tabel cu aceleași antete) => surplusul (tabelul conținut) la „de verificat” (MOTIV_DUBLA_PARTIALA);
// - B3: golurile din secvența Nr a unui tabel identificat => `nrLipsa` + avertisment „secvență Nr incompletă” + nota
//   transferului; totalul sigur rămâne cel derivat (fără metri inventați), marcat incomplet;
// - B4: rândurile comasate între două felii din benzi diferite trebuie să încapă în fâșia de suprapunere (zone_geom, rând
//   ≥ H_MIN_RAND_MM); peste capacitate => „de verificat” (MOTIV_PESTE_CAPACITATE). Sub capacitate, două tabele identice nu se pot
//   deosebi de suprapunere (fără coordonate pe rând): când fragmentele din ambele felii sunt comasate ÎN ÎNTREGIME => avertisment.
export const TOL_GEOM_PX = 2;
// B4: înălțimea minimă a unui rând de tabel, în mm pe planșă. Justificare (date reale, 470, 200 dpi): 52 de rânduri într-o bandă
// de 1.600 px și 6–7 rânduri în fâșia de 192 px dintre benzi => rândul are 24–27,4 px ≈ 3,0–3,5 mm; textul de 1,5 mm (pragul de
// lizibilitate din api/plansa-felii.js) cere cel puțin ~2 mm pe rând. Fără scară (scanare fără dpi / puncte PDF): 12 px (2 mm
// la 150 dpi). Capacitatea fâșiei = ⌊h / h_min⌋ + 2 (un rând tăiat de fiecare margine poate fi transcris în ambele felii).
export const H_MIN_RAND_MM = 2;
export const H_MIN_RAND_PX_FARA_SCARA = 12;
function hMinRandPx(plansa: any, s: number): number {
  const sg = Array.isArray(plansa?.surse_geom) ? plansa.surse_geom[s] : null;
  const dpi = Number(sg?.dpi), L = Number(sg?.latime), Lpt = Number(sg?.latime_pt);
  const pxMm = dpi > 0 ? dpi / 25.4 : L > 0 && Lpt > 0 ? L / (Lpt / 72 * 25.4) : 0;
  return pxMm > 0 ? H_MIN_RAND_MM * pxMm : H_MIN_RAND_PX_FARA_SCARA;
}
export const capacitateFasie = (hPx: number, hMin: number) => Math.floor(Math.max(0, hPx) / hMin) + 2;
// „1–3, 7, 9–12” din Nr întregi sortate
export function intervaleNr(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b), p: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    p.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j;
  }
  return p.join(', ');
}
type Geo = { x0: number; y0: number; x1: number; y1: number; s: number };
function geomZona(plansa: any, et: string): Geo | null {
  const g = plansa?.zone_geom?.[String(et || '').replace(/\.jpg$/, '').replace(/^z/, '')];
  if (!Array.isArray(g) || g.length < 4) return null;
  const [l, t, w, h] = g.slice(0, 4).map(Number), s = Number(g[4] ?? 0);
  if (![l, t, w, h, s].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x0: l, y0: t, x1: l + w, y1: t + h, s };
}
const atingX = (a: Geo, b: Geo) => a.s === b.s && a.x0 <= b.x1 + TOL_GEOM_PX && b.x0 <= a.x1 + TOL_GEOM_PX;
const atingXY = (a: Geo, b: Geo) => atingX(a, b) && a.y0 <= b.y1 + TOL_GEOM_PX && b.y0 <= a.y1 + TOL_GEOM_PX;
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
type Fragment = { i: number; felie: number; et: string; t: number; pre: string; r: number; c: number; pag: number; sig: string;
  hdr: string[]; colNr: string | null; randuri: Record<string, string>[]; brut: any[]; g: Geo | null };
// Runda 6: A (stânga) și B (dreapta) se pot împerechea dacă sunt în felii diferite din aceeași bandă și se ating pe orizontală.
// Cu geometrie: aceeași sursă, același [top, top+height], intervalele x se intersectează/ating (inclusiv coloana fixată la
// margine care acoperă `_N-1`, sau două felii identice — ordinea: x, apoi eticheta). Fără geometrie: eticheta (r, c) și (r, c+1).
function perechePosibila(A: Fragment, B: Fragment): boolean {
  if (A.felie === B.felie || A.pag !== B.pag) return false;
  if (A.g && B.g) {
    if (A.g.s !== B.g.s || A.g.y0 !== B.g.y0 || A.g.y1 !== B.g.y1 || !atingX(A.g, B.g)) return false;
    return A.g.x0 < B.g.x0 || (A.g.x0 === B.g.x0 && (A.c < B.c || (!(B.c < A.c) && A.felie < B.felie)));
  }
  return A.pre === B.pre && A.r === B.r && B.c === A.c + 1;
}
// Runda 6: felii care se suprapun fizic (pentru „Nr repetat”). Cu geometrie: dreptunghiurile se intersectează/ating; fără:
// eticheta ±1 pe ambele axe (grila standard: vecinele se suprapun mereu; grilă necunoscută => nu).
function seSuprapun(A: Fragment, B: Fragment): boolean {
  if (A.g && B.g) return atingXY(A.g, B.g);
  return A.pre === B.pre && Math.abs(A.r - B.r) <= 1 && Math.abs(A.c - B.c) <= 1;
}
// Runda 4 (verificator, MAJOR (3)): două lecturi ale aceluiași Nr din componente diferite (ex. suprapunerea verticală a
// benzilor) care diferă pe o coloană de TEXT comună (Strada / De la) nu se contopesc — pot fi două rânduri reale.
// Comparația e laxă (fără spații/punctuație, prefix admis la margine sau „...”), ca diferențele de transcriere să nu conteze.
const compact = (v: unknown) => text(v).replace(E_TRUNCHIAT, '').replace(/[^a-z0-9]/g, '');
function textContrazis(a: unknown, b: unknown, aLaMargine: boolean, bLaMargine: boolean): boolean {
  const x = text(a), y = text(b);
  if (!/[a-z]/.test(x) || !/[a-z]/.test(y)) return false;          // doar celule de text (numerele au regulile lor: L/Dn/Q)
  if (comparaCelule(a, b, aLaMargine, bLaMargine) !== 'X') return false;
  const cx = compact(a), cy = compact(b);
  if (cx === cy) return false;
  if ((aLaMargine || E_TRUNCHIAT.test(x)) && cx.length >= 3 && cy.startsWith(cx)) return false;
  if ((bLaMargine || E_TRUNCHIAT.test(y)) && cy.length >= 3 && cx.startsWith(cy)) return false;
  return true;
}
export const MOTIV_AFARA_NR = 'rând în afara fragmentului cu Nr — tabelul are coloană Nr în felia vecină, dar rândul nu se împerechează cu niciun rând numerotat (margine de felie?)';
export const MOTIV_COLOANA_NR = 'rând fără Nr în coloana de felii a unui tabel cu coloană Nr (aceeași coloană sau cea vecină, orice bandă) — nu s-a legat de niciun Nr (felia cu Nr netranscrisă / căzută sau antete transcrise altfel); poziția nu e identitate sigură';
export const MOTIV_COLOANA_NR_FARA_GEOM = 'rând fără Nr pe o pagină cu tabel cu coloană Nr, fără geometria zonelor (tăiere veche) — suprapunerea feliilor nu se poate exclude, poziția nu e identitate sigură (retaie planșa)';
export const MOTIV_FARA_GEOM_COLOANA_FIXATA = 'tabel fără coloană Nr pe aceeași bandă cu alt tabel fără Nr aflat la ≥ 2 coloane de felii în stânga, fără geometria zonelor (tăiere veche) — coloana fixată la marginea planșei poate acoperi coloana c−2, deci rândurile pot fi a doua lectură a aceluiași tabel; poziția nu e identitate sigură (retaie planșa)';
export const MOTIV_DUBLA_PARTIALA = 'tabel fără coloană Nr transcris a doua oară PARȚIAL în aceeași felie (secvența L/Dn/Q e o parte, în ordine, a altui tabel cu aceleași antete) — posibilă transcriere dublă, surplusul nu se comasează și nu se adună automat';
export const MOTIV_PESTE_CAPACITATE = 'comasare peste capacitatea fâșiei de suprapunere';
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
    for (const [tIdx, tb] of (Array.isArray(f.tabele) ? f.tabele : []).entries()) {
      const randuriBrute = Array.isArray(tb?.randuri) ? tb.randuri.filter((r: any) => r && typeof r === 'object') : [];
      if (!randuriBrute.length) continue;
      const hdr: string[] = [];
      for (const h of [...(Array.isArray(tb.coloane) ? tb.coloane : []), ...randuriBrute.flatMap((r: any) => Object.keys(r))]) {
        const a = antet(h); if (a && !hdr.includes(a)) hdr.push(a);
      }
      const randuri = randuriBrute.map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [antet(k), String(v ?? '')])));
      const fr: Fragment = { i: frag.length, felie: iF, et, t: tIdx, pre: m?.[1] ?? et, r: m ? Number(m[2]) : NaN, c: m ? Number(m[3]) : NaN, pag,
        sig: [...hdr].sort().join('|'), hdr, colNr: hdr.find((h) => E_COL_NR.test(h)) || null, randuri, brut: randuriBrute, g: geomZona(plansa, et) };
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

  // împerecheri orizontale (aceeași bandă, felii care se ating — geometric, runda 6) => componente = același rând fizic văzut în mai multe felii
  const idNod = new Map<string, number>(); const noduri: { fr: Fragment; rand: number }[] = [];
  const nod = (fr: Fragment, rand: number) => { const k = `${fr.i}:${rand}`; if (!idNod.has(k)) { idNod.set(k, noduri.length); noduri.push({ fr, rand }); } return idNod.get(k)!; };
  frag.forEach((fr) => fr.randuri.forEach((_, k) => nod(fr, k)));
  const uf = noduri.map((_, i) => i);
  const rad = (x: number): number => (uf[x] === x ? x : (uf[x] = rad(uf[x])));
  const vecinNrNesigur = new Set<number>();                 // fragmente cu Nr în felia vecină, dar neîmperecheate sigur
  const vecinNeimp = new Set<number>();                     // fragmente vecine cu câmpuri comune, neîmperecheate sigur
  const valori = new Map<string, [number, number | null, number | null]>(obs.map((o) => [`${o.fr!.i}:${o.rand}`, [o.L, o.dn, o.q]]));
  const perechi: { a: string; b: string; delta: number; prin: string; diferente_text: number; randuri: [number, number]; neimperecheate: [number, number] }[] = [];
  // Runda 4 (verificator, BLOCANT): fragmentele împerecheate sigur formează același TABEL (grup). Dacă un fragment din grup are
  // coloană Nr, identitatea prin POZIȚIE e interzisă în tot grupul: rândul din felia cu lungimi care cade în afara
  // suprapunerii cu felia cu Nr (ex. rândul de margine transcris în plus în z1_7) NU mai primește „poz …” — altfel se numără
  // încă o dată prin Nr în banda vecină (470: +320 m tăcut). Merge la „de verificat”.
  const ufFr = frag.map((_, i) => i);
  const radFr = (x: number): number => (ufFr[x] === x ? x : (ufFr[x] = radFr(ufFr[x])));
  const cuLungimi = (F: Fragment) => F.randuri.some((_, k) => valori.has(`${F.i}:${k}`));
  const nrImperecheatCuL = new Set<number>();               // fragmente cu Nr, împerecheate sigur cu un fragment cu lungimi
  for (const A of frag) for (const B of frag) {
    if (!perechePosibila(A, B)) continue;
    const pt = perecheFragmente(A, B);
    const pv = pt && 'delta' in pt ? null : perecheValori(A, B, valori);
    const p = pt && 'delta' in pt ? pt : pv;
    // două fragmente vecine CU LUNGIMI, neîmperecheate, contează ca „neîmperecheate” chiar fără coloane comune
    if (!pt && !pv && !(cuLungimi(A) && cuLungimi(B))) continue;
    if (p && 'delta' in p) {
      let dif = 0, n = 0;
      const comune = A.hdr.filter((h) => B.hdr.includes(h));
      for (let i = 0; i < A.randuri.length; i++) {
        const j = i + p.delta;
        if (j < 0 || j >= B.randuri.length) continue;
        uf[rad(nod(A, i))] = rad(nod(B, j)); n++;
        if (pv) dif += comune.filter((h) => comparaCelule(A.randuri[i][h], B.randuri[j][h], false, false) === 'X').length;
      }
      ufFr[radFr(A.i)] = radFr(B.i);
      if (A.colNr && cuLungimi(B)) nrImperecheatCuL.add(A.i);
      if (B.colNr && cuLungimi(A)) nrImperecheatCuL.add(B.i);
      // număr diferit de rânduri (inclusiv la δ=0) => rândurile rămase în afara suprapunerii sunt SEMNALATE (nu dispar)
      perechi.push({ a: A.et, b: B.et, delta: p.delta, prin: pv ? 'valori L/Dn/Q' : 'câmp comun + ordine', diferente_text: dif,
        randuri: [A.randuri.length, B.randuri.length], neimperecheate: [A.randuri.length - n, B.randuri.length - n] });
    } else {
      vecinNeimp.add(A.i); vecinNeimp.add(B.i);
      if (B.colNr) vecinNrNesigur.add(A.i);
      if (A.colNr) vecinNrNesigur.add(B.i);
    }
  }
  const comp = new Map<number, number[]>();
  noduri.forEach((_, i) => { const r0 = rad(i); if (!comp.has(r0)) comp.set(r0, []); comp.get(r0)!.push(i); });
  const infoComp = new Map<number, { nrs: Map<string, string>; ambiguu: boolean; benzi: Set<number>; vecinNr: boolean; cuColNr: boolean; ref: { fr: Fragment; rand: number } }>();
  for (const [r0, membri] of comp) {
    const nrs = new Map<string, string>(); const felii = new Set<number>(); let ambiguu = false, vecinNr = false, cuColNr = false;
    const benzi = new Set<number>();
    let ref = noduri[membri[0]];
    for (const i of membri) {
      const { fr, rand } = noduri[i];
      if (felii.has(fr.felie)) ambiguu = true;
      felii.add(fr.felie); benzi.add(fr.r);
      if (vecinNrNesigur.has(fr.i)) vecinNr = true;
      if (fr.colNr) { cuColNr = true; const n = nrRand(fr.randuri[rand][fr.colNr]); if (n && !nrs.has(n)) nrs.set(n, fr.sig); }
      if (fr.felie < ref.fr.felie || (fr.felie === ref.fr.felie && rand < ref.rand)) ref = noduri[i];
    }
    infoComp.set(r0, { nrs, ambiguu, benzi, vecinNr, cuColNr, ref });
  }
  const grupCuNr = new Set<number>(frag.filter((fr) => fr.colNr).map((fr) => radFr(fr.i)));
  // Runda 5 (verificator runda 4, BLOCANT): `grupCuNr` vede doar fragmentele împerecheate REUȘIT. Dacă felia cu Nr din banda
  // rândului lipsește (netranscrisă / căzută) sau are antete transcrise altfel (nicio coloană comună => nicio pereche),
  // fragmentul cu lungimi rămânea singur și primea „poz …”, iar rândurile din suprapunerea verticală se numărau încă o dată prin
  // Nr în banda vecină (470: +1.200 m tăcut, Nr 32–37). Un rând se poate număra de două ori doar dacă felia lui se suprapune
  // fizic cu o felie legată de un Nr, deci coloanele de felii ocupate de un tabel cu Nr (orice fragment dintr-un grup cu Nr, în
  // ORICE bandă) nu admit poziția. Runda 6 (verificator runda 5, MAJOR): „coloana” se decide pe GEOMETRIE — intervalul x al feliei
  // atinge intervalul x al unui fragment din grup cu Nr (aceeași sursă). Eticheta ±1 rata ultima coloană, fixată la marginea planșei,
  // care acoperă și `_N-1` (GEOM: fâșia de lungimi din `z1_6` numărată a doua oară, 1.500 m în loc de 750). Fără geometrie (pe
  // candidat sau pe fragmentul cu Nr) suprapunerea nu se poate exclude => poziția e interzisă pe toată pagina (conservator).
  const frCuNr = frag.filter((F) => grupCuNr.has(radFr(F.i)));
  const coloanaCuNr = (fr: Fragment): 'geom' | 'fara_geom' | null => {
    let faraGeom = false;
    for (const F of frCuNr) {
      if (F.pag !== fr.pag) continue;
      if (F.g && fr.g) { if (atingX(F.g, fr.g)) return 'geom'; continue; }
      faraGeom = true;
    }
    return faraGeom ? 'fara_geom' : null;
  };

  // identitatea fiecărei observații cu lungime
  type Id = { o: Obs; id: string; tip: 'nr' | 'pozitie'; nr: string | null; tabel: string };
  const cuId: Id[] = [];
  const candPoz: { o: Obs; c: any }[] = [];
  const nrCuLungime = new Set<string>();                    // (pagină, Nr) legate de o lungime citită, orice ar ieși din ele
  for (const o of obs) {
    const c = infoComp.get(rad(nod(o.fr!, o.rand)))!;
    const fr = o.fr!;
    for (const n of c.nrs.keys()) nrCuLungime.add(`${fr.pag}|${n}`);
    if (c.ambiguu) { nesigur(o.t, o.L, o.dn, 'împerechere ambiguă: rândul se leagă de două rânduri din aceeași felie', o.zona); continue; }
    if (c.nrs.size > 1) { nesigur(o.t, o.L, o.dn, `Nr diferit pentru același rând în felii vecine (${[...c.nrs.keys()].join(' / ')})`, o.zona); continue; }
    if (c.nrs.size === 1) {
      const [nr, sig] = [...c.nrs.entries()][0];
      cuId.push({ o, id: `doc ${doc}|p${fr.pag}|${sig}|nr ${nr}`, tip: 'nr', nr, tabel: sig }); continue;
    }
    if (fr.colNr) { nesigur(o.t, o.L, o.dn, 'Nr lipsă sau ilizibil pe rând', o.zona); continue; }
    if (c.cuColNr) { nesigur(o.t, o.L, o.dn, 'Nr lipsă sau ilizibil pe rând (în felia vecină, împerecheată)', o.zona); continue; }
    if (c.vecinNr) { nesigur(o.t, o.L, o.dn, 'Nr în felia vecină, dar împerecherea rândurilor nu e sigură (ordine/câmp comun)', o.zona); continue; }
    // runda 4 (BLOCANT): poziția doar dacă NICIUN fragment din tabel (grupul împerecheat) nu are coloană Nr
    if (grupCuNr.has(radFr(fr.i))) { nesigur(o.t, o.L, o.dn, MOTIV_AFARA_NR, o.zona); continue; }
    // runda 5 (BLOCANT): nici în coloana (orice bandă) unui tabel cu Nr, chiar dacă perechea din banda rândului a lipsit;
    // runda 6: coloana = suprapunerea pe x din geometria reală; fără geometrie => toată pagina
    const col = coloanaCuNr(fr);
    if (col) { nesigur(o.t, o.L, o.dn, col === 'geom' ? MOTIV_COLOANA_NR : MOTIV_COLOANA_NR_FARA_GEOM, o.zona); continue; }
    candPoz.push({ o, c });
  }
  // poziția ca identitate: doar tabel într-o singură bandă verticală, fragmente vecine împerecheate sigur
  const pePag = new Map<number, typeof candPoz>();
  for (const x of candPoz) pePag.set(x.o.fr!.pag, [...(pePag.get(x.o.fr!.pag) || []), x]);
  // runda 4: două fragmente fără Nr cu ACELEAȘI antete și ACEEAȘI secvență L/Dn/Q în aceeași felie = posibilă transcriere
  // dublă a aceluiași tabel => „de verificat” (cu indexul tabelului în cheie, altfel s-ar număra de două ori)
  // runda 7 (B2): secvența L/Dn/Q doar pe rândurile cu lungime (un rând fără valori nu mai ascunde dublura)
  const valSecv = (fr: Fragment) => fr.randuri.map((_, k) => valori.get(`${fr.i}:${k}`)).filter(Boolean).map((v) => v!.join('/'));
  const egaleSecv = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((v, k) => v === b[k]);
  // `mic` e o sub-secvență (în ordine) a lui `mare`, mai scurtă: prefix, bucată contiguă sau cu rânduri omise la a doua transcriere
  const contineSecv = (mare: string[], mic: string[]) => {
    if (!mic.length || mic.length >= mare.length) return false;
    let j = 0;
    for (const v of mare) if (j < mic.length && v === mic[j]) j++;
    return j === mic.length;
  };
  const dublat = new Set<number>();
  const dublatPartial = new Set<number>();                  // B2: tabelul conținut (surplusul), nu cel complet
  const frPoz = [...new Map(candPoz.map((x) => [x.o.fr!.i, x.o.fr!])).values()];
  for (const A of frPoz) for (const B of frPoz)
    if (A.i < B.i && A.felie === B.felie && A.sig === B.sig && egaleSecv(valSecv(A), valSecv(B))) { dublat.add(A.i); dublat.add(B.i); }
  for (const A of frPoz) for (const B of frPoz)
    if (A.i !== B.i && A.felie === B.felie && A.sig === B.sig && !dublat.has(A.i) && !dublat.has(B.i) && contineSecv(valSecv(A), valSecv(B))) dublatPartial.add(B.i);
  // runda 7 (B1): fără geometrie (pe oricare din cele două fragmente), un grup de poziție la |Δc| ≥ 2 în dreapta altui grup de
  // poziție din aceeași bandă poate fi a doua lectură a aceluiași tabel prin coloana fixată la margine => grupul din dreapta
  // (tot grupul de împerechere) la „de verificat”; cel din stânga rămâne, deci rândul se numără cel mult o dată.
  const eligibilPoz = (F: Fragment) => !vecinNeimp.has(F.i) && !dublat.has(F.i) && !dublatPartial.has(F.i) && !Number.isNaN(F.r) && !Number.isNaN(F.c);
  const grupFixataFaraGeom = new Set<number>();
  for (const A of frPoz) for (const B of frPoz) {
    if (A.pag !== B.pag || A.pre !== B.pre || A.r !== B.r || !(B.c - A.c >= 2) || radFr(A.i) === radFr(B.i)) continue;
    if (A.g && B.g) continue;                                 // cu geometrie: împerecherea / vecinNeimp au decis deja
    if (!eligibilPoz(A) || Number.isNaN(B.c)) continue;
    grupFixataFaraGeom.add(radFr(B.i));
  }
  for (const [, xs] of pePag) {
    const benzi = new Set<number>(xs.flatMap((x) => [...x.c.benzi]));
    for (const x of xs) {
      const fr = x.o.fr!;
      if (benzi.size > 1) { nesigur(x.o.t, x.o.L, x.o.dn, 'tabel fără coloană Nr pe mai multe benzi — rândurile din suprapunerea verticală nu se pot deosebi', x.o.zona); continue; }
      if (vecinNeimp.has(fr.i) || Number.isNaN(fr.r)) { nesigur(x.o.t, x.o.L, x.o.dn, 'tabel fără coloană Nr, fragmente vecine neîmperecheate sigur — poziția rândului nu e sigură', x.o.zona); continue; }
      if (dublat.has(fr.i)) { nesigur(x.o.t, x.o.L, x.o.dn, 'tabel fără coloană Nr repetat în aceeași felie, cu aceleași rânduri — posibilă transcriere dublă', x.o.zona); continue; }
      if (dublatPartial.has(fr.i)) { nesigur(x.o.t, x.o.L, x.o.dn, MOTIV_DUBLA_PARTIALA, x.o.zona); continue; }
      if (grupFixataFaraGeom.has(radFr(fr.i))) { nesigur(x.o.t, x.o.L, x.o.dn, MOTIV_FARA_GEOM_COLOANA_FIXATA, x.o.zona); continue; }
      const ref = x.c.ref;
      // runda 4 (MAJOR, cazul D): indexul tabelului din felie intră în cheie — două tabele fără Nr cu antete identice în
      // aceeași felie nu se mai ciocnesc pe „poz z1_2#1”
      cuId.push({ o: x.o, id: `doc ${doc}|p${fr.pag}|${ref.fr.sig}|poz ${ref.fr.et}.t${ref.fr.t + 1}#${ref.rand + 1}`, tip: 'pozitie', nr: null, tabel: ref.fr.sig });
    }
  }
  // același Nr sub două tabele (antete) diferite pe aceeași pagină => tabelul nu e identificat sigur
  const tabelePeNr = new Map<string, Set<string>>();
  for (const x of cuId) if (x.tip === 'nr') { const k = `${x.o.fr!.pag}|${x.nr}`; tabelePeNr.set(k, (tabelePeNr.get(k) || new Set()).add(x.tabel)); }
  // runda 4 (MAJOR, cazurile B/C/C2): același (tabel, Nr) citit pe noduri care NU sunt același rând fizic — în aceeași felie
  // dar în componente diferite (două tabele cu antete identice / numerotare reluată), sau în felii care NU se suprapun
  // => tabelul nu e identificat sigur, nimic nu se contopește. Runda 6: „se suprapun” = geometria reală (`seSuprapun`:
  // dreptunghiurile se intersectează/ating); fără geometrie, eticheta ±1 (|Δr|>1 sau |Δc|>1 / grilă necunoscută => nu).
  const locNr = new Map<string, { comp: number; fr: Fragment }[]>();
  noduri.forEach((nd, i) => {
    const fr = nd.fr; if (!fr.colNr) return;
    const n = nrRand(fr.randuri[nd.rand][fr.colNr]); if (!n) return;
    const k = `${fr.pag}|${fr.sig}|${n}`;
    locNr.set(k, [...(locNr.get(k) || []), { comp: rad(i), fr }]);
  });
  const nrRepetat = new Map<string, string>();
  for (const [k, ls] of locNr) {
    for (let a = 0; a < ls.length && !nrRepetat.has(k); a++) for (let b = a + 1; b < ls.length; b++) {
      const x = ls[a], y = ls[b];
      if (x.comp === y.comp) continue;
      if (x.fr.felie === y.fr.felie) { nrRepetat.set(k, `de două ori în ${x.fr.et}`); break; }
      if (!seSuprapun(x.fr, y.fr)) { nrRepetat.set(k, `în ${x.fr.et} și ${y.fr.et}, felii care nu se suprapun`); break; }
    }
  }
  const grupuri = new Map<string, Id[]>();
  for (const x of cuId) {
    if (x.tip === 'nr' && tabelePeNr.get(`${x.o.fr!.pag}|${x.nr}`)!.size > 1) {
      nesigur(x.o.t, x.o.L, x.o.dn, `Nr ${x.nr} apare în tabele cu antete diferite pe aceeași pagină — tabelul nu e identificat sigur`, x.o.zona); continue;
    }
    const rep = x.tip === 'nr' ? nrRepetat.get(`${x.o.fr!.pag}|${x.tabel}|${x.nr}`) : undefined;
    if (rep) { nesigur(x.o.t, x.o.L, x.o.dn, `Nr ${x.nr} repetat — tabel neidentificat sigur (${rep})`, x.o.zona); continue; }
    grupuri.set(x.id, [...(grupuri.get(x.id) || []), x]);
  }
  // runda 7 (B4): comasările (aceeași identitate prin Nr) între felii din benzi DIFERITE — suprapuse doar pe vertical — sunt
  // plauzibile numai cât încap în fâșia comună: înălțimea intersecției zone_geom / rândul minim (H_MIN_RAND_MM). Peste
  // capacitate => toate identitățile comasate între cele două felii la „de verificat” (nu se știe care din ele e suprapunerea
  // reală). Sub capacitate: dacă fragmentele din AMBELE felii sunt comasate în întregime (nimic din tabel în afara fâșiei),
  // două tabele identice nu se pot deosebi de suprapunere => avertisment (vizibil), fără schimbarea totalului.
  const perBanda = new Map<string, { A: Fragment; B: Fragment; ids: Set<string>; nr: Set<string>; randuri: Map<number, Set<number>> }>();
  for (const [id, xs] of grupuri) {
    if (xs[0].tip !== 'nr') continue;
    for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) {
      const oa = xs[a].o, ob = xs[b].o;
      const [A, B] = oa.fr!.et <= ob.fr!.et ? [oa.fr!, ob.fr!] : [ob.fr!, oa.fr!];
      const [ra, rb] = oa.fr!.et <= ob.fr!.et ? [oa.rand, ob.rand] : [ob.rand, oa.rand];
      if (A.felie === B.felie) continue;
      const aceeasiBanda = A.g && B.g ? A.g.y0 === B.g.y0 && A.g.y1 === B.g.y1 : A.pre === B.pre && A.r === B.r;
      if (aceeasiBanda) continue;                            // perechile orizontale au regulile lor (împerecherea)
      const k = `${A.et}|${B.et}`;
      const e = perBanda.get(k) || { A, B, ids: new Set<string>(), nr: new Set<string>(), randuri: new Map<number, Set<number>>() };
      e.ids.add(id); if (xs[0].nr) e.nr.add(xs[0].nr);
      for (const [F, r] of [[A, ra], [B, rb]] as [Fragment, number][]) e.randuri.set(F.i, (e.randuri.get(F.i) || new Set<number>()).add(r));
      perBanda.set(k, e);
    }
  }
  const pesteCapacitate = new Map<string, string>();
  const comasariIntegrale: { a: string; b: string; nr: string; randuri: number; fasie_px: number | null; _ids: Set<string> }[] = [];
  const nrListaStr = (s: Set<string>) => { const ns = [...s].filter((x) => /^\d+$/.test(x)).map(Number); return ns.length === s.size ? intervaleNr(ns) : [...s].sort().join(', '); };
  for (const e of [...perBanda.values()].sort((x, y) => `${x.A.et}|${x.B.et}`.localeCompare(`${y.A.et}|${y.B.et}`))) {
    const { A, B } = e;
    let hOv: number | null = null;
    if (A.g && B.g) {
      hOv = Math.min(A.g.y1, B.g.y1) - Math.max(A.g.y0, B.g.y0);
      const hMin = Math.min(hMinRandPx(plansa, A.g.s), hMinRandPx(plansa, B.g.s)), cap = capacitateFasie(hOv, hMin);
      if (e.ids.size > cap) {
        const m = `${MOTIV_PESTE_CAPACITATE}: ${e.ids.size} rânduri (Nr ${nrListaStr(e.nr)}) comasate între ${A.et} și ${B.et}, dar fâșia comună are ` +
          `${Math.max(0, hOv)} px ≈ cel mult ${cap} rânduri (rând ≥ ${H_MIN_RAND_MM} mm) — posibil două tabele identice în benzi vecine; nu se comasează automat`;
        for (const id of e.ids) if (!pesteCapacitate.has(id)) pesteCapacitate.set(id, m);
        continue;
      }
    }
    // comasare integrală: fiecare rând cu lungime al fragmentelor implicate (din ambele felii) e comasat cu cealaltă felie
    const integral = (F: Fragment) => { const rs = e.randuri.get(F.i)!; return F.randuri.every((_, k) => !valori.has(`${F.i}:${k}`) || rs.has(k)); };
    const frA = [...e.randuri.keys()].map((i) => frag[i]).filter((F) => F.felie === A.felie), frB = [...e.randuri.keys()].map((i) => frag[i]).filter((F) => F.felie === B.felie);
    if (frA.every(integral) && frB.every(integral))
      comasariIntegrale.push({ a: A.et, b: B.et, nr: nrListaStr(e.nr), randuri: e.ids.size, fasie_px: hOv === null ? null : Math.max(0, hOv), _ids: e.ids });
  }
  // runda 4 (MAJOR (3)): lecturile aceleiași identități din componente diferite care diferă pe o coloană de TEXT comună
  // (Strada / De la …) nu se contopesc: pot fi două rânduri reale (ex. două tabele cu antete identice în benzi vecine)
  const laMargine = (fr: Fragment, h: string) => h === fr.hdr[0] || h === fr.hdr[fr.hdr.length - 1];
  const textDiferit = (xs: Id[]): string | null => {
    const radacini = [...new Set(xs.map((x) => rad(nod(x.o.fr!, x.o.rand))))];
    for (let a = 0; a < radacini.length; a++) for (let b = a + 1; b < radacini.length; b++)
      for (const i of comp.get(radacini[a])!) for (const j of comp.get(radacini[b])!) {
        const A = noduri[i], B = noduri[j];
        for (const h of A.fr.hdr) {
          if (h === A.fr.colNr || h === B.fr.colNr || !B.fr.hdr.includes(h)) continue;
          const va = A.fr.randuri[A.rand][h], vb = B.fr.randuri[B.rand][h];
          if (textContrazis(va, vb, laMargine(A.fr, h), laMargine(B.fr, h))) return `${h}: „${va}” în ${A.fr.et} / „${vb}” în ${B.fr.et}`;
        }
      }
    return null;
  };
  // observațiile aceleiași identități: valori identice => un rând; diferite => CONFLICT (fără alegere automată)
  const sigure: any[] = [], conflicte: any[] = [];
  const egal = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) < 1e-6;
  // COPILOT-REG-2: sursele fiecărei observații comasate rămân pe rândul reconciliat (felia, tabelul și rândul din felie,
  // valorile citite, feliile din care vine Nr-ul) — rândul se numără o dată, dar nu-și pierde proveniența
  const nrDin = (o: Obs) => [...new Set(comp.get(rad(nod(o.fr!, o.rand)))!.map((i) => noduri[i].fr).filter((F) => F.colNr).map((F) => F.et))];
  const surse = (xs: Id[]) => xs.map((x) => {
    const nd = nrDin(x.o);
    return { zona: x.o.zona, tabel: x.o.fr!.t + 1, rand: x.o.rand + 1, lungime_m: x.o.L, diametru_mm: x.o.dn, debit_mch: x.o.q, ...(nd.length ? { nr_din: nd } : {}) };
  });
  for (const [id, xs] of grupuri) {
    const pc = pesteCapacitate.get(id);
    if (pc) {
      for (const x of xs) nesigur(x.o.t, x.o.L, x.o.dn, pc, x.o.zona);
      continue;
    }
    const td = textDiferit(xs);
    if (td) {
      for (const x of xs) nesigur(x.o.t, x.o.L, x.o.dn, `${x.nr ? `Nr ${x.nr}` : 'rând'} citit cu text diferit între felii (${td}) — posibil două rânduri reale, nu se contopesc`, x.o.zona);
      continue;
    }
    const b = xs[0];
    const dn = xs.map((x) => x.o.dn).find((v) => v !== null) ?? null;
    const q = xs.map((x) => x.o.q).find((v) => v !== null) ?? null;
    const zone = [...new Set(xs.map((x) => x.o.zona))];
    const difera = xs.some((x) => Math.abs(x.o.L - b.o.L) > 1e-6 || !egal(x.o.dn, dn) || !egal(x.o.q, q));
    if (difera) {
      const variante = new Map<string, any>();
      for (const x of xs) {
        const k = `${x.o.L}|${x.o.dn ?? ''}|${x.o.q ?? ''}`;
        const v = variante.get(k) || { lungime_m: x.o.L, diametru_mm: x.o.dn, debit_mch: x.o.q, material: null, zone: [] as string[] };
        if (!v.zone.includes(x.o.zona)) v.zone.push(x.o.zona);
        if (v.material == null && x.o.t?.material) v.material = x.o.t.material;   // runda 5: restul la transfer e pe (Dn, material)
        variante.set(k, v);
      }
      const vs = [...variante.values()];
      const ce = [vs.some((v) => Math.abs(v.lungime_m - b.o.L) > 1e-6) && 'lungime', vs.some((v) => !egal(v.diametru_mm, dn)) && 'diametru',
        vs.some((v) => !egal(v.debit_mch, q)) && 'debit'].filter(Boolean).join('/');
      conflicte.push({ identitate: id, tip: b.tip, nr: b.nr, tabel: b.tabel, motiv: `${ce} diferit(e) între lecturile aceluiași rând — nu se alege automat`,
        variante: vs, de_la: b.o.t?.de_la ?? null, la: b.o.t?.la ?? null, zona: b.o.t?.zona ?? null,
        material: xs.map((x) => x.o.t?.material).find(Boolean) ?? null });
      continue;
    }
    sigure.push({ ...b.o.t, lungime_m: b.o.L, diametru_mm: dn, ...(q !== null ? { debit_mch: q } : {}),
      _identitate: id, _identitate_tip: b.tip, _nr: b.nr, _observatii: zone, _surse: surse(xs) });
  }
  // B4: avertismentul „comasare integrală” rămâne doar pentru identitățile care chiar au ieșit sigure (comasate)
  const idSigure = new Set(sigure.map((t) => t._identitate));
  const comasari = comasariIntegrale.filter((c) => [...c._ids].every((id) => idSigure.has(id))).map(({ _ids, ...c }) => c);
  // runda 4: rânduri numerotate dintr-un fragment cu Nr (fără lungimi) împerecheat sigur cu felia cu lungimi, al căror Nr nu
  // primește NICIO lungime în nicio felie (ex. felia cu L a pierdut rândul de margine, iar banda vecină nu-l vede) =>
  // semnalate (fără metri: lungimea nu s-a citit), ca lipsa să nu fie tăcută.
  const nrFaraLungime: { nr: string; zona: string }[] = [];
  const vazutNr = new Set<string>();
  for (const fr of frag) {
    if (!fr.colNr || cuLungimi(fr) || !nrImperecheatCuL.has(fr.i)) continue;
    fr.randuri.forEach((rw) => {
      const n = nrRand(rw[fr.colNr!]); const k = `${fr.pag}|${n}`;
      if (!n || nrCuLungime.has(k) || vazutNr.has(k)) return;
      vazutNr.add(k); nrFaraLungime.push({ nr: n, zona: fr.et });
    });
  }
  // runda 7 (B3): golurile din secvența Nr a fiecărui tabel identificat (pagină + antete): un Nr între primul și ultimul citit
  // care nu apare în NICIO felie (nici cu lungime, nici fără) e un rând fără nicio lectură — altfel lipsa lui din total ar fi
  // tăcută (470 fără Nr 50: 132 / 48.685 m, 0 de verificat). Nu se inventează metri: totalul sigur rămâne cel derivat, marcat
  // incomplet. Începutul / sfârșitul tabelului nu se pot verifica așa (numerotarea poate continua de pe altă planșă).
  const nrPeTabel = new Map<string, { pag: number; hdr: string[]; nrs: Set<number>; ilizibile: number; zone: Set<string> }>();
  for (const fr of frag) {
    if (!fr.colNr) continue;
    const k = `${fr.pag}|${fr.sig}`;
    const e = nrPeTabel.get(k) || { pag: fr.pag, hdr: fr.hdr, nrs: new Set<number>(), ilizibile: 0, zone: new Set<string>() };
    e.zone.add(fr.et);
    for (const rw of fr.randuri) {
      const n = nrRand(rw[fr.colNr]);
      if (n && /^\d+$/.test(n)) e.nrs.add(Number(n)); else if (!n) e.ilizibile++;
    }
    nrPeTabel.set(k, e);
  }
  const nrLipsa: { pagina: number; tabel: string; interval: [number, number]; lipsesc: string; n: number; nr_ilizibil: number; zone: string[] }[] = [];
  for (const e of nrPeTabel.values()) {
    if (e.nrs.size < 2) continue;
    const min = Math.min(...e.nrs), max = Math.max(...e.nrs), lips: number[] = [];
    for (let n = min + 1; n < max; n++) if (!e.nrs.has(n)) lips.push(n);
    if (lips.length) nrLipsa.push({ pagina: e.pag, tabel: e.hdr.join(' | '), interval: [min, max], lipsesc: intervaleNr(lips), n: lips.length, nr_ilizibil: e.ilizibile, zone: [...e.zone].sort() });
  }
  const suma = (l: any[]) => +l.reduce((s, t) => s + (Number(t.lungime_m) || 0), 0).toFixed(1);
  return {
    sigure, faraIdentitate, conflicte, adnotari, observatii_tabel: nObsTabel, perechi, nrFaraLungime, nrLipsa, comasariIntegrale: comasari,
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
// Runda 4 (verificator, MAJOR): restul se numără și pe CONFLICTE (c, cu plafonul mc = varianta maximă), ca un grup ale cărui
// rânduri sunt TOATE de verificat (fără identitate sau în conflict) să fie găsit și menționat pe poziția lui.
// Runda 5 (verificator runda 4, MAJOR): cheia e (Dn, material) — `${dn}|${materialNorm(material)}`, ca grupurile sigure
// (split-ul Jakarinos 25.09: Dn110 PE ≠ Dn110 OL). Pe cheie doar de Dn, un Dn110 OL numai „de verificat” trecea drept acoperit
// de Dn110 PE sigur, iar poziția OL își păstra tăcut cifra veche. Dn necunoscut => '?'; material necunoscut => ''.
// Runda 7 (B3): `incomplet` = secvența Nr a unui tabel are goluri (rânduri fără nicio lectură, Dn și metri necunoscuți) =>
// cifra din planșă e doar partea citită: numită în notă („pe planșă: secvență Nr incompletă …”), „extras” => „diferenta”.
export type RestTransfer = { peDnMat: Record<string, { n: number; m: number; c?: number; mc?: number }>; global: string; incomplet?: boolean };
export const randuri = (n: number) => `${n} ${n === 1 ? 'rând' : 'rânduri'}`;
const fmtM = (x: number) => (+x.toFixed(1)).toLocaleString('ro-RO');
export const cheieRest = (dn: unknown, material: unknown) => `${dn ? String(dn) : '?'}|${materialNorm(material)}`;
const eticRest = (k: string) => { const [d, m] = k.split('|'); return `${d === '?' ? 'fără Dn' : `Dn${d}`}${m ? ` ${m}` : ''}`; };
// „2 rânduri Dn250 PE fără identitate sigură (10.350 m); 1 conflict Dn250 PE (până la 330 m)”
export function descriereRestDn(rest: RestTransfer | undefined, k: string): string {
  const x = rest?.peDnMat?.[k];
  if (!x) return '';
  const dn = eticRest(k);
  return [x.n ? `${randuri(x.n)} ${dn} fără identitate sigură (${fmtM(x.m)} m)` : '',
    x.c ? `${x.c} conflict${x.c === 1 ? '' : 'e'} ${dn} (până la ${fmtM(x.mc || 0)} m)` : ''].filter(Boolean).join('; ');
}
export const textNrLipsa = (x: { pagina: number; interval: [number, number]; lipsesc: string; n: number; nr_ilizibil?: number }) =>
  `secvență Nr incompletă: lipsesc Nr ${x.lipsesc} (p${x.pagina}, tabel cu Nr ${x.interval[0]}–${x.interval[1]}; ${randuri(x.n)} fără nicio lectură, metri necunoscuți` +
  `${x.nr_ilizibil ? `; ${randuri(x.nr_ilizibil)} cu Nr ilizibil în lectură, la „de verificat”` : ''})`;
export function notaRestTransfer(idr: { faraIdentitate: any[]; conflicte: any[]; total_de_verificat_m: number; nrLipsa?: any[] }, nestandard: any[] = []): RestTransfer {
  const fmt = fmtM;
  const peDnMat: RestTransfer['peDnMat'] = {};
  for (const t of idr.faraIdentitate) {
    const k = cheieRest(t.diametru_mm, t.material);
    const g = peDnMat[k] || (peDnMat[k] = { n: 0, m: 0 });
    g.n++; g.m += Number(t.lungime_m) || 0;
  }
  for (const k of idr.conflicte) {
    const pe = new Map<string, number>();
    for (const v of (k.variante || [])) { const d = cheieRest(v.diametru_mm, v.material ?? k.material); pe.set(d, Math.max(pe.get(d) || 0, Number(v.lungime_m) || 0)); }
    for (const [d, m] of pe) { const g = peDnMat[d] || (peDnMat[d] = { n: 0, m: 0 }); g.c = (g.c || 0) + 1; g.mc = (g.mc || 0) + m; }
  }
  const p: string[] = [];
  if (idr.faraIdentitate.length) p.push(`${randuri(idr.faraIdentitate.length)} de tabel fără identitate sigură (${fmt(idr.faraIdentitate.reduce((s, t) => s + (Number(t.lungime_m) || 0), 0))} m)`);
  if (idr.conflicte.length) p.push(`${idr.conflicte.length} conflict${idr.conflicte.length === 1 ? '' : 'e'} (același rând citit diferit: ` +
    idr.conflicte.slice(0, 6).map((c: any) => `${c.nr ? `Nr ${c.nr}` : 'rând'} ${c.variante.map((v: any) => `${fmt(v.lungime_m)} m${v.diametru_mm ? ` Dn${v.diametru_mm}` : ''}`).join(' / ')}`).join('; ') + ')');
  if (nestandard.length) {
    const dns = [...new Set(nestandard.map((t: any) => Number(t.diametru_mm)))].sort((a, b) => a - b);
    p.push(`Dn nestandard ${dns.map((d) => `Dn${d}`).join(', ')}: ${fmt(nestandard.reduce((s: number, t: any) => s + (Number(t.lungime_m) || 0), 0))} m`);
  }
  const nl = idr.nrLipsa || [];
  for (const x of nl.slice(0, 6)) p.push(textNrLipsa(x));
  if (nl.length > 6) p.push(`încă ${nl.length - 6} tabele cu secvența Nr incompletă`);
  return { peDnMat, global: p.join('; '), ...(nl.length ? { incomplet: true } : {}) };
}
async function treciInCantitati(supa: any, doc: any, tronsoane: any[], nrPlansa: string | null, rulare: string, rest?: RestTransfer) {
  const ops: any[] = [];
  const fmtR = fmtM;
  // runda 5: cheile de rest care privesc grupul sigur (dn, mat): (dn, mat) + (dn, material necunoscut) — un rând de verificat
  // fără material poate fi al oricărei poziții pe acel Dn. Grupul fără material vede doar (dn, ''); (dn, OL) fără grup sigur
  // (dn, OL) e tratat mai jos, ca „doar de verificat”, pe poziția lui.
  const cheiRest = (dn: number, mat: string) => Object.keys(rest?.peDnMat || {}).filter((k) => {
    const [d, m] = k.split('|');
    return d === String(dn) && (m === mat || m === '');
  }).sort((a, b) => (a.endsWith('|') ? 1 : 0) - (b.endsWith('|') ? 1 : 0));
  const sufixDin = (chei: string[]) => {
    const p: string[] = [];
    for (const k of chei) { const x = descriereRestDn(rest, k); if (x) p.push(x); }
    if (rest?.global) p.push(`pe planșă: ${rest.global}`);
    return p.length ? ` De verificat, NEincluse în cifra din planșă: ${p.join('; ')}.` : '';
  };
  const sufixRest = (dn: number | null, mat = '') => sufixDin(dn !== null ? cheiRest(dn, mat) : []);
  // ordinea cheilor de rest din mai multe grupuri (runda 6, coliziune): Dn descrescător, materialul cunoscut înaintea celui necunoscut
  const ordCheie = (a: string, b: string) => { const [da, ma] = a.split('|'), [db, mb] = b.split('|');
    return (Number(db) || 0) - (Number(da) || 0) || (ma ? 0 : 1) - (mb ? 0 : 1) || ma.localeCompare(mb); };
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
  // Runda 4 (verificator, MAJOR): Dn-urile ale căror rânduri sunt TOATE „de verificat” (niciun grup sigur) nu mai sunt sărite —
  // poziția lor primește o notă (și, dacă e încă „extras”, cifra veche din planșă se golește). Fără early-return cât timp
  // există rest de menționat: altfel poziția păstra tăcut cantitate_plansa și nota unei citiri anterioare.
  // Runda 5 (verificator runda 4, MAJOR): pe (Dn, material), ca grupurile sigure. Un (Dn, OL) fără grup sigur (Dn, OL) e
  // „doar de verificat” chiar dacă (Dn, PE) are rânduri sigure; materialul necunoscut rămâne pe Dn (doar dacă Dn-ul n-are
  // niciun grup sigur — altfel e numit în nota fiecărui grup sigur de pe Dn, vezi `cheiRest`).
  const dnSigure = new Set([...peDiametru.values()].map((g) => String(g.dn)));
  const cheiSigure = new Set([...peDiametru.values()].map((g) => `${g.dn}|${g.mat}`));
  const doarDeVerificat = Object.keys(rest?.peDnMat || {}).filter((k) => { const [d, m] = k.split('|'); return m ? !cheiSigure.has(k) : !dnSigure.has(d); })
    .sort((a, b) => (Number(b.split('|')[0]) || 0) - (Number(a.split('|')[0]) || 0) || a.localeCompare(b));
  if (!peDiametru.size && !doarDeVerificat.length && !rest?.global) return { adaugate: 0, actualizate: 0, ambigue: [], pe_diametre: {} };

  const eticheta = nrPlansa ? `Planșa ${nrPlansa}` : `Planșa „${doc.nume_original}”`;
  const { data: existente } = await supa.from('ofertare_cantitati')
    .select('id, denumire, categorie, um, cantitate, cantitate_plansa, status')
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
  // runda 7 (minor verificator runda 6): rândul TOTAL nu e candidat pe Dn — o denumire ca „Total conducte De 110” s-ar potrivi
  // cu Dn110 și ar primi două update-uri pe același id (grupul + TOTAL; ultimul câștigă), sau ar face ambiguă poziția reală Dn110
  const conducte = (existente || []).filter(eConducta);
  const randTotal = conducte.find((r: any) => /total/i.test(r.denumire || ''));
  const retea = conducte.filter((r: any) => r !== randTotal);

  const ambigue: any[] = [];
  const peDiametreRaport: Record<string, number> = {};
  const ceVechi = (cp: number | null, golit: boolean) => golit
    ? `cifra din planșă s-a golit${cp !== null ? ` (era ${fmtR(cp)} m, dintr-o citire anterioară)` : ''}`
    : `cifra din planșă nu s-a actualizat${cp !== null ? ` (${fmtR(cp)} m e dintr-o citire anterioară)` : ''}`;

  // Runda 6 (verificator runda 5, MAJOR — pre-existent, codul identic la 8a6fbbb): întâi se află ținta FIECĂRUI grup sigur, apoi se
  // scrie. Două grupuri sigure cu materiale diferite ((Dn, PE) + (Dn, OL) sau (Dn, PE) + (Dn, '')) care nimereau ACEEAȘI poziție
  // unică dădeau două update-uri pe același id; RPC-ul le aplică în ordine => ultimul câștiga, primul se pierdea TĂCUT (PE 500 +
  // OL 90 => cantitate_plansa 90, nota „-500 m” falsă). Acum poziția atinsă de mai multe grupuri e AMBIGUĂ: cantitate_plansa NU se
  // atinge, nota numește toate grupurile și metrii lor, „extras” => „diferenta” (validat rămâne validat), intrare în `ambigue[]`.
  // Rezultatul nu depinde de ordinea grupurilor (grupurile din notă sunt ordonate: Dn, material cunoscut, apoi fără material).
  const tinte = [...peDiametru.values()].sort((a, b) => b.dn - a.dn).map((g) => {
    let candidati = retea.filter((r: any) =>
      new RegExp(`(?:\\bdn|\\bde|ø|Ø|φ)\\s*${g.dn}\\b`, 'i').test(faraDiacritice(r.denumire || '')));
    // mai multe poziții pe același diametru => încearcă să departajezi după material, înainte de „ambiguu"
    if (candidati.length > 1 && g.mat) {
      const peMat = candidati.filter((r: any) => materialNorm(r.denumire) === g.mat);
      if (peMat.length) candidati = peMat;
    }
    return { g, m: +g.m.toFixed(1), candidati };
  });
  const grupuriPeId = new Map<unknown, typeof tinte>();
  for (const x of tinte) if (x.candidati.length === 1) grupuriPeId.set(x.candidati[0].id, [...(grupuriPeId.get(x.candidati[0].id) || []), x]);
  const ordGrup = (a: typeof tinte[number], b: typeof tinte[number]) => ordCheie(`${a.g.dn}|${a.g.mat}`, `${b.g.dn}|${b.g.mat}`);
  const coliziuniScrise = new Set<unknown>();

  for (const { g, m, candidati } of tinte) {
    const dn = g.dn;
    peDiametreRaport[`Dn${dn}${g.mat ? ' ' + g.mat : ''}`] = m;
    // Daca acelasi diametru apare pe mai multe pozitii (doua localitati, doua loturi, doua
    // materiale), NU ghicim care e. Pana acum `.find()` lua prima si suprascria tacut — iar
    // o plansa ulterioara putea suprascrie ce pusese cea dinainte. Ambiguitatea se RAPORTEAZA.
    if (candidati.length > 1) {
      const dv = cheiRest(dn, g.mat).map((k) => descriereRestDn(rest, k)).filter(Boolean).join('; ');
      ambigue.push({ dn, material: g.mat || null, metri: m, ...(dv ? { de_verificat: dv } : {}), pozitii: candidati.slice(0, 6).map((r: any) => ({ id: r.id, denumire: r.denumire })) });
      continue;
    }
    const potrivit = candidati[0];
    const peAceeasi = potrivit ? grupuriPeId.get(potrivit.id)! : [];
    if (peAceeasi.length > 1) {
      // runda 6: coliziune — o singură scriere pe id (la primul grup, în ordinea Dn), doar notă (+ „diferenta” pe „extras”)
      if (coliziuniScrise.has(potrivit.id)) continue;
      coliziuniScrise.add(potrivit.id);
      const xs = [...peAceeasi].sort(ordGrup);
      const suma = +xs.reduce((s, x) => s + x.m, 0).toFixed(1);
      const lista = xs.map((x) => `${eticRest(`${x.g.dn}|${x.g.mat}`)}${x.g.mat ? '' : ' fără material'} ${fmtR(x.m)} m (${randuri(x.g.n)})`).join('; ');
      const cp = potrivit.cantitate_plansa == null ? null : Number(potrivit.cantitate_plansa);
      const chei = [...new Set(xs.flatMap((x) => cheiRest(x.g.dn, x.g.mat)))].sort(ordCheie);
      const patch: Record<string, unknown> = { diferenta_nota: `De verificat: ${eticheta} dă ${xs.length} grupuri sigure pe aceeași poziție — ${lista}; ` +
        `împreună ${fmtR(suma)} m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); ${ceVechi(cp, false)}.` + sufixDin(chei) };
      if (potrivit.status === 'extras') patch.status = 'diferenta';
      ops.push({ op: 'update', id: potrivit.id, patch });
      const dns = [...new Set(xs.map((x) => x.g.dn))];
      const dv = chei.map((k) => descriereRestDn(rest, k)).filter(Boolean).join('; ');
      ambigue.push({ dn: dns.length === 1 ? dns[0] : null, material: null, metri: suma, motiv: 'mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă',
        grupuri: xs.map((x) => ({ dn: x.g.dn, material: x.g.mat || null, metri: x.m, randuri: x.g.n })), ...(dv ? { de_verificat: dv } : {}),
        pozitii: [{ id: potrivit.id, denumire: potrivit.denumire }] });
      continue;
    }

    if (potrivit) {
      const dinMemoriu = potrivit.cantitate === null ? null : Number(potrivit.cantitate);
      const nota = dinMemoriu === null
        ? `${eticheta} dă ${m.toLocaleString('ro-RO')} m pe ${g.n} tronsoane.`
        : Math.abs(dinMemoriu - m) < 1
          ? `${eticheta} confirmă: ${m.toLocaleString('ro-RO')} m.`
          : `Memoriu ${dinMemoriu.toLocaleString('ro-RO')} m vs ${eticheta.toLowerCase()} ${m.toLocaleString('ro-RO')} m ` +
            `(${m - dinMemoriu > 0 ? '+' : ''}${(m - dinMemoriu).toLocaleString('ro-RO')} m, pe ${g.n} tronsoane citite din tabel).`;
      const patch: Record<string, unknown> = { cantitate_plansa: m, diferenta_nota: nota + sufixRest(dn, g.mat), updated_at: new Date().toISOString() };
      // daca cineva a validat deja pozitia, nu-i schimbam decizia — doar ii aratam nota
      // (runda 4: și când pe același Dn există rânduri de verificat, cifra din planșă e incompletă => „diferenta”)
      // runda 7 (B3): și când secvența Nr a planșei e incompletă (cifra e doar partea citită)
      if (potrivit.status === 'extras' && ((dinMemoriu !== null && Math.abs(dinMemoriu - m) >= 1) || cheiRest(dn, g.mat).length || rest?.incomplet)) patch.status = 'diferenta';
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
        // runda 4 (verificator, minor): pe un Dn cu rânduri de verificat cifra (doar partea sigură) cere verificare => „diferenta”
        status: cheiRest(dn, g.mat).length || rest?.incomplet ? 'diferenta' : 'extras', extras_de_ai: true,
        sursa,
        specificatii: [[...g.sdr].join('/'), [...g.zone].slice(0, 12).join(', ') || `${g.n} tronsoane`].filter(Boolean).join(' · '),
        diferenta_nota: `Diametru care nu apare în cantitățile din memoriu. ${g.n} tronsoane citite din tabelul planșei.` + sufixRest(dn, g.mat),
      } });
    }
  }

  // Runda 4: Dn-uri fără NICIUN rând sigur (toate „de verificat”). Poziția existentă NU primește o cifră (nu există una sigură):
  //  - status „extras” (nevalidată de om) => cantitate_plansa = null, status „diferenta”, nota spune ce era înainte;
  //  - validată / deja „diferenta” => doar nota (decizia omului rămâne), cu mențiunea că cifra din planșă e dintr-o citire veche.
  // Nu se inserează poziții noi din rânduri nesigure; Dn-ul fără poziție (sau „fără Dn”) e raportat în răspuns și în nota TOTAL.
  const patchDoarVerificare = (r: any, ce: string) => {
    const cp = r.cantitate_plansa == null ? null : Number(r.cantitate_plansa);
    const golit = r.status === 'extras';
    const diferenta_nota = `De verificat: ${ce}; ${ceVechi(cp, golit)}.` + (rest?.global ? ` Pe planșă: ${rest.global}.` : '');
    return golit ? { cantitate_plansa: null, status: 'diferenta', diferenta_nota } : { diferenta_nota };
  };
  const doarVerif: { dn: number | null; material: string | null; pozitie_id: number | null; actiune: string }[] = [];
  for (const k of doarDeVerificat) {
    const ce = descriereRestDn(rest, k);
    const [d, mat] = k.split('|');
    const dn = d === '?' ? null : Number(d);
    const material = mat || null;
    if (dn === null) { doarVerif.push({ dn, material, pozitie_id: null, actiune: 'fara_dn' }); continue; }
    let candidati = retea.filter((r: any) => new RegExp(`(?:\\bdn|\\bde|ø|Ø|φ)\\s*${dn}\\b`, 'i').test(faraDiacritice(r.denumire || '')));
    // runda 5: același filtru pe material ca la ramura sigură (mai multe poziții pe Dn => cea cu materialul restului)
    if (candidati.length > 1 && mat) {
      const peMat = candidati.filter((r: any) => materialNorm(r.denumire) === mat);
      if (peMat.length) candidati = peMat;
    }
    if (candidati.length > 1) {
      ambigue.push({ dn, material, metri: 0, de_verificat: ce, pozitii: candidati.slice(0, 6).map((r: any) => ({ id: r.id, denumire: r.denumire })) });
      doarVerif.push({ dn, material, pozitie_id: null, actiune: 'ambiguu' }); continue;
    }
    const p = candidati[0];
    if (!p) { doarVerif.push({ dn, material, pozitie_id: null, actiune: 'fara_pozitie' }); continue; }
    const deja = ops.find((o) => o.op === 'update' && o.id === p.id);
    if (deja) {
      // aceeași poziție primește deja cifra altui grup sigur (ex. singura poziție Dn110 ia Dn110 PE): cifra ei e incompletă
      deja.patch.diferenta_nota += ` De verificat (${eticRest(k)}, fără nicio cifră sigură): ${ce}.`;
      if (p.status === 'extras') deja.patch.status = 'diferenta';
      doarVerif.push({ dn, material, pozitie_id: p.id, actiune: 'nota' }); continue;
    }
    const patch = patchDoarVerificare(p, ce);
    ops.push({ op: 'update', id: p.id, patch });
    doarVerif.push({ dn, material, pozitie_id: p.id, actiune: 'cantitate_plansa' in patch ? 'golit' : 'nota' });
  }

  // runda 7 (MY-T4, minorul verificatorului rundei 5): restul FĂRĂ material pe un Dn care are grup sigur poate fi al oricărei
  // poziții de pe Dn — și al celor neatinse de niciun grup sigur (ex. poziția OL când grupul sigur e PE). Înainte doar poziția
  // grupului sigur îl numea; a doua poziție rămânea tăcut cu cifra și nota unei citiri anterioare. Acum: nota și pe ea, „extras”
  // => „diferenta”; cifra NU se golește (poziția poate veni din altă planșă) — e numită „dintr-o citire anterioară”.
  const cheiFaraMat = Object.keys(rest?.peDnMat || {}).filter((k) => { const [d, m] = k.split('|'); return d !== '?' && !m && dnSigure.has(d); })
    .sort((a, b) => (Number(b.split('|')[0]) || 0) - (Number(a.split('|')[0]) || 0));
  for (const k of cheiFaraMat) {
    const dn = Number(k.split('|')[0]), ce = descriereRestDn(rest, k);
    const peDn = retea.filter((r: any) => new RegExp(`(?:\\bdn|\\bde|ø|Ø|φ)\\s*${dn}\\b`, 'i').test(faraDiacritice(r.denumire || '')));
    for (const p of peDn) {
      const deja = ops.find((o) => o.op === 'update' && o.id === p.id);
      if (deja) {
        if (!String(deja.patch.diferenta_nota || '').includes(ce)) {
          deja.patch.diferenta_nota = `${deja.patch.diferenta_nota || ''} De verificat (Dn${dn} fără material — pot fi ale acestei poziții): ${ce}.`.trim();
          if (p.status === 'extras') deja.patch.status = 'diferenta';
        }
        continue;
      }
      const cp = p.cantitate_plansa == null ? null : Number(p.cantitate_plansa);
      const patch: Record<string, unknown> = { diferenta_nota: `De verificat: ${ce} — fără material, pot fi ale acestei poziții (grupul sigur de pe Dn${dn} e pe alt material); ` +
        `${ceVechi(cp, false)}.` + (rest?.global ? ` Pe planșă: ${rest.global}.` : '') };
      if (p.status === 'extras') patch.status = 'diferenta';
      ops.push({ op: 'update', id: p.id, patch });
      doarVerif.push({ dn, material: null, pozitie_id: p.id, actiune: 'nota_fara_material' });
    }
  }

  // randul de total, daca exista, primeste si el valoarea din plansa (runda 7: nu mai e candidat pe Dn => un singur update pe id)
  const total = +[...peDiametru.values()].reduce((s, g) => s + g.m, 0).toFixed(1);
  if (randTotal && ops.some((o) => o.op === 'update' && o.id === randTotal.id)) throw new Error('transfer: două scrieri pe rândul TOTAL (id ' + randTotal.id + ')');
  if (randTotal && peDiametru.size) {
    const dinMemoriu = randTotal.cantitate === null ? null : Number(randTotal.cantitate);
    const patch: Record<string, unknown> = {
      cantitate_plansa: total,
      diferenta_nota: (dinMemoriu !== null && Math.abs(dinMemoriu - total) >= 1
        ? `Memoriu ${dinMemoriu.toLocaleString('ro-RO')} m vs ${eticheta.toLowerCase()} ${total.toLocaleString('ro-RO')} m.`
        : `${eticheta} confirmă totalul: ${total.toLocaleString('ro-RO')} m.`) + sufixRest(null),
    };
    // runda 5 (verificator, minor): ca pe Dn — TOTAL „extras” cu rest de verificat pe planșă (cifra = doar partea sigură) => „diferenta”
    if (randTotal.status === 'extras' && rest?.global) patch.status = 'diferenta';
    ops.push({ op: 'update', id: randTotal.id, patch });
  } else if (randTotal) {
    // niciun rând sigur (cu Dn standard) pe planșă: totalul NU devine 0 m — doar nota (sau golire, dacă e „extras”)
    ops.push({ op: 'update', id: randTotal.id, patch: patchDoarVerificare(randTotal, `nicio lungime sigură cu Dn standard pe ${eticheta.toLowerCase()}`) });
  }

  const extra = doarVerif.length ? { doar_de_verificat: doarVerif } : {};
  if (!peDiametru.size && !ops.length) return { adaugate: 0, actualizate: 0, ambigue, total_m: 0, pe_diametre: {}, ...extra };
  const { data: rez, error } = await supa.rpc('ofertare_transfer_plansa_cantitati',
    { p_doc_id: doc.id, p_rulare: rulare, p_randuri: ops });
  if (error) throw new Error(error.message || String(error));
  if (rez?.eroare === 'lease_pierdut') throw new LeasePierdut();
  if (!rez?.ok) throw new Error(`transfer: răspuns neașteptat ${JSON.stringify(rez).slice(0, 120)}`);
  const adaugate = rez.adaugate ?? 0, actualizate = rez.actualizate ?? 0;

  return { adaugate, actualizate, ambigue, total_m: total, pe_diametre: peDiametreRaport, ...extra };
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

// Partea din raportul citirii (sumar + avertismente) care privește identitatea rândurilor de tabel. Extrasă în runda 7 ca
// testele să verifice RAPORTUL (nu doar rezultatul intern): ce e ambiguu apare ca „de verificat” cu total separat și motiv,
// conflictele cu variantele lor, golurile din secvența Nr, comasările care nu se pot confirma geometric (COPILOT-REG-4, B3, B4).
export function raportIdentitate(idr: ReturnType<typeof identificaRanduri>) {
  const avertismente: string[] = [];
  if (idr.faraIdentitate.length || idr.conflicte.length)
    avertismente.push(`${randuri(idr.faraIdentitate.length)} de tabel fără identitate sigură și ${idr.conflicte.length} ` +
      `conflict${idr.conflicte.length === 1 ? '' : 'e'} (același rând citit cu valori diferite): ${idr.total_de_verificat_m} m de verificat — NU intră în cantități`);
  if (idr.nrFaraLungime.length)
    avertismente.push(`${randuri(idr.nrFaraLungime.length)} numerotate fără nicio lungime citită (Nr ${idr.nrFaraLungime.slice(0, 12).map((x: any) => x.nr).join(', ')}` +
      `${idr.nrFaraLungime.length > 12 ? ', …' : ''}) — lungimea lor lipsește din total; de verificat pe planșă`);
  // runda 5 (verificator, minor): perechile de felii cu rânduri în afara suprapunerii ajung în sumar + avertisment (erau doar în idr)
  const perNeimp = idr.perechi.filter((p) => p.neimperecheate[0] || p.neimperecheate[1]);
  if (perNeimp.length)
    avertismente.push(`${perNeimp.length} ${perNeimp.length === 1 ? 'pereche' : 'perechi'} de felii vecine cu rânduri în afara suprapunerii (` +
      perNeimp.slice(0, 6).map((p) => `${p.a}+${p.b}: ${p.neimperecheate[0]}/${p.neimperecheate[1]}`).join(', ') + `${perNeimp.length > 6 ? ', …' : ''}` +
      ') — rândurile acelea nu s-au legat între felii (margine tăiată sau rând omis la citire); vezi „de verificat” și „Nr fără lungime”');
  // runda 7 (B3): golurile din secvența Nr — rânduri fără nicio lectură; totalul sigur e incomplet (fără metri inventați)
  for (const x of idr.nrLipsa) avertismente.push(`${textNrLipsa(x)} — totalul sigur (${idr.total_sigur_m} m) NU le conține, e INCOMPLET; de verificat pe planșă`);
  // runda 7 (B4): comasări între benzi pe care geometria nu le poate confirma (fragmentele comasate în întregime)
  for (const c of idr.comasariIntegrale.slice(0, 6)) avertismente.push(`${randuri(c.randuri)} (Nr ${c.nr}) din ${c.a} și ${c.b} (benzi diferite) s-au comasat ca același rând ` +
    `(suprapunerea benzilor${c.fasie_px !== null ? `, fâșia comună ${c.fasie_px} px` : ''}), iar fragmentele din ambele felii sunt comasate în întregime — dacă sunt două ` +
    'tabele identice (antete, Nr, L/Dn/Q, text), rândurile sunt numărate o singură dată; de verificat pe planșă');
  const sumar = {
    // identitatea rândurilor de tabel (Copilot runda 3): totalul sigur = rânduri cu identitate sigură, fără conflict (înainte
    // de filtrul de Dn nestandard); „de verificat” = fără identitate + conflicte; niciunul din ele nu intră în cantități
    total_sigur_m: idr.total_sigur_m,
    total_de_verificat_m: idr.total_de_verificat_m,
    ...(idr.nrLipsa.length ? { total_sigur_incomplet: true } : {}),
    conflicte: idr.conflicte.slice(0, 60),
    randuri_fara_identitate: idr.faraIdentitate.slice(0, 200).map((t: any) => ({ zona: t._zona ?? null, de_la: t.de_la ?? null, la: t.la ?? null,
      lungime_m: t.lungime_m, diametru_mm: t.diametru_mm ?? null, debit_mch: numar(t.debit_mch), motiv: t._motiv })),
    randuri_fara_identitate_n: idr.faraIdentitate.length,
    ...(idr.nrFaraLungime.length ? { nr_fara_lungime: idr.nrFaraLungime.slice(0, 60), nr_fara_lungime_n: idr.nrFaraLungime.length } : {}),
    ...(perNeimp.length ? { perechi_neimperecheate: perNeimp.slice(0, 60).map((p) => ({ a: p.a, b: p.b, delta: p.delta, prin: p.prin, randuri: p.randuri, neimperecheate: p.neimperecheate })),
      perechi_neimperecheate_n: perNeimp.length } : {}),
    ...(idr.nrLipsa.length ? { nr_lipsa: idr.nrLipsa.slice(0, 60), nr_lipsa_n: idr.nrLipsa.reduce((q, x) => q + x.n, 0) } : {}),
    ...(idr.comasariIntegrale.length ? { comasari_neconfirmate: idr.comasariIntegrale.slice(0, 60) } : {}),
    identitate_randuri: { lecturi_tabel: idr.observatii_tabel, randuri_sigure: idr.sigure.length, prin_nr: idr.prin.nr, prin_pozitie: idr.prin.pozitie,
      fara_identitate: idr.faraIdentitate.length, conflicte: idr.conflicte.length },
  };
  return { avertismente, sumar };
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
  // identitatea rândurilor (runda 7: extrasă în raportIdentitate — aceeași logică, testabilă direct; + nr_lipsa, comasări)
  const ri = raportIdentitate(idr);
  avertismente.push(...ri.avertismente);
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
    // identitatea rândurilor de tabel: total_sigur_m / total_de_verificat_m / conflicte / randuri_fara_identitate / nr_fara_lungime /
    // perechi_neimperecheate / nr_lipsa (+ total_sigur_incomplet) / comasari_neconfirmate / identitate_randuri — raportIdentitate
    ...ri.sumar,
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
