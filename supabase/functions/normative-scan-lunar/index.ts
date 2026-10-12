// normative-scan-lunar — o data pe luna verifica daca normativele critice din modulul
// Ofertare s-au modificat/abrogat, cu Claude + cautare web. DOAR SEMNALEAZA: mail +
// nota pe rand + stare NECONFIRMAT la semnal nou; nu rescrie citari singur.
//
// v10 (12.10.2026) — SCAN IN BUCATI. v9 facea toate loturile intr-o singura invocare si era
// omorata la limita EdgeRuntime.waitUntil (~400s; 37 acte = 7 loturi × Opus + cautari).
// Acum: o invocare = UN lot (apelul AI taiat la 240s), progresul in public.normative_scan_rulari,
// iar functia se reapeleaza singura pentru lotul urmator (x-norm-secret). Plasa de siguranta:
// cronul normative_scan_continua (la 10 min) o reporneste DOAR cat exista o rulare deschisa
// blocata. Mail + note DOAR dupa ultimul lot.
// Idempotenta (in baza, prin RPC-uri cu UPDATE conditionat — vezi migrarea 20261025b, r2 dupa Copilot):
//  - o singura rulare deschisa per mod (test / real); pornirea dubla o reia pe cea existenta;
//  - un lot se ia cu „lease” (6 min) + token de proprietar; salvarea/eliberarea cer tokenul curent si lot_curent neschimbat;
//    esec trecator AI (timeout/429/5xx) → lease eliberat, lotul se reia (max. 3), abia apoi „necunoscut”;
//  - finalul se ia cu lease separat + token (o invocare intarziata nu poate confirma/elibera lease-ul alteia):
//    note scrise (garda SCAN <azi> per rand) → note_la → mail
//    (Idempotency-Key per rulare la Resend) → mail_la + finalizat; esec mail → reincercare, max. 3.
//
// Cereri (toate cu x-norm-secret, POST):
//  - corp gol / {}           → porneste (sau reia) rularea reala; ?test=1 → rularea de test
//  - {"run_id": N}           → continua rularea N (apelul in lant)
//  - {"continua": true}      → continua rularea blocata aleasa de fn_norm_scan_blocata() (cronul-plasa)
// Identitate: service_role (citeste ofertare_normative, scrie note pe randuri + tabelul de rulari;
// RLS nu acopera un job de sistem). Continut extern: raspunsul modelului + paginile cautate — tratat
// ca date: doar note text si stare NECONFIRMAT, mail doar catre DESTINATARI ficsi.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  ultimulScan, inventarLot, extrageJSON, leagaLot, egalConstant, nrLoturi, idsLot, ordoneazaDupaIds,
  faraRand, lotSarit, urmatorulPas, areNotaScan, linieNota, construiesteMail, grupeaza, esteTranzitoriu,
} from './logic.js';

const DESTINATARI = ['razvan.trusu@gazpet.ro'];
const MARIME_LOT = 6;
const CAUTARI_PE_LOT = 8;
const MAX_ACTE = 40;
const LEASE_SEC = 360;          // > timeout AI + salvare; un lot omorat se reia dupa expirare
const TIMEOUT_AI_MS = 240_000;  // sub limita waitUntil, cu rezerva pentru salvare + lant
const MAX_INCERCARI_LOT = 3;    // 3 incercari esuate/omorate pe acelasi lot → lotul iese „necunoscut”
const LEASE_FINAL_SEC = 180;    // note (secunde) + un apel Resend
const MAX_INCERCARI_MAIL = 3;   // apoi stare mail_esuat (rularea nu ramane deschisa la nesfarsit)
const COLOANE = 'id, identificator, tip, numar, titlu, modificari_ulterioare, stare, prioritate, note';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

type Supa = ReturnType<typeof createClient>;

async function rpc(supa: Supa, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supa.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as any;
}

async function porneste(supa: Supa, test: boolean) {
  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());
  const { data: norme, error } = await supa.from('ofertare_normative').select(COLOANE)
    .or('prioritate.in.(CRITIC,IMPORTANT,ACTUALIZARE),stare.neq.în vigoare')
    .order('prioritate').order('id');
  if (error) throw new Error('ofertare_normative: ' + error.message);
  const lista = (norme || []).slice(0, MAX_ACTE);
  return await rpc(supa, 'fn_norm_scan_porneste', {
    p_test: test, p_azi: azi, p_ref_scan: ultimulScan(norme || []),
    p_acte: lista.map((n: any) => n.id), p_marime: MARIME_LOT, p_nr_loturi: nrLoturi(lista.length, MARIME_LOT),
  });
}

