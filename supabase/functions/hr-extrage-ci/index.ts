// Citeste actul de identitate urcat in dosarul personal si propune datele care
// lipsesc din platforma (CNP, serie/nr CI, emitent, domiciliu). Sunt datele care
// se tiparesc pe adeverintele de legator de sarcina — pana acum se bateau de mana.
//
// Nimic din ce citeste modelul nu ajunge direct pe un document oficial. Totul
// aterizeaza in hr_ci_extrase ca propunere si trece prin ochiul unui om, fiindca
// greseala aici nu e o clasificare gresita: e CNP-ul altui om pe un act semnat de
// director si de operatorul RSVTI.
//
// Trei verificari se fac AICI, in cod, nu in prompt — modelul poate fi sigur si gresit:
//   1. CNP-ul trece cifra de control (algoritmul oficial). Un CNP citit prost pica.
//   2. Numele de pe document trebuie sa se potriveasca cu numele angajatului din
//      platforma. Doua acte scanate in acelasi PDF, sau un dosar in care a ajuns
//      buletinul sotiei — asa se prind.
//   3. Sub pragul de incredere nu se propune nimic.
// Ce pica una din verificari se scrie totusi, cu motivul, ca sa se vada de ce.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = 'claude-opus-5';
const PRET_IN = 5 / 1e6, PRET_OUT = 25 / 1e6;
const BUCKET = 'documente-personal';
const PARALEL = 3;
const BUGET_MS = 110_000;
const PRAG_IMPLICIT = 80;
const TIPURI_ACT = ['buletin', 'permis_sedere', 'pasaport'];

function b64(buf: Uint8Array) {
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(s);
}

// Cifra de control a CNP-ului (constanta oficiala 279146358279).
function cnpValid(cnp: string): boolean {
  if (!/^\d{13}$/.test(cnp)) return false;
  const c = '279146358279';
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(cnp[i]) * Number(c[i]);
  const r = s % 11;
  return Number(cnp[12]) === (r === 10 ? 1 : r);
}

