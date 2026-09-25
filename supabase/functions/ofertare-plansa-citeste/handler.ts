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
const COD_VERSIUNE = '2026-09-25.3'; // se schimbă la fiecare modificare a citirii/agregării (proveniență T11)          // doar pe limitări/suprasarcină furnizor (429, 529, 5xx), cu așteptare

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
function tronsoaneUnice(lista: any[]) {
  const vazute = new Set<string>();
  const out: any[] = [];
  for (const t of lista) {
    const lung = numar(t?.lungime_m);
    if (!lung || lung <= 0) continue;
    const dn = numar(t?.diametru_mm);
    const cheie = [text(t?.de_la), text(t?.la), lung, dn ?? '', numar(t?.debit_mch) ?? '', text(t?.zona)].join('|');
    if (vazute.has(cheie)) continue;
    vazute.add(cheie);
    out.push({ ...t, lungime_m: lung, diametru_mm: dn });
  }
  return out;
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
async function treciInCantitati(supa: any, doc: any, tronsoane: any[], nrPlansa: string | null) {
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

  let adaugate = 0, actualizate = 0;
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
      const patch: Record<string, unknown> = { cantitate_plansa: m, diferenta_nota: nota, updated_at: new Date().toISOString() };
      // daca cineva a validat deja pozitia, nu-i schimbam decizia — doar ii aratam nota
      if (potrivit.status === 'extras' && dinMemoriu !== null && Math.abs(dinMemoriu - m) >= 1) patch.status = 'diferenta';
      await supa.from('ofertare_cantitati').update(patch).eq('id', potrivit.id);
      actualizate++;
    } else {
      await supa.from('ofertare_cantitati').insert({
        licitatie_id: doc.licitatie_id,
        // categoria o pune trigger-ul din dictionar (fn_categorie_cantitate)
        denumire: `Conductă distribuție gaze${g.mat ? ' ' + g.mat : ''} Dn${dn}`,
        um: 'm', cantitate: m, cantitate_plansa: m,
        status: 'extras', extras_de_ai: true,
        sursa: `${eticheta} — tabel de dimensionare, citit automat din scanare`,
        specificatii: [[...g.sdr].join('/'), [...g.zone].slice(0, 12).join(', ') || `${g.n} tronsoane`].filter(Boolean).join(' · '),
        diferenta_nota: `Diametru care nu apare în cantitățile din memoriu. ${g.n} tronsoane citite din tabelul planșei.`,
      });
      adaugate++;
    }
  }

  // randul de total, daca exista, primeste si el valoarea din plansa
  const total = +[...peDiametru.values()].reduce((s, g) => s + g.m, 0).toFixed(1);
  const randTotal = retea.find((r: any) => /total/i.test(r.denumire || ''));
  if (randTotal) {
    const dinMemoriu = randTotal.cantitate === null ? null : Number(randTotal.cantitate);
    await supa.from('ofertare_cantitati').update({
      cantitate_plansa: total,
      diferenta_nota: dinMemoriu !== null && Math.abs(dinMemoriu - total) >= 1
        ? `Memoriu ${dinMemoriu.toLocaleString('ro-RO')} m vs ${eticheta.toLowerCase()} ${total.toLocaleString('ro-RO')} m.`
        : `${eticheta} confirmă totalul: ${total.toLocaleString('ro-RO')} m.`,
      updated_at: new Date().toISOString(),
    }).eq('id', randTotal.id);
    actualizate++;
  }

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

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  let uidApelant: string | null = null;
  if (jwt !== SERVICE) {
    uidApelant = await deps.getUser(jwt);
    if (!uidApelant) return json({ error: 'unauthorized' }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const docId = Number(body?.doc_id);
  const deLa = Number(body?.de_la) || 0;
  if (!docId) return json({ error: 'doc_id lipsa' }, 400);

  const { data: doc } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, analiza').eq('id', docId).maybeSingle();
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

  // Pasul „lipește notele tăiate" — apel separat (bugetul de timp al unei rulări), cerut de UI după citire.
  if (body?.doar_lipire === true) {
    const ca = doc.analiza?.citire_ai;
    if (!ca?.gata) return json({ error: 'planșa nu e citită complet' }, 400);
    const facute = new Set<string>([...(ca.note_lipite_perechi || []), ...(ca.note_lipite || []).map((n: any) => n.perechea)].filter(Boolean).map(String));
    const perechi = perechiDeLipit(ca.felii || [], peStorage, facute).slice(0, MAX_PERECHI);
    const rez: any[] = [];
    for (let i = 0; i < perechi.length; i += PARALEL) {
      rez.push(...await Promise.all(perechi.slice(i, i + PARALEL).map(async ([a, b]) => {
        const [x, y] = await Promise.all([a, b].map((n) => supa.storage.from('ofertare').download(`${plansa.cale_felii}/${n}.jpg`)));
        if (!x.data || !y.data) return { eticheta: `${a}+${b}`, randuri: [], eroare: 'descarcare esuata' };
        return await lipestePereche(API_KEY, new Uint8Array(await x.data.arrayBuffer()), new Uint8Array(await y.data.arrayBuffer()), `${a}+${b}`);
      })));
    }
    const tinL = rez.reduce((q, r) => q + (r._tin || 0), 0), toutL = rez.reduce((q, r) => q + (r._tout || 0), 0);
    if (rez.length) await supa.from('ai_usage_log').insert({ function_name: 'ofertare-plansa-citeste', model: MODEL, tokens_in: tinL, tokens_out: toutL,
      cost_usd: +(tinL * PRET_IN + toutL * PRET_OUT).toFixed(4), ref_table: 'ofertare_documente_atribuire', ref_id: docId });
    const vazut = new Set<string>();
    const note = [...(ca.note_lipite || []), ...rez.flatMap((r: any) => (r.randuri || []).map((n: any) => ({ ...n, perechea: r.eticheta })))
    ].filter((n: any) => { const k = text(n.text); if (!k || vazut.has(k)) return false; vazut.add(k); return true; });
    const ld = lungimeDeclarata(note);
    const decl = ld.m;
    const citireAi2 = { ...ca, note_lipite: note, note_lipite_perechi: [...facute, ...rez.map((r: any) => r.eticheta)],
      perechi_ramase: Math.max(0, perechiDeLipit(ca.felii || [], peStorage, new Set([...facute, ...rez.map((r: any) => r.eticheta)])).length), sumar: { ...ca.sumar, note_lipite: note.length, perechi_lipite: rez.length, ...(decl ? { lungime_declarata_m: decl } : {}),
      ...(ld.necorelare ? { necorelare_unitate: ld.necorelare } : {}),
      // proveniența vizuală: ce document, ce pagină, ce zone/imagini au dat cifra
      provenienta: { doc_id: docId, fisier: doc.nume_original, pagina: 1, dpi: plansa.dpi || null, cale_felii: plansa.cale_felii, zone: ld.sursa } } };
    const upd2: Record<string, unknown> = { analiza: { ...doc.analiza, citire_ai: citireAi2 }, analiza_la: new Date().toISOString(),
      text_extras: textPlansa(doc.nume_original, citireAi2) };
    // lungimea declarată e o dată utilă => planșa nu mai e „fără rezultat" (nu mai intră în clarificarea automată)
    const { data: cur } = await supa.from('ofertare_documente_atribuire').select('eroare').eq('id', docId).single();
    if (decl && cur?.eroare === 'citită fără rezultat') upd2.eroare = null;
    await supa.from('ofertare_documente_atribuire').update(upd2).eq('id', docId);
    let clar: unknown = null;
    if (upd2.eroare === null) {
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
  const numeZona = (f: any) => String(f.name || '').replace('.jpg', '');
  const existente: any[] = (mod || deLa > 0) && acelasiTaiat ? (ca0?.felii || []) : (deLa > 0 ? (ca0?.felii || []) : []);
  const rezPe = new Map(existente.map((r: any) => [String(r.eticheta || '').replace('.jpg', ''), r]));
  const sari = new Set<string>((Array.isArray(body?.sari) ? body.sari : []).map(String));
  const lot = mod === 'reia_erori'
    ? felii.filter((f: any) => rezPe.get(numeZona(f))?.eroare && !sari.has(numeZona(f))).slice(0, FELII_PE_RULARE)
    : mod === 'continua'
      ? felii.filter((f: any) => !rezPe.has(numeZona(f))).slice(0, FELII_PE_RULARE)
      : felii.slice(deLa, deLa + FELII_PE_RULARE);
  // 25.09.2026 (Vâlcelele, schema tehnologică): tabelul de dimensionare se întinde pe multe zone, dar antetul e
  // doar în prima — zonele fără antet ghiceau coloanele (debitul citit ca diametru: Dn43/48/56/96/98).
  // Antetele găsite în zonele deja citite se dau mai departe.
  const anteteCunoscute = [...new Set(existente
    .flatMap((r: any) => (r.tabele || []).map((t: any) => `${t.denumire || 'tabel'}: ${(t.coloane || []).join(' | ')}`))
    .filter((x: string) => x.includes('|')))].slice(0, 4).join(' ;; ');
  const paralel = Math.max(1, Math.min(PARALEL_MAX, Math.floor(Number(body?.paralel)) || PARALEL));
  const tRunda = Date.now();
  const rezultate: any[] = [];
  for (let i = 0; i < lot.length; i += paralel) {
    const grup = lot.slice(i, i + paralel);
    const parti = await Promise.all(grup.map(async (f: any) => {
      const { data: bin, error } = await supa.storage.from('ofertare').download(`${plansa.cale_felii}/${f.name}`);
      if (error || !bin) return { eticheta: numeZona(f), eroare: error?.message || 'descarcare esuata' };
      return await citesteFelie(API_KEY, new Uint8Array(await bin.arrayBuffer()), f.name.replace('.jpg', ''), anteteCunoscute);
    }));
    rezultate.push(...parti);
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
  // proveniența pe tronson: zona (regiunea) din care a fost citit
  for (const r of rezultate) for (const t of (r.tronsoane || [])) t._zona = r.eticheta;
  const inLot = new Set(lot.map(numeZona));
  const precedente = existente.filter((r: any) => !inLot.has(String(r.eticheta || '').replace('.jpg', '')));
  const toate = [...precedente, ...rezultate].sort((a: any, b: any) => String(a.eticheta).localeCompare(String(b.eticheta)));
  const cuRezultat = new Set(toate.map((r: any) => String(r.eticheta || '').replace('.jpg', '')));
  const gata = felii.every((f: any) => cuRezultat.has(numeZona(f)));
  const maiSunt = mod === 'reia_erori'
    ? felii.some((f: any) => { const n = numeZona(f); return !inLot.has(n) && !sari.has(n) && toate.find((r: any) => r.eticheta === n)?.eroare; })
    : !gata;

  // sumar peste tot ce s-a citit pana acum, ca sa se vada imediat ce a iesit.
  // Se numara tronsoanele UNICE: cu suprapunerea dintre felii, acelasi rand apare de
  // doua ori si totalul ar iesi umflat.
  const brute = toate.flatMap((r: any) => r.tronsoane || []);
  const unice = tronsoaneUnice(brute);
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
  const dinTabel = unice.filter((t: any) => text(t?.sursa) === 'tabel');
  const cheieDM = (t: any) => `${t.diametru_mm || 0}|${materialNorm(t.material)}`;
  const acoperitDeTabel = new Set(dinTabel.map(cheieDM));
  const adnotari = dinTabel.length ? unice.filter((t: any) => text(t?.sursa) !== 'tabel') : [];
  const adnotariInPlus = adnotari.filter((t: any) => t.diametru_mm && !acoperitDeTabel.has(cheieDM(t)))
    .map((t: any) => ({ ...t, doar_adnotare: true }));
  const pentruCantitati = dinTabel.length ? [...dinTabel, ...adnotariInPlus] : [...unice];
  const adnotariNeconfirmate = adnotari.filter((t: any) => !adnotariInPlus.some((a: any) => a === t || (a.de_la === t.de_la && a.la === t.la && a.lungime_m === t.lungime_m)));
  // Diametre nominale reale (PE SR EN 1555 + OL DN). Orice altceva = citire greșită probabilă (debit, Di, viteză)
  // => NU intră în cantități, se raportează „de verificat".
  const DN_STANDARD = new Set([16,20,25,32,40,50,63,65,75,80,90,100,110,125,140,150,160,180,200,225,250,280,300,315,350,355,400,450,500,560,600,630,700,800]);
  const nestandard = pentruCantitati.filter((t: any) => t.diametru_mm && !DN_STANDARD.has(Number(t.diametru_mm)));
  if (nestandard.length) {
    const deScos = new Set(nestandard);
    pentruCantitati.splice(0, pentruCantitati.length, ...pentruCantitati.filter((t: any) => !deScos.has(t)));
  }
  // 25.09.2026 (audit T5/T6): similaritatea lungimilor e AVERTISMENT, nu deduplicare — nu se scoate nimic din total.
  const avertismente: string[] = [];
  for (const a of adnotariInPlus) {
    const gem = dinTabel.find((t: any) => Math.abs(Number(t.lungime_m) - Number(a.lungime_m)) <= 1);
    if (gem) avertismente.push(`Adnotarea Dn${a.diametru_mm} ${a.lungime_m} m (${a._zona || '?'}) are aceeași lungime ca rândul din tabel Dn${gem.diametru_mm} ${gem.de_la ?? '?'}→${gem.la ?? '?'} — posibil același tronson, numărat de două ori`);
  }
  const grupe = new Map<string, number>();
  for (const t of dinTabel) { const k = `${t.lungime_m}|${t.diametru_mm}`; grupe.set(k, (grupe.get(k) || 0) + 1); }
  const repetate = [...grupe.entries()].filter(([, n]) => n > 1);
  if (repetate.length) avertismente.push(`${repetate.length} grupuri de rânduri din tabel au aceeași lungime și același Dn (ex. ${repetate.slice(0, 3).map(([k, n]) => `${k.replace('|', ' m Dn')} ×${n}`).join(', ')}) — pot fi tronsoane reale diferite sau rânduri citite de două ori; neverificat`);
  if (!pentruCantitati.some((t: any) => t.material)) avertismente.push('Materialul (PE/OL, SDR) nu apare pe niciun tronson citit — nu se completează din presupuneri');
  const nrPlansa = toate.map((r: any) => r?.cartus?.plansa_nr).find(Boolean) ||
    doc.analiza?.cartus?.plansa_nr || null;
  const sumar: Record<string, unknown> = {
    felii_citite: toate.length,
    tronsoane_gasite: pentruCantitati.length,
    tronsoane_brute: brute.length,
    adnotari_lasate_deoparte: adnotariNeconfirmate.length,
    ...(nestandard.length ? { diametre_nestandard: [...new Set(nestandard.map((t: any) => Number(t.diametru_mm)))].sort((a, b) => a - b),
      nestandard_m: +nestandard.reduce((q: number, t: any) => q + (Number(t.lungime_m) || 0), 0).toFixed(1) } : {}),
    adnotari_numarate_in_plus: adnotariInPlus.length,
    adnotari_neconfirmate_m: +adnotariNeconfirmate.reduce((s: number, t: any) => s + (Number(t.lungime_m) || 0), 0).toFixed(1),
    lungime_totala_m: +pentruCantitati.reduce((s: number, t: any) => s + t.lungime_m, 0).toFixed(1),
    tabele: [...new Set(toate.flatMap((r: any) => (r.tabele || []).map((t: any) => t.denumire)).filter(Boolean))],
    subtraversari: toate.flatMap((r: any) => r.subtraversari || []).length,
    bransamente: toate.flatMap((r: any) => r.bransamente || []).length,
    erori: toate.filter((r: any) => r.eroare).length,
    zone_cazute: toate.filter((r: any) => r.eroare).map((r: any) => r.eticheta),
    avertismente,
    validat: false, // totalurile din citirea pe zone rămân NEVALIDATE până la reconcilierea cu memoriul/F3
    ...(zoneLipsa.length ? { zone_lipsa: zoneLipsa } : {}),
    ...(plansa.rezolutie_redusa ? { rezolutie_redusa: plansa.rezolutie_redusa } : {}),
  };

  // Cand s-a citit toata plansa, cifrele trec singure in cantitati. Daca pasul asta
  // crapa, citirea (partea scumpa) tot se salveaza — eroarea se raporteaza, nu se arunca.
  //
  // DAR numai daca TOATE feliile au fost citite. Pana la 11.09.2026 conditia era doar `gata`:
  // o felie esuata nu aduce niciun tronson, deci totalul iesea scurt — si era comparat cu
  // memoriul ca si cum ar fi complet, producand o diferenta FALSA care arata exact ca una
  // reala. Mai bine nu transferam si spunem de ce, decat sa dam o cifra in care nu se poate
  // avea incredere. Feliile esuate se pot relua, citirea deja platita nu se pierde.
  let cantitati: unknown = null;
  if (gata && zoneLipsa.length) {
    cantitati = { amanat: `${zoneLipsa.length} zone din planșă lipsesc din storage (${zoneLipsa.slice(0, 6).join(', ')}) — ` +
      `cifrele NU s-au trecut in cantitati. Retaie planșa („recitește") și citește din nou.` };
    sumar.cantitati = cantitati;
  } else if (gata && sumar.erori) {
    cantitati = { amanat: `${sumar.erori} feli${sumar.erori === 1 ? 'e' : 'i'} n-au putut fi citite — ` +
      `cifrele NU s-au trecut in cantitati, fiindca totalul ar fi incomplet si ar arata ca o diferenta reala. ` +
      `Apasă „🔁 reia zonele căzute” (se citesc doar zonele căzute) și transferul se face singur.` };
    sumar.cantitati = cantitati;
  } else if (gata) {
    try {
      cantitati = await treciInCantitati(supa, doc, pentruCantitati, nrPlansa);
    } catch (e) {
      cantitati = { eroare: String((e as Error)?.message || e).slice(0, 200) };
    }
    sumar.cantitati = cantitati;
  }

  // 25.09.2026 (bug Răzvan, lic. 95): citirea se salva doar în `analiza`, iar documentul rămânea
  // „neprocesat" fără text — Rezumatul îl număra la „rămase de citit" și UI-ul oferea recitire plătită.
  // La final: procesat + text_extras (randare text a citirii, pt cerințe/clarificări/căutare);
  // dacă TOATE feliile au căzut: eroare. Pe runde intermediare statusul nu se atinge.
  const metrici = [...(existente.length ? (ca0?.metrici || []) : []), { ...metricaRunda, mod: mod || 'complet' }];
  if (gata) sumar.metrici = {
    runde: metrici.length, paralel: [...new Set(metrici.map((m: any) => m.paralel))],
    durata_s: Math.round(metrici.reduce((q: number, m: any) => q + m.durata_ms, 0) / 1000),
    reincercari: metrici.reduce((q: number, m: any) => q + m.reincercari, 0),
    limitari: metrici.flatMap((m: any) => m.limitari).length,
    cost_usd: +metrici.reduce((q: number, m: any) => q + m.cost_usd, 0).toFixed(3),
  };
  // proveniența rulării (T11): ce tăiere, ce versiune de cod/prompt, ce model
  const promptSha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(INSTRUCTIUNI))))
    .slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const versiune = { functie: 'ofertare-plansa-citeste', cod: COD_VERSIUNE, model: MODEL, prompt_sha: promptSha,
    fisier: doc.nume_original, pagina: 1, dpi: plansa.dpi || null, cale_felii: plansa.cale_felii, taiat_la: plansa.taiat_la || null };
  const citireAi = { felii: toate, sumar, tronsoane_unice: unice, metrici, model: MODEL, versiune, taiat_la: plansa.taiat_la || null,
    gata, actualizat: new Date().toISOString() };
  const upd: Record<string, unknown> = { analiza: { ...doc.analiza, citire_ai: citireAi }, analiza_la: new Date().toISOString() };
  // 25.09.2026 (audit țintit): PL1–PL4 Vâlcelele au fost „citite" pe sigla semnăturii (900x450) și au ieșit
  // procesat fără eroare — butoanele le socoteau citite. O sursă sub 2000px pe latura mare nu e o planșă:
  // rezultatul NU poate fi „procesat".
  const prea_mica = !plansa.vectorial && Math.max(Number(plansa.latime) || 0, Number(plansa.inaltime) || 0) > 0 &&
    Math.max(Number(plansa.latime) || 0, Number(plansa.inaltime) || 0) < 2000;
  if (gata && prea_mica) {
    upd.status_procesare = 'eroare';
    upd.eroare = `Nu s-a citit desenul: sursa are doar ${plansa.latime}x${plansa.inaltime}px (probabil sigla semnăturii). Retaie planșa („citește") — PDF-ul vectorial se randează acum.`;
  } else if (gata) {
    if (toate.length && (sumar.erori as number) >= toate.length) {
      upd.status_procesare = 'eroare';
      upd.eroare = `Citire planșă eșuată pe toate cele ${toate.length} zone: ` + String(toate.find((r: any) => r.eroare)?.eroare || '').slice(0, 200);
    } else {
      // 25.09.2026 (audit T3): zone căzute => 'partial', nu 'procesat' (stare onestă; se reiau doar ele)
      upd.status_procesare = (sumar.erori as number) || zoneLipsa.length ? 'partial' : 'procesat';
      upd.text_extras = textPlansa(doc.nume_original, citireAi);
      // 25.09.2026: citită dar nimic extras (0 tronsoane, 0 tabele, 0 m) — rămâne procesat, dar marcat
      // ca să fie interogabil și UI-ul să ofere „recitește fin".
      const gol = !(sumar.tronsoane_gasite as number) && !(sumar.tabele as unknown[]).length && !(sumar.lungime_totala_m as number)
      upd.eroare = zoneLipsa.length ? `${zoneLipsa.length} zone lipsă (retaie planșa)` : sumar.erori ? `${sumar.erori} zone căzute — „🔁 reia zonele căzute”` : gol ? 'citită fără rezultat' : null;
      upd.procesat_la = new Date().toISOString();
    }
  }
  await supa.from('ofertare_documente_atribuire').update(upd).eq('id', docId);

  // 25.09.2026: planșă citită dar inutilizabilă (nimic extras / toate zonele căzute) => ciornă AUTOMATĂ de
  // clarificare (idempotentă, o ciornă per licitație pe lot; NU se trimite nimic). Rulează aici, server-side,
  // indiferent cine a apăsat butonul. Eșecul ei nu strică citirea.
  let clarificare: unknown = null;
  if (gata && (upd.status_procesare === 'eroare' || upd.eroare === 'citită fără rezultat')) {
    try {
      const { data, error } = await supa.rpc('ofertare_clarificare_planse_auto', { p_licitatie_id: doc.licitatie_id });
      clarificare = error ? { eroare: error.message } : data;
    } catch (e) { clarificare = { eroare: String((e as Error)?.message || e).slice(0, 120) }; }
  }

  return json({
    document: doc.nume_original, citite_acum: lot.length, din: felii.length, sumar, cantitati,
    cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4),
    clarificare, continua: maiSunt && lot.length > 0, de_la_urmator: gata ? null : deLa + lot.length,
    reincercate: mod === 'reia_erori' ? [...sari, ...inLot] : undefined, zone_cazute: sumar.zone_cazute,
    lipire_necesara: gata ? perechiDeLipit(toate, peStorage).slice(0, MAX_PERECHI).length : 0,
  });
}

// Testele setează POARTA_TEST=1 ca importul să nu pornească serverul (import.meta.main nu e garantat în edge runtime).
if (!Deno.env.get('POARTA_TEST')) Deno.serve((req: Request) => handler(req, depsReale()));
