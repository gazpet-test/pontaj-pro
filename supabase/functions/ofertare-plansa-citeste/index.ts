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

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = 'claude-opus-5';   // plansele cer citire vizuala buna; restul modulului foloseste Sonnet
const PRET_IN = 5 / 1e6, PRET_OUT = 25 / 1e6;
const FELII_PE_RULARE = 4;
const PARALEL = 2;

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
- In "zona" pune localitatea/satul/strada de pe randul respectiv, daca tabelul le are.
- Lungimile trec-le in METRI (daca pe plansa scrie km, inmulteste cu 1000 si da valoarea in metri).
- Foloseste punctul ca separator zecimal in JSON si NU folosi separator de mii (scrie 4800, nu 4.800).
- Diametrul da-l ca numar in mm (Dn250 -> 250).
- Daca o sectiune nu apare in aceasta bucata, las-o lista goala sau null. E normal: fiecare bucata vede doar o parte.
- Daca un tabel e taiat de marginea bucatii, transcrie randurile intregi pe care le vezi si atat.
- Nu inventa valori pe care nu le poti citi clar.`;

async function citesteFelie(apiKey: string, jpeg: Uint8Array, eticheta: string) {
  let binar = '';
  const bloc = 8192;
  for (let i = 0; i < jpeg.length; i += bloc) {
    binar += String.fromCharCode(...jpeg.subarray(i, i + bloc));
  }
  const b64 = btoa(binar);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: INSTRUCTIUNI,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: `Bucata ${eticheta} din plansa. Extrage ce se vede.` },
        ],
      }],
    }),
  });
  const j = await r.json();
  const tin = j?.usage?.input_tokens || 0, tout = j?.usage?.output_tokens || 0;
  const txt = j?.content?.[0]?.text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { eticheta, eroare: (j?.error?.message || txt || 'raspuns gol').slice(0, 200), _tin: tin, _tout: tout };
  try {
    return { eticheta, ...JSON.parse(m[0]), _tin: tin, _tout: tout };
  } catch (e) {
    return { eticheta, eroare: 'JSON invalid: ' + String((e as Error)?.message).slice(0, 120), _tin: tin, _tout: tout };
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

// Cantitatile deja existente vin din memoriu (partea scrisa). Plansa da a doua sursa
// pentru aceleasi diametre, deci nu duplicam pozitii: completam `cantitate_plansa` si
// notam diferenta. Pozitia se adauga doar daca diametrul nu exista deloc in oferta.
async function treciInCantitati(supa: any, doc: any, tronsoane: any[], nrPlansa: string | null) {
  const peDiametru = new Map<number, { m: number; n: number; zone: Set<string> }>();
  for (const t of tronsoane) {
    if (!t.diametru_mm) continue;
    const g = peDiametru.get(t.diametru_mm) || { m: 0, n: 0, zone: new Set<string>() };
    g.m += t.lungime_m; g.n += 1;
    const z = String(t.zona || t.de_la || '').trim();
    if (z) g.zone.add(z);
    peDiametru.set(t.diametru_mm, g);
  }
  if (!peDiametru.size) return { adaugate: 0, actualizate: 0, pe_diametre: {} };

  const eticheta = nrPlansa ? `Planșa ${nrPlansa}` : `Planșa „${doc.nume_original}”`;
  const { data: existente } = await supa.from('ofertare_cantitati')
    .select('id, denumire, categorie, cantitate, status')
    .eq('licitatie_id', doc.licitatie_id);
  const retea = (existente || []).filter((r: any) => r.categorie === 'Rețea distribuție');

  let adaugate = 0, actualizate = 0;
  const peDiametreRaport: Record<string, number> = {};

  for (const [dn, g] of [...peDiametru.entries()].sort((a, b) => b[0] - a[0])) {
    const m = +g.m.toFixed(1);
    peDiametreRaport[`Dn${dn}`] = m;
    const potrivit = retea.find((r: any) =>
      new RegExp(`(?:\\bdn|\\bde|ø|Ø|φ)\\s*${dn}\\b`, 'i').test(faraDiacritice(r.denumire || '')) &&
      !/tub|protec/i.test(faraDiacritice(r.denumire || '')));

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
        categorie: 'Rețea distribuție',
        denumire: `Conductă distribuție gaze Dn${dn}`,
        um: 'm', cantitate: m, cantitate_plansa: m,
        status: 'extras', extras_de_ai: true,
        sursa: `${eticheta} — tabel de dimensionare, citit automat din scanare`,
        specificatii: [...g.zone].slice(0, 12).join(', ') || `${g.n} tronsoane`,
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

  return { adaugate, actualizate, total_m: total, pe_diametre: peDiametreRaport };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!API_KEY) return json({ error: 'lipseste ANTHROPIC_API_KEY' }, 500);
  const supa = createClient(SUPA_URL, SERVICE);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  if (jwt !== SERVICE) {
    const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: u } = await anon.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'unauthorized' }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const docId = Number(body?.doc_id);
  const deLa = Number(body?.de_la) || 0;
  if (!docId) return json({ error: 'doc_id lipsa' }, 400);

  const { data: doc } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, analiza').eq('id', docId).single();
  if (!doc) return json({ error: 'document inexistent' }, 404);

  const plansa = doc.analiza?.plansa;
  if (!plansa?.cale_felii) return json({ error: 'plansa nu e taiata in felii — ruleaza intai /api/plansa-felii' }, 400);
  if (plansa.citibila === false) return json({ error: 'plansa a fost marcata drept necitibila', motiv: plansa.motiv }, 400);

  const { data: fisiere, error: eList } = await supa.storage.from('ofertare').list(plansa.cale_felii, { limit: 100 });
  if (eList) return json({ error: eList.message }, 500);
  const felii = (fisiere || []).filter((f: any) => f.name.endsWith('.jpg')).sort((a: any, b: any) => a.name.localeCompare(b.name));
  if (!felii.length) return json({ error: 'nicio felie in storage' }, 404);

  const lot = felii.slice(deLa, deLa + FELII_PE_RULARE);
  const rezultate: any[] = [];
  for (let i = 0; i < lot.length; i += PARALEL) {
    const grup = lot.slice(i, i + PARALEL);
    const parti = await Promise.all(grup.map(async (f: any) => {
      const { data: bin, error } = await supa.storage.from('ofertare').download(`${plansa.cale_felii}/${f.name}`);
      if (error || !bin) return { eticheta: f.name, eroare: error?.message || 'descarcare esuata' };
      return await citesteFelie(API_KEY, new Uint8Array(await bin.arrayBuffer()), f.name.replace('.jpg', ''));
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

  const gata = deLa + lot.length >= felii.length;
  const precedente = deLa === 0 ? [] : (doc.analiza?.citire_ai?.felii || []);
  const toate = [...precedente, ...rezultate];

  // sumar peste tot ce s-a citit pana acum, ca sa se vada imediat ce a iesit.
  // Se numara tronsoanele UNICE: cu suprapunerea dintre felii, acelasi rand apare de
  // doua ori si totalul ar iesi umflat.
  const brute = toate.flatMap((r: any) => r.tronsoane || []);
  const unice = tronsoaneUnice(brute);
  const nrPlansa = toate.map((r: any) => r?.cartus?.plansa_nr).find(Boolean) ||
    doc.analiza?.cartus?.plansa_nr || null;
  const sumar: Record<string, unknown> = {
    felii_citite: toate.length,
    tronsoane_gasite: unice.length,
    tronsoane_brute: brute.length,
    lungime_totala_m: +unice.reduce((s: number, t: any) => s + t.lungime_m, 0).toFixed(1),
    tabele: [...new Set(toate.flatMap((r: any) => (r.tabele || []).map((t: any) => t.denumire)).filter(Boolean))],
    subtraversari: toate.flatMap((r: any) => r.subtraversari || []).length,
    bransamente: toate.flatMap((r: any) => r.bransamente || []).length,
    erori: toate.filter((r: any) => r.eroare).length,
  };

  // Cand s-a citit toata plansa, cifrele trec singure in cantitati. Daca pasul asta
  // crapa, citirea (partea scumpa) tot se salveaza — eroarea se raporteaza, nu se arunca.
  let cantitati: unknown = null;
  if (gata) {
    try {
      cantitati = await treciInCantitati(supa, doc, unice, nrPlansa);
    } catch (e) {
      cantitati = { eroare: String((e as Error)?.message || e).slice(0, 200) };
    }
    sumar.cantitati = cantitati;
  }

  await supa.from('ofertare_documente_atribuire').update({
    analiza: { ...doc.analiza, citire_ai: { felii: toate, sumar, tronsoane_unice: unice, model: MODEL, gata, actualizat: new Date().toISOString() } },
    analiza_la: new Date().toISOString(),
  }).eq('id', docId);

  return json({
    document: doc.nume_original, citite_acum: lot.length, din: felii.length, sumar, cantitati,
    cost_usd: +(tin * PRET_IN + tout * PRET_OUT).toFixed(4),
    continua: !gata, de_la_urmator: gata ? null : deLa + lot.length,
  });
});