// employees.name e "NUME_FAMILIE PRENUME"; pe act ordinea si diacriticele difera.
// Cerem sa se regaseasca fiecare cuvant lung din numele din platforma.
function normalizeaza(s: string) {
  return (s || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function numeSePotriveste(dinPlatforma: string, dePeAct: string): boolean {
  const a = normalizeaza(dinPlatforma).split(' ').filter((w) => w.length >= 3);
  const b = new Set(normalizeaza(dePeAct).split(' ').filter(Boolean));
  if (!a.length || !b.size) return false;
  const gasite = a.filter((w) => b.has(w)).length;
  return gasite >= Math.min(2, a.length) && gasite >= Math.ceil(a.length / 2);
}

const SYS = `Te uiti la actul de identitate al unui angajat dintr-o firma din Romania si scoti din el datele care se trec pe o adeverinta oficiala. Poate fi carte de identitate romaneasca, permis de sedere eliberat de Imigrari, sau pasaport.

Raspunde NUMAI cu JSON, fara text in jur:
{"nume": "<numele complet asa cum apare pe act>", "cnp": "<13 cifre, sau null>", "serie": "<seria, ex. MH, PH — null la permis/pasaport>", "numar": "<numarul documentului>", "eliberat_de": "<institutia emitenta, ex. SPCLEP ORSOVA>", "eliberat_la": "<DD.MM.YYYY>", "domiciliu": "<localitatea si judetul, asa cum scrie pe act>", "incredere": <0-100>, "ce_vad": "<3-8 cuvinte>"}

Reguli:
- Transcrii ce SCRIE pe document. Nu completezi, nu corectezi, nu ghicesti ce lipseste — daca un camp nu se vede sau nu exista pe acel tip de act, pui null.
- La cetatenii straini cu permis de sedere: CNP-ul poate lipsi sau poate fi un numar de identificare. Daca nu vezi 13 cifre clare, pui null.
- "domiciliu": doar localitatea, comuna/satul si judetul — nu strada, blocul si apartamentul.
- Daca in imagine sunt DOUA acte diferite (ex. si al sotului/sotiei), le raportezi pe cel mai lizibil si pui incredere sub 60.

Despre "incredere": cat de sigur esti chiar tu ca ai citit corect fiecare cifra. Un act taiat, intors, sters, fotografiat pe diagonala sau cu reflexii — sub 80. O cifra citita gresit dintr-un CNP inseamna un act oficial gresit, deci prefera sa spui ca nu esti sigur.`;

async function citeste(apiKey: string, mime: string, bin: Uint8Array) {
  let continut: any;
  if (mime === 'application/pdf') {
    continut = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(bin) } };
  } else if (mime.startsWith('image/')) {
    continut = { type: 'image', source: { type: 'base64', media_type: mime, data: b64(bin) } };
  } else {
    return { eroare: `tip nesuportat: ${mime}` };
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: SYS,
      messages: [{ role: 'user', content: [continut, { type: 'text', text: 'Ce scrie pe acest act?' }] }],
    }),
  });
  const j = await r.json();
  const tin = j?.usage?.input_tokens || 0, tout = j?.usage?.output_tokens || 0;
  const blocuri = Array.isArray(j?.content) ? j.content : [];
  const txt = blocuri.filter((c: any) => c?.type === 'text').map((c: any) => c.text || '').join('\n');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) {
    return { eroare: (j?.error?.message || `fara text (http ${r.status}, stop ${j?.stop_reason})`).slice(0, 200), _tin: tin, _tout: tout };
  }
  try {
    return { ...JSON.parse(m[0]), _tin: tin, _tout: tout };
  } catch (e) {
    return { eroare: 'JSON invalid: ' + String((e as Error)?.message).slice(0, 100), _tin: tin, _tout: tout };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!API_KEY) return json({ error: 'lipseste ANTHROPIC_API_KEY' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (jwt !== SERVICE) {
    if (!jwt) return json({ error: 'unauthorized' }, 401);
    const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: u } = await anon.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'unauthorized' }, 401);
    // datele de identitate se citesc doar de cine are voie sa le vada oricum
    const { data: p } = await createClient(SUPA_URL, SERVICE)
      .from('profiles').select('can_access_personal_data, is_owner').eq('id', u.user.id).maybeSingle();
    if (!p?.can_access_personal_data && !p?.is_owner) return json({ error: 'forbidden' }, 403);
  }
  const supa = createClient(SUPA_URL, SERVICE);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const doarProba = body?.dry_run === true;
  const prag = Number(body?.prag) || PRAG_IMPLICIT;
  const limita = Math.min(Number(body?.limita) || 10, 40);
  const empIds: number[] | null = Array.isArray(body?.employee_ids) ? body.employee_ids.map(Number) : null;

  // Cine are nevoie: legatorii activi fara propunere confirmata inca.
  let qEmp = supa.from('v_hr_adeverinte_legator_candidati').select('employee_id, angajat_nume');
  if (empIds) qEmp = qEmp.in('employee_id', empIds);
  const { data: candidati, error: eCand } = await qEmp;
  if (eCand) return json({ error: eCand.message }, 500);
  if (!candidati?.length) return json({ gata: true, mesaj: 'niciun candidat' });

  const { data: deja } = await supa.from('hr_ci_extrase')
    .select('employee_id').in('status', ['confirmat', 'propus']);
  const acoperiti = new Set((deja || []).map((x: any) => x.employee_id));
  const deLucru = candidati.filter((c: any) => empIds || !acoperiti.has(c.employee_id)).slice(0, limita);
  if (!deLucru.length) return json({ gata: true, mesaj: 'toti au deja o propunere sau o confirmare' });

  const { data: tipuri } = await supa.from('hr_documente_personale_tipuri')
    .select('id, cod').in('cod', TIPURI_ACT);
  const idTip = new Map((tipuri || []).map((t: any) => [t.id, t.cod]));

  const inceput = Date.now();
  const rezultate: any[] = [];

  for (let i = 0; i < deLucru.length; i += PARALEL) {
    if (Date.now() - inceput > BUGET_MS) break;
    const grup = deLucru.slice(i, i + PARALEL);
    const parti = await Promise.all(grup.map(async (c: any) => {
      // buletinul romanesc primeste prioritate: are toate campurile
      const { data: docs } = await supa.from('hr_documente_personale')
        .select('id, fisier_path, fisier_nume, fisier_mime, tip_id')
        .eq('employee_id', c.employee_id).is('deleted_at', null).eq('activ', true)
        .in('tip_id', Array.from(idTip.keys()))
        .order('uploadat_la', { ascending: false });
      if (!docs?.length) {
        return { employee_id: c.employee_id, nume: c.angajat_nume, eroare: 'nu are act de identitate urcat' };
      }
      const doc = docs.find((d: any) => idTip.get(d.tip_id) === 'buletin') || docs[0];

      const { data: bin, error } = await supa.storage.from(BUCKET).download(doc.fisier_path);
      if (error || !bin) {
        return { employee_id: c.employee_id, nume: c.angajat_nume, eroare: error?.message || 'descarcare esuata' };
      }
      const r: any = await citeste(API_KEY, doc.fisier_mime || '', new Uint8Array(await bin.arrayBuffer()));
      if (r.eroare) return { employee_id: c.employee_id, nume: c.angajat_nume, document_id: doc.id, ...r };

      const cnp = String(r.cnp || '').replace(/\D/g, '');
      const valid = cnp ? cnpValid(cnp) : false;
      const potrivire = numeSePotriveste(c.angajat_nume, r.nume || '');
      const incredere = Number(r.incredere) || 0;

      const motive: string[] = [];
      if (!potrivire) motive.push(`numele de pe act ("${String(r.nume || '—').slice(0, 40)}") nu se potriveste cu angajatul`);
      if (cnp && !valid) motive.push('CNP-ul nu trece cifra de control');
      if (!cnp) motive.push('fara CNP pe act');
      if (incredere < prag) motive.push(`incredere ${incredere}% sub pragul de ${prag}%`);

      return {
        employee_id: c.employee_id, nume: c.angajat_nume, document_id: doc.id,
        tip_act: idTip.get(doc.tip_id), fisier: doc.fisier_nume,
        nume_pe_document: r.nume || null, cnp: cnp || null,
        ci_serie: r.serie || null, ci_numar: r.numar || null,
        ci_eliberat_de: r.eliberat_de || null, ci_eliberat_la: r.eliberat_la || null,
        domiciliu: r.domiciliu || null,
        incredere, cnp_valid: valid, nume_se_potriveste: potrivire,
        bun: motive.length === 0,
        motiv_respingere: motive.length ? motive.join('; ') : null,
        ce_vad: r.ce_vad || null, _tin: r._tin, _tout: r._tout,
      };
    }));
    rezultate.push(...parti);
  }

  const tin = rezultate.reduce((s, r) => s + (r._tin || 0), 0);
  const tout = rezultate.reduce((s, r) => s + (r._tout || 0), 0);
  const cost = +(tin * PRET_IN + tout * PRET_OUT).toFixed(4);
  await supa.from('ai_usage_log').insert({
    function_name: 'hr-extrage-ci', model: MODEL, tokens_in: tin, tokens_out: tout,
    cost_usd: cost, ref_table: 'hr_ci_extrase', ref_id: null,
  });

  let scrise = 0;
  if (!doarProba) {
    const deScris = rezultate.filter((r) => !r.eroare).map((r) => ({
      employee_id: r.employee_id, document_id: r.document_id,
      nume_pe_document: r.nume_pe_document, cnp: r.cnp,
      ci_serie: r.ci_serie, ci_numar: r.ci_numar,
      ci_eliberat_de: r.ci_eliberat_de, ci_eliberat_la: r.ci_eliberat_la,
      domiciliu: r.domiciliu, incredere: r.incredere,
      cnp_valid: r.cnp_valid, nume_se_potriveste: r.nume_se_potriveste,
      motiv_respingere: r.motiv_respingere,
      status: 'propus',   // niciodata confirmat automat — asta o face un om
      model: MODEL,
    }));
    if (deScris.length) {
      const { error } = await supa.from('hr_ci_extrase').insert(deScris);
      if (!error) scrise = deScris.length;
    }
  }

  return json({
    dry_run: doarProba, prag,
    citite: rezultate.length,
    bune: rezultate.filter((r) => r.bun).length,
    de_verificat: rezultate.filter((r) => !r.bun && !r.eroare).length,
    erori: rezultate.filter((r) => r.eroare).length,
    scrise,
    cost_usd: cost,
    cost_estimat_78: +((cost / Math.max(1, rezultate.length)) * 78).toFixed(2),
    rezultate,
  });
});