// Un lot: AI + cautari, cu timeout. Intoarce verdictele (fara randuri), erorile si consumul.
async function scaneazaLot(lot: any[], k: number, r: any) {
  const nume = `lot ${k + 1}/${r.nr_loturi}`;
  const prompt =
    `Ești juristul de achiziții al unui constructor român de conducte de gaz. Azi e ${r.azi}. ` +
    (r.ref_scan ? `Ultima verificare a fost pe ${r.ref_scan}. ` : 'Nu există o verificare anterioară înregistrată. ') +
    `Verifică pe surse oficiale/secundare de încredere (legislatie.just.ro, Lege5, anre.ro, asro.ro, Monitorul Oficial) ` +
    `dacă actele/standardele de mai jos au fost MODIFICATE, ABROGATE sau ÎNLOCUITE față de forma cunoscută. ` +
    `Fă cel puțin o căutare pentru fiecare act. Nu specula.\n\n${inventarLot(lot)}\n\n` +
    `Verdict, pentru fiecare act:\n` +
    `- "schimbare_noua": un act modificator/abrogator publicat DUPĂ ultima verificare (sau, fără verificare anterioară, absent din forma cunoscută și recent);\n` +
    `- "forma_incompleta": forma cunoscută omite modificări mai vechi, publicate ÎNAINTE de ultima verificare (gol vechi, nu noutate);\n` +
    `- "neschimbat": confirmat fără modificări față de forma cunoscută;\n` +
    `- "necunoscut": nu ai găsit confirmare clară.\n` +
    `Răspunde STRICT cu un array JSON, fără alt text: ` +
    `[{"id":<id-ul din listă, număr>,"verdict":"schimbare_noua|forma_incompleta|neschimbat|necunoscut",` +
    `"tip":"modificat|abrogat|inlocuit|null","data_act":"YYYY-MM-DD sau null (data publicării actului modificator)","detalii":"o frază"}] ` +
    `— câte un element pentru FIECARE id din listă. Copiază id-ul exact.`;
  // tranzitoriu = esec care merita reincercat (timeout, retea, 429, 5xx) — vezi avanseaza()
  const out = { verdicte: [] as any[], erori: [] as string[], cautari: 0, tokIn: 0, tokOut: 0, tranzitoriu: false };
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5', max_tokens: 16000,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: CAUTARI_PE_LOT }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) { out.tranzitoriu = esteTranzitoriu(resp.status); out.erori.push(`${nume}: ` + JSON.stringify(j).slice(0, 200)); out.verdicte = faraRand(leagaLot([], lot, r.ref_scan)); return out; }
    out.tokIn = j.usage?.input_tokens || 0; out.tokOut = j.usage?.output_tokens || 0;
    out.cautari = j.usage?.server_tool_use?.web_search_requests || 0;
    if (j.stop_reason === 'refusal') { out.erori.push(`${nume}: refusal`); out.verdicte = faraRand(leagaLot([], lot, r.ref_scan)); return out; }
    // textul NU e neaparat content[0] — thinking/cautari stau inainte (anti-bug verificat)
    const brut = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    const arr = extrageJSON(brut);
    if (!arr) out.erori.push(`${nume}: fără JSON: ` + brut.slice(0, 150));
    out.verdicte = faraRand(leagaLot(arr || [], lot, r.ref_scan));
  } catch (e) {
    // timeout (AbortSignal) sau retea
    out.tranzitoriu = true;
    out.erori.push(`${nume}: ` + String((e as Error)?.message || e).slice(0, 200));
    out.verdicte = faraRand(leagaLot([], lot, r.ref_scan));
  }
  return out;
}

