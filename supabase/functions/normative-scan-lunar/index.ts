// normative-scan-lunar — o data pe luna verifica daca normativele critice din modulul
// Ofertare s-au modificat/abrogat, cu Claude + cautare web. DOAR SEMNALEAZA: mail +
// nota pe rand + stare NECONFIRMAT la semnal nou; nu rescrie citari singur.
// Ruleaza IN FUNDAL (EdgeRuntime.waitUntil) — gateway-ul taie la 150s.
//
// v9 (01.10.2026):
//  - potrivirea verdictelor se face dupa ID-ul randului (modelul il primeste si il intoarce);
//  - verdict separat: schimbare_noua vs forma_incompleta (gol vechi in forma cunoscuta),
//    cu data ultimului scan ca referinta;
//  - mailul pune semnalele primele, separat;
//  - loturi de 6 + 8 cautari/lot (mai putine „necunoscut”);
//  - autentificare: DOAR env NORM_SCAN_SECRET, comparare in timp constant, fara fallback.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ultimulScan, inventarLot, extrageJSON, leagaLot, grupeaza, egalConstant } from './logic.js';

const DESTINATARI = ['razvan.trusu@gazpet.ro'];
const MARIME_LOT = 6;
const CAUTARI_PE_LOT = 8;
const MAX_ACTE = 40;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function ruleaza(test: boolean) {
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());

  const { data: norme } = await supa.from('ofertare_normative')
    .select('id, identificator, tip, numar, titlu, modificari_ulterioare, stare, prioritate, note')
    .or('prioritate.in.(CRITIC,IMPORTANT,ACTUALIZARE),stare.neq.în vigoare')
    .order('prioritate');
  const lista = (norme || []).slice(0, MAX_ACTE);
  const refScan = ultimulScan(norme || []);

  let verdicte: any[] = [];
  const eroriLot: string[] = [];
  let cautari = 0, tokIn = 0, tokOut = 0;

  for (let i = 0; i < lista.length; i += MARIME_LOT) {
    const lot = lista.slice(i, i + MARIME_LOT);
    const prompt =
      `Ești juristul de achiziții al unui constructor român de conducte de gaz. Azi e ${azi}. ` +
      (refScan ? `Ultima verificare a fost pe ${refScan}. ` : 'Nu există o verificare anterioară înregistrată. ') +
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
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-5', max_tokens: 16000,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: CAUTARI_PE_LOT }],
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const j = await r.json();
      if (!r.ok) { eroriLot.push(`lot ${i / MARIME_LOT + 1}: ` + JSON.stringify(j).slice(0, 200)); verdicte = verdicte.concat(leagaLot([], lot, refScan)); continue; }
      tokIn += j.usage?.input_tokens || 0; tokOut += j.usage?.output_tokens || 0;
      cautari += j.usage?.server_tool_use?.web_search_requests || 0;
      if (j.stop_reason === 'refusal') { eroriLot.push(`lot ${i / MARIME_LOT + 1}: refusal`); verdicte = verdicte.concat(leagaLot([], lot, refScan)); continue; }
      // textul NU e neaparat content[0] — thinking/cautari stau inainte (anti-bug verificat)
      const brut = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      const arr = extrageJSON(brut);
      if (!arr) eroriLot.push(`lot ${i / MARIME_LOT + 1}: fără JSON: ` + brut.slice(0, 150));
      verdicte = verdicte.concat(leagaLot(arr || [], lot, refScan));
    } catch (e) {
      eroriLot.push(`lot ${i / MARIME_LOT + 1}: ` + String((e as Error)?.message || e).slice(0, 200));
      verdicte = verdicte.concat(leagaLot([], lot, refScan));
    }
  }

  const g = grupeaza(verdicte);
  let notate = 0;
  if (!test) {
    for (const v of [...g.schimbare_noua, ...g.forma_incompleta]) {
      const nou = v.verdict === 'schimbare_noua';
      const linie = nou
        ? `⚠ SCAN ${azi}: ${v.tip || 'schimbare'}${v.data_act ? ' din ' + v.data_act : ''} — ${v.detalii.slice(0, 300)} (de validat pe M. Oficial)`
        : `ℹ SCAN ${azi}: forma cunoscută incompletă${v.data_act ? ' (act din ' + v.data_act + ')' : ''} — ${v.detalii.slice(0, 300)}`;
      const patch: Record<string, unknown> = { note: ((v.rand.note || '') + '\n' + linie).trim(), updated_at: new Date().toISOString() };
      if (nou) patch.stare = 'NECONFIRMAT — semnal scan ' + azi;
      const { error } = await supa.from('ofertare_normative').update(patch).eq('id', v.id);
      if (!error) notate++;
    }
  }

  // Cost aproximativ: Opus 5 $5/$25 per MTok + $10 / 1000 cautari
  const cost = tokIn * 5e-6 + tokOut * 25e-6 + cautari * 0.01;

  if (resendKey) {
    const culoare: Record<string, string> = { schimbare_noua: '#a32a21', forma_incompleta: '#b5651d', necunoscut: '#8a6d1a', neschimbat: '#17703c' };
    const tabel = (titlu: string, rows: any[]) => !rows.length ? '' :
      `<h3 style="margin:16px 0 6px;color:${culoare[rows[0].verdict]}">${esc(titlu)} (${rows.length})</h3>` +
      `<table style="border-collapse:collapse;font-size:13px">` + rows.map((v) =>
        `<tr><td style="padding:3px 10px 3px 0"><b>${esc(v.identificator)}</b></td>` +
        `<td style="padding:3px 10px 3px 0">${esc([v.tip, v.data_act].filter(Boolean).join(' · '))}</td>` +
        `<td style="padding:3px 0">${esc(v.detalii)}</td></tr>`).join('') + `</table>`;
    const nSemn = g.schimbare_noua.length;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'PontajPRO <rapoarte@gazpet.ro>', to: DESTINATARI,
        subject: `${test ? '[TEST] ' : ''}📜 Normative — ${nSemn ? nSemn + ' schimbări noi de verificat' : eroriLot.length ? 'scan cu erori' : 'nicio schimbare nouă'} (${lista.length} acte)`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:760px">` +
          `<h2 style="margin:0 0 4px">Scan lunar normative — Ofertare</h2>` +
          `<p style="margin:0 0 6px;color:#5a6975">${esc(azi)} · ${lista.length} acte · referință: ${esc(refScan || 'fără scan anterior')} · ` +
          `schimbări noi: ${nSemn} · forme incomplete: ${g.forma_incompleta.length} · necunoscut: ${g.necunoscut.length} · neschimbat: ${g.neschimbat.length}` +
          `${test ? ' · TEST: nimic scris în bibliotecă' : ' · note scrise: ' + notate}</p>` +
          `<p style="margin:0 0 10px;color:#5a6975;font-size:12px">${cautari} căutări web · ~$${cost.toFixed(2)}. Scanul doar semnalează — validează pe M. Oficial înainte de a schimba citările.</p>` +
          (nSemn ? tabel('🔴 Schimbări noi (după ultimul scan)', g.schimbare_noua) : `<p style="color:#17703c"><b>Nicio schimbare nouă după ${esc(refScan || 'ultima verificare')}.</b></p>`) +
          tabel('🟠 Forma cunoscută incompletă (goluri vechi, nu noutăți)', g.forma_incompleta) +
          tabel('🟡 Necunoscut', g.necunoscut) +
          tabel('🟢 Neschimbat', g.neschimbat) +
          (eroriLot.length ? `<p style="color:#a32a21">Erori AI: ${esc(eroriLot.join(' | '))}</p>` : '') +
          `<p style="margin:14px 0 0"><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Ofertare → Referințe → Normative</a></p>` +
          `<p style="color:#c0392b;font-size:12px;margin-top:16px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat.</p></div>`,
      }),
    });
  }
}

Deno.serve((req: Request) => {
  // Fara fallback: daca NORM_SCAN_SECRET lipseste, functia refuza tot.
  if (!egalConstant(req.headers.get('x-norm-secret') || '', Deno.env.get('NORM_SCAN_SECRET') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'lipsa_ANTHROPIC_API_KEY' }, 500);
  const test = new URL(req.url).searchParams.get('test') === '1';
  // @ts-ignore — EdgeRuntime exista in Supabase Edge
  EdgeRuntime.waitUntil(ruleaza(test));
  return json({ pornit: true, test, nota: 'raportul vine pe mail cand se termina (cateva minute)' });
});