// Reapelare pentru lotul urmator. Gateway-ul raspunde imediat (munca e in waitUntil).
// Daca apelul esueaza, cronul-plasa preia rularea.
async function inLant(runId: number) {
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/normative-scan-lunar`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', 'x-norm-secret': Deno.env.get('NORM_SCAN_SECRET')! },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch (e) {
    console.error('normative-scan-lunar: lant esuat, preia cronul-plasa', String((e as Error)?.message || e));
  }
}

// Finalul, cu lease separat (fn_norm_scan_ia_final). Ordinea e impusa si in baza:
// note scrise → note_la → mail acceptat de Resend → mail_la + finalizat. Orice esec elibereaza lease-ul
// (sau il lasa sa expire, daca invocarea moare), iar urmatoarea invocare reia de unde a ramas.
async function finalizeaza(supa: Supa, runId: number) {
  let f = await rpc(supa, 'fn_norm_scan_ia_final', { p_run: runId, p_lease_sec: LEASE_FINAL_SEC });
  if (!f) return; // finalul e in lucru la alta invocare, sau rularea e deja inchisa
  const token = f.final_token; // proprietarul lease-ului final: confirmarile cer exact acest token
  let mailOk = false;
  try {
    if (!f.test && !f.note_la) {
      // Reluabil: o nota SCAN <azi> deja prezenta pe rand nu se mai adauga; o numaram ca scrisa.
      const azi = f.azi;
      const g = grupeaza(f.verdicte || []);
      const deScris = [...g.schimbare_noua, ...g.forma_incompleta];
      const ids = deScris.map((v: any) => v.id);
      const { data: randuri, error } = ids.length
        ? await supa.from('ofertare_normative').select('id, note').in('id', ids)
        : { data: [] as any[], error: null };
      if (error) throw new Error('ofertare_normative note: ' + error.message);
      const noteDupaId = new Map((randuri || []).map((x: any) => [Number(x.id), x.note]));
      let notate = 0;
      for (const v of deScris) {
        if (!noteDupaId.has(Number(v.id))) continue;
        const notaVeche = noteDupaId.get(Number(v.id)) || '';
        if (areNotaScan(notaVeche, azi)) { notate++; continue; }
        const patch: Record<string, unknown> = { note: (notaVeche + '\n' + linieNota(v, azi)).trim(), updated_at: new Date().toISOString() };
        if (v.verdict === 'schimbare_noua') patch.stare = 'NECONFIRMAT — semnal scan ' + azi;
        const { error: e2 } = await supa.from('ofertare_normative').update(patch).eq('id', v.id);
        if (e2) throw new Error(`nota pe randul ${v.id}: ${e2.message}`); // reluam tot finalul (garda per rand)
        notate++;
      }
      const n = await rpc(supa, 'fn_norm_scan_note_gata', { p_run: runId, p_token: token, p_note_scrise: notate });
      if (!n) return; // lease pierdut intre timp: nu trimitem mail din aceasta invocare
      f = n;
    }
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('lipsa RESEND_API_KEY');
    const { subiect, html } = construiesteMail(f, f.note_scrise);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      // Idempotency-Key: daca Resend a acceptat dar n-am apucat sa marcam mail_la, reincercarea nu dubleaza mailul
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `normative-scan-${runId}` },
      body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to: DESTINATARI, subject: subiect, html }),
    });
    mailOk = r.ok;
    if (!r.ok) console.error('normative-scan-lunar: Resend', r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error('normative-scan-lunar: final', String((e as Error)?.message || e));
  }
  const m = await rpc(supa, 'fn_norm_scan_mail_rezultat', { p_run: runId, p_token: token, p_ok: mailOk, p_max: MAX_INCERCARI_MAIL });
  if (m?.stare === 'mail_esuat') console.error(`normative-scan-lunar: rularea ${runId} inchisa mail_esuat dupa ${MAX_INCERCARI_MAIL} incercari`);
}

// Un pas pe rularea data: un lot (si apoi lant) sau finalul.
async function avanseaza(supa: Supa, runId: number) {
  const r = await rpc(supa, 'fn_norm_scan_ia_lot', { p_run: runId, p_lease_sec: LEASE_SEC });
  if (!r) {
    // Nimic de luat: alt lot e in lucru (lease valid) sau loturile s-au terminat.
    const { data: cur } = await supa.from('normative_scan_rulari').select('id, stare, lot_curent, nr_loturi, mail_la').eq('id', runId).maybeSingle();
    if (urmatorulPas(cur) === 'final') await finalizeaza(supa, runId);
    return;
  }
  const k = r.lot_curent;
  const ids = idsLot(r.acte_ids, k, r.marime_lot);
  const { data: randuri, error } = await supa.from('ofertare_normative').select(COLOANE).in('id', ids);
  if (error) throw new Error('ofertare_normative: ' + error.message);
  const lot = ordoneazaDupaIds(randuri, ids);
  const nume = `lot ${k + 1}/${r.nr_loturi}`;
  // incercari_lot numara si invocarile omorate (lease expirat fara salvare): peste prag, lotul iese fara AI
  const rez = r.incercari_lot > MAX_INCERCARI_LOT
    ? { verdicte: lotSarit(lot, `lot sărit după ${MAX_INCERCARI_LOT} încercări`), erori: [`${nume}: sărit după ${MAX_INCERCARI_LOT} încercări`], cautari: 0, tokIn: 0, tokOut: 0, tranzitoriu: false }
    : await scaneazaLot(lot, k, r);
  if (rez.tranzitoriu && r.incercari_lot < MAX_INCERCARI_LOT) {
    // Esec trecator: nu salvam „necunoscut”, eliberam lotul si il reluam (lant imediat; plasa daca lantul cade)
    console.error(`normative-scan-lunar: ${nume} incercarea ${r.incercari_lot} esuata, se reia:`, rez.erori.join(' | '));
    const e = await rpc(supa, 'fn_norm_scan_elibereaza_lot', { p_run: runId, p_lot: k, p_token: r.lease_token, p_cautari: rez.cautari, p_tok_in: rez.tokIn, p_tok_out: rez.tokOut });
    if (e) await inLant(runId);
    return;
  }
  if (rez.tranzitoriu) rez.erori = rez.erori.map((x: string) => `${x} (după ${r.incercari_lot} încercări)`);
  const s = await rpc(supa, 'fn_norm_scan_salveaza_lot', {
    p_run: runId, p_lot: k, p_token: r.lease_token, p_verdicte: rez.verdicte, p_erori: rez.erori,
    p_cautari: rez.cautari, p_tok_in: rez.tokIn, p_tok_out: rez.tokOut,
  });
  if (!s) return; // lease-ul a fost preluat de alta invocare (token schimbat) sau lotul e deja salvat — nu dublam
  if (urmatorulPas(s) === 'lot') await inLant(runId);
  else if (urmatorulPas(s) === 'final') await finalizeaza(supa, runId);
}

async function proceseaza(cerere: { test: boolean; runId: number | null; continua: boolean }) {
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    let runId = cerere.runId;
    if (cerere.continua) {
      // Aceeasi functie ca in jobul-plasa: continuam EXACT rularea blocata care a declansat apelul.
      runId = await rpc(supa, 'fn_norm_scan_blocata', {});
    } else if (runId == null) {
      const r = await porneste(supa, cerere.test);
      runId = r?.id ?? null;
    }
    if (runId != null) await avanseaza(supa, Number(runId));
  } catch (e) {
    console.error('normative-scan-lunar:', String((e as Error)?.message || e));
  }
}

Deno.serve(async (req: Request) => {
  // Fara fallback: daca NORM_SCAN_SECRET lipseste, functia refuza tot.
  if (!egalConstant(req.headers.get('x-norm-secret') || '', Deno.env.get('NORM_SCAN_SECRET') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') return json({ error: 'doar POST' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'lipsa_ANTHROPIC_API_KEY' }, 500);
  let corp: any = {};
  try { const t = await req.text(); corp = t ? JSON.parse(t) : {}; } catch { return json({ error: 'corp invalid' }, 400); }
  const runId = corp?.run_id == null ? null : Number(corp.run_id);
  if (runId != null && !(Number.isInteger(runId) && runId > 0)) return json({ error: 'run_id invalid' }, 400);
  const cerere = { test: new URL(req.url).searchParams.get('test') === '1', runId, continua: corp?.continua === true };
  // @ts-ignore — EdgeRuntime exista in Supabase Edge
  EdgeRuntime.waitUntil(proceseaza(cerere));
  return json({ pornit: true, ...cerere, nota: 'un lot pe invocare; raportul vine pe mail dupa ultimul lot' });
});
