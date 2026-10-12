// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-clarificari-propune/core_test.ts
// R5 (Copilot 25.09.2026): cantitățile nevalidate nu pleacă spre model ca valori „din listă" / aprobate.
// Fixture = rândul REAL 1751 al lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { propuneClarificari, randCantitatePentruAI, sectiuneConflictePlanse } from './core.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

Deno.test('F02: generatorul persistă propunere, fără aprobare implicită', async () => {
  const baza = supaFals({ ofertare_licitatii: [{ id: 95, stare_loturi: 'fara_loturi' }], ofertare_cerinte: [{ id: 1, text_cerinta: 'Cerință verificabilă' }] });
  const scrise: any[] = [];
  const supa = { rpc: baza.rpc, from(t: string) {
    const b = baza.from(t);
    if (t === 'ofertare_clarificari') b.upsert = (rows: any[]) => {
      scrise.push(...rows);
      return { select: () => Promise.resolve({ data: [{ id: 1 }], error: null }) };
    };
    return b;
  } };
  const vechi = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
    clarificari: [{ subiect: 'Termenul de execuție', cerinte_ids: [1], referinta: 'Caiet, p. 2',
      fragment: 'Durata de execuție diferă între cele două secțiuni ale documentației.',
      intrebare: 'Vă rugăm să precizați durata de execuție aplicabilă în vederea pregătirii ofertei.', prioritate: 'importanta' }],
  }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))) as typeof fetch;
  try {
    const r = await propuneClarificari(supa, { licitatie_id: 95 });
    assertEquals(r.scrise, 1, JSON.stringify(r));
    assertEquals(scrise.length, 1);
    assertEquals([scrise[0].origine, scrise[0].status], ['platforma', 'propunere']);
  } finally { globalThis.fetch = vechi; }
});

const R1751 = { id: 1751, licitatie_id: 95, obiect: null, categorie: 'Conducte și montaj', denumire: 'Conductă distribuție gaze Dn200', um: 'm',
  cantitate: 17785, cantitate_plansa: 17785, status: 'extras', tip_sursa: null,
  sursa: 'Planșa 1 — tabel de dimensionare, citit automat din scanare',
  diferenta_nota: 'Diametru care nu apare în cantitățile din memoriu. 8 tronsoane citite din tabelul planșei.' }

Deno.test('R5: rândul 1751 (extras din planșă) nu mai pleacă drept „lista", ci cu proveniența și status_validat=false', () => {
  const x = randCantitatePentruAI(R1751)
  assertEquals(x.cantitate, 17785)
  assertEquals(x.sursa_cantitate, 'planșă (citire automată; cifra planșei copiată în cantitate)')
  assertEquals(x.status_validat, false)
  assertFalse('validat_de_om' in x, 'runda 4: numele vechi (înșelător — „validat” n-are autor) nu mai pleacă')
  assertEquals(x.status, 'extras')
  assertFalse('lista' in x, 'cheia „lista" dispare: cifra nu vine din F3')
})

Deno.test('R5: un rând F3 marcat validat în platformă e etichetat ca atare (status_validat, nu „validat de om”)', () => {
  const x = randCantitatePentruAI({ ...R1751, id: 1, tip_sursa: 'lista_f3', status: 'validat', sursa: 'F3 obiect 1' })
  assertEquals(x.sursa_cantitate, 'lista de cantități F3')
  assertEquals(x.status_validat, true)
})

Deno.test('R5: diferenta / revizuit_clarificare / status lipsă = NU marcat validat', () => {
  for (const s of ['diferenta', 'revizuit_clarificare', undefined]) assertEquals(randCantitatePentruAI({ ...R1751, status: s }).status_validat, false)
  assertEquals(randCantitatePentruAI({ ...R1751, sursa: 'memoriu, pag. 3' }).sursa_cantitate, 'nedeclarată')
})

// capăt-la-capăt, fără rețea: supabase simulat + fetch simulat care prinde promptul trimis la model (dry_run: nu scrie nimic)
function supaFals(tabele: Record<string, any[]>, erori: Record<string, string> = {}) {
  const selecturi: Record<string, string> = {}
  return {
    selecturi,
    // poarta pe loturi: implicit toate documentele din fixture (documente + planșele din conflicte) sunt eligibile (fara_loturi);
    // testele de loturi o înlocuiesc cu cuPoartaLot
    rpc: (n: string, _a?: any) => Promise.resolve(n === 'fn_ofertare_eligibilitate'
      ? { data: [...new Set([...(tabele.ofertare_documente_atribuire || []).map((d: any) => d.id), ...(tabele.v_ofertare_transfer_conflicte || []).map((c: any) => c.document_id)])]
          .map((id) => ({ document_id: id, eligibil: true, motiv: 'fara_loturi' })), error: null }
      : { data: null, error: { message: 'rpc neașteptat' } }),
    from(t: string) {
      let lim = Infinity, cuCount = false
      const b: any = {
        select: (s: string, o?: any) => { selecturi[t] = s; cuCount = !!o?.count; return b },
        eq: () => b, neq: () => b, is: () => b, not: () => b, in: () => b, order: () => b, range: () => b, limit: (n: number) => { lim = n; return b },
        single: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        then: (ok: any, ko: any) => Promise.resolve(erori[t] ? { data: null, error: { message: erori[t] } }
          : { data: (tabele[t] || []).slice(0, lim), error: null, ...(cuCount ? { count: (tabele[t] || []).length } : {}) }).then(ok, ko),
      }
      return b
    },
  }
}

Deno.test('R5 capăt-la-capăt: select-ul citește status, iar promptul nu mai conține „lista":17785', async () => {
  const supa = supaFals({
    ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1096479', autoritate: 'Comuna Vâlcelele', obiect: 'rețea gaze', stare_loturi: 'fara_loturi' }],
    ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Lungimea rețelei conform planșelor' }],
    ofertare_acoperire: [], ofertare_cantitati: [R1751], ofertare_verificari: [], ofertare_documente_atribuire: [], ofertare_clarificari: [],
  })
  let corp = ''
  const fetchVechi = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
    corp = String(init?.body || '')
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
  }) as typeof fetch
  try {
    const r = await propuneClarificari(supa, { licitatie_id: 95, dry_run: true })
    assert(r.ok, JSON.stringify(r))
  } finally { globalThis.fetch = fetchVechi }
  assert(/\bstatus\b/.test(supa.selecturi.ofertare_cantitati), 'select-ul pe ofertare_cantitati include status')
  const mesaj = JSON.parse(corp).messages[0].content as string
  assert(mesaj.includes('"status_validat":false'), 'modelul vede că 1751 e nevalidat')
  assertFalse(mesaj.includes('validat_de_om'), 'runda 4: niciun „validat_de_om” în payload')
  assert(mesaj.includes('"sursa_cantitate":"planșă (citire automată'), 'modelul vede proveniența din planșă')
  assertFalse(mesaj.includes('"lista":17785'), 'nicio cifră din planșă etichetată „lista"')
  const sistem = JSON.parse(corp).system[0].text as string
  assert(sistem.includes('status_validat: false'), 'promptul explică regula')
  assert(sistem.includes('MARCAT VALIDAT ÎN PLATFORMĂ') && sistem.includes('nu dovedește singur că un om a verificat'), 'runda 4: „validat” = marcaj în platformă, nu dovadă de om')
  assertFalse(sistem.includes('validat_de_om'))
})

// R5 condiția 2 (26.09.2026): limita de 40 de rânduri nu mai taie TACIT
Deno.test('R5 condiția 2: 45 de rânduri cu diferențe => promptul spune „40 din 45 — LISTA E TRUNCHIATĂ”; sub limită, nimic în plus', async () => {
  const rulare = async (n: number) => {
    const supa = supaFals({
      ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1096479', autoritate: 'Comuna Vâlcelele', obiect: 'rețea gaze', stare_loturi: 'fara_loturi' }],
      ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Lungimea rețelei conform planșelor' }],
      ofertare_acoperire: [], ofertare_cantitati: Array.from({ length: n }, (_, i) => ({ ...R1751, id: 1751 + i })), ofertare_verificari: [], ofertare_documente_atribuire: [], ofertare_clarificari: [],
    })
    let corp = ''
    const fetchVechi = globalThis.fetch
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
      corp = String(init?.body || '')
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
    }) as typeof fetch
    try { await propuneClarificari(supa, { licitatie_id: 95, dry_run: true }) } finally { globalThis.fetch = fetchVechi }
    return JSON.parse(corp).messages[0].content as string
  }
  const m45 = await rulare(45)
  assert(m45.includes('DIFERENȚE CANTITĂȚI / PLANȘE / DEVIZE (40 din 45 — LISTA E TRUNCHIATĂ: 5 rânduri cu diferențe NU sunt aici'), m45.slice(m45.indexOf('DIFERENȚE'), m45.indexOf('DIFERENȚE') + 160))
  const m3 = await rulare(3)
  assert(m3.includes('DIFERENȚE CANTITĂȚI / PLANȘE / DEVIZE (3; status_validat'), 'sub limită: fără mențiune')
})

// R5 sarcina 2 (a) + (c): conflictele transferului din planșe (fără rând) ajung la generator; citirea eșuată e spusă, nu înghițită
Deno.test('sarcina 2: conflictele transferului fără rând intră în prompt; view-ul lipsă => „NU AU PUTUT FI CITITE”, nu „niciunul”', async () => {
  const rulare = async (tabele: Record<string, any[]>, erori: Record<string, string> = {}) => {
    const supa = supaFals({ ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1096479', autoritate: 'Comuna Vâlcelele', obiect: 'rețea gaze', stare_loturi: 'fara_loturi' }],
      ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Lungimea rețelei conform planșelor' }], ofertare_acoperire: [], ofertare_cantitati: [],
      ofertare_verificari: [], ofertare_documente_atribuire: [], ofertare_clarificari: [], ...tabele }, erori)
    let corp = ''
    const fetchVechi = globalThis.fetch
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
      corp = String(init?.body || '')
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
    }) as typeof fetch
    try { await propuneClarificari(supa, { licitatie_id: 95, dry_run: true }) } finally { globalThis.fetch = fetchVechi }
    return JSON.parse(corp).messages[0].content as string
  }
  // doc 470 (lic. 95): după migrarea 2 (reparația rundei 1) — Dn60 nestandard, adnotări pe Dn absent, verificare indisponibilă — jurnal vechi (runda 9: „evaluare parțială (cod vechi)”);
  // 471: legacy_partial; 472: fără conflicte (închis)
  const m = await rulare({ v_ofertare_transfer_conflicte: [{ document_id: 470, nume_original: 'Schema tehnologica Valcelele alimentare din Stefan Voda.pdf', stare: 'conflicte', n: 3, deschis: true,
    restante: [{ tip: 'adnotari_dn_absent', n: 1 }, { tip: 'dn_nestandard', n: 1 }, { tip: 'evaluare_partiala', n: 1 }] },
    { document_id: 471, nume_original: 'PL5.pdf', stare: 'legacy_partial', n: 1, deschis: true, restante: [{ tip: 'evaluare_partiala', n: 1 }] },
    { document_id: 472, nume_original: 'PL4.pdf', stare: 'fara_conflicte', n: 0, deschis: false, restante: [] }] })
  const sec = m.slice(m.indexOf('STAREA TRANSFERULUI'), m.indexOf('STAREA TRANSFERULUI') + 2000)
  // ADDENDUM 2 Copilot (b): restanțe DISTINCTE, fiecare cu cauza și acțiunea; NICIUNA ca întrebare pentru autoritate
  assert(sec.startsWith('STAREA TRANSFERULUI DIN PLANȘE — RESTANȚE INTERNE ALE OFERTANTULUI (4 pe 2 planșe; NESCRISE în cantități). NU formula clarificări către autoritate din ele'), sec.slice(0, 200))
  assert(sec.includes('"restanta":"verificare indisponibilă (jurnal vechi)","n":2') && sec.includes('eroare internă de procesare — NU e o problemă a documentației'), sec)
  assert(sec.includes('"restanta":"Dn nestandard (în afara catalogului)","n":1,"cauza":"Dn citit care nu e în catalogul nostru de diametre — NU înseamnă că diametrul e imposibil"'), sec)
  assert(sec.includes('"restanta":"adnotări fără corespondent în tabel"') && sec.includes('NU neapărat un tronson suplimentar'), sec)
  assert(sec.includes('lungimile din conflicte sunt observații pe planșă (pot fi suprapuse), nu metri lipsă'), sec)
  assertFalse(/pot justifica o clarificare/.test(m), 'înainte: „pot justifica o clarificare de tip C” pentru toată lista')
  assertFalse(m.includes('PL4.pdf'), 'cele închise nu intră')
  const e = await rulare({}, { v_ofertare_transfer_conflicte: 'relation "public.v_ofertare_transfer_conflicte" does not exist' })
  assert(e.includes('STAREA TRANSFERULUI DIN PLANȘE (verificare INTERNĂ): NU A PUTUT FI CITITĂ (relation "public.v_ofertare_transfer_conflicte" does not exist) — nu presupune că nu există restanțe'))
  assertEquals(sectiuneConflictePlanse({ data: [], error: null }), 'STAREA TRANSFERULUI DIN PLANȘE (verificare INTERNĂ): nicio restanță deschisă.')
  // transfer amânat (eroare internă de procesare) — NU e prezentat ca problemă a documentației
  const am = sectiuneConflictePlanse({ data: [{ document_id: 1, nume_original: 'PL1.pdf', stare: 'neefectuat', n: 1, deschis: true, restante: [{ tip: 'transfer_amanat', n: 1 }] }], error: null })
  assert(am.includes('eroare internă de procesare — NU e o problemă a documentației: [{"restanta":"transfer amânat"') && am.includes('nu e o contradicție a documentației'), am)
})

// Poarta pe loturi (20261024b, review Jakarinos P1 #6): în CORE, deci și pe workerul NAS. Cerințele extrase înainte de
// blocarea documentelor nu mai pleacă la AI; licitația fără participare / poarta picată = niciun apel plătit.
const LIC_LOT = { id: 95, nr_anunt: 'CN1', autoritate: 'Comuna X', obiect: 'rețea gaze', stare_loturi: 'are_loturi' }
const CER_LOT = [
  { id: 1, tip: 'eliminatorie', text_cerinta: 'Cerința lotului 1', sursa_document_id: 10, lot_domeniu: 'lista', lot_nr: [1] },
  { id: 2, tip: 'eliminatorie', text_cerinta: 'Cerința lotului 2', sursa_document_id: 10, lot_domeniu: 'lista', lot_nr: [2] },
  { id: 3, tip: 'propunere', text_cerinta: 'Cerința din documentul netriat', sursa_document_id: 11, lot_domeniu: 'toate', lot_nr: null },
  { id: 4, tip: 'propunere', text_cerinta: 'Cerința fără lot', sursa_document_id: null, lot_domeniu: null, lot_nr: null, lot: null },
]
async function rulareLot(tabele: Record<string, any[]>, opt: { motive?: Record<number, string>; cade?: boolean } = {}) {
  const baza = supaFals({ ofertare_licitatii: [LIC_LOT], ofertare_licitatie_loturi: [{ nr: 1 }], ofertare_cerinte: CER_LOT,
    ofertare_acoperire: [], ofertare_cantitati: [], ofertare_verificari: [], ofertare_documente_atribuire: [{ id: 10, nume_original: 'CS.pdf' }, { id: 11, nume_original: 'CS lot 2.pdf' }],
    ofertare_clarificari: [], ...tabele })
  const { supa, apeluri } = cuPoartaLot(baza, [10, 11], opt)
  const corpuri: string[] = []
  const fetchVechi = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
    corpuri.push(String(init?.body || ''))
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
  }) as typeof fetch
  try { return { r: await propuneClarificari(supa, { licitatie_id: 95, dry_run: true }), corpuri, apeluri } } finally { globalThis.fetch = fetchVechi }
}

Deno.test('loturi: doar cerințele eligibile pleacă la AI; excluse raportate cu motive grupate', async () => {
  const { r, corpuri } = await rulareLot({ ofertare_cantitati: [{ ...R1751, id: 1, lot_domeniu: 'lista', lot_nr: [2] }, { ...R1751, id: 2, lot_domeniu: 'toate', lot_nr: null }] },
    { motive: { 11: 'de_triat' } })
  assert(r.ok, JSON.stringify(r))
  assertEquals(corpuri.length, 1)
  const m = JSON.parse(corpuri[0]).messages[0].content as string
  const reg = JSON.parse(m.slice(m.indexOf('[', m.indexOf('REGISTRUL DE CERINȚE')), m.indexOf('\n\n', m.indexOf('REGISTRUL DE CERINȚE'))))
  assertEquals(reg.map((c: any) => c.id), [1])
  assertFalse(m.includes('Cerința lotului 2') || m.includes('documentul netriat') || m.includes('Cerința fără lot'))
  assert(m.includes('DIFERENȚE CANTITĂȚI / PLANȘE / DEVIZE (1;'), 'cantitatea de pe lotul 2 nu intră')
  assertFalse(m.includes('CS lot 2.pdf'), 'documentul netriat nu apare nici în inventar')
  assertEquals(r.excluse_lot, { cerinte: 3, cantitati: 1, documente: 1 })
  assertEquals(r.excluse_motive, { lot_in_afara: 2, document_de_triat: 1, lot_necunoscut: 1 })
})

Deno.test('loturi: fără participare / poarta picată / nimic eligibil => niciun apel AI', async () => {
  const nicio = await rulareLot({ ofertare_licitatie_loturi: [] })
  assertEquals(nicio.corpuri.length, 0)
  assertEquals(nicio.r.motiv_lot, 'nicio_participare')
  assert(String(nicio.r.error).startsWith('Blocat pe loturi'), JSON.stringify(nicio.r))
  const cade = await rulareLot({}, { cade: true })
  assertEquals(cade.corpuri.length, 0)
  assertEquals(cade.r.motiv_lot, 'eroare_poarta')
  assert(cade.apeluri.length > 0, 'poarta a fost întrebată')
  const neinit = await rulareLot({ ofertare_licitatii: [{ ...LIC_LOT, stare_loturi: 'neinitializat' }] })
  assertEquals([neinit.corpuri.length, neinit.r.motiv_lot], [0, 'loturi_neinitializate'])
  const gol = await rulareLot({ ofertare_cerinte: CER_LOT.slice(1) }, { motive: { 11: 'de_triat' } })
  assertEquals(gol.corpuri.length, 0)
  assert(gol.r.ok && /nu s-a chemat AI-ul/.test(gol.r.skip), JSON.stringify(gol.r))
  assertEquals(gol.r.excluse_lot.cerinte, 3)
})

// review Jakarinos r2 P1 #2: contextul secundar — răspunsul autorității din document blocat, conflictele pe planșe blocate și
// raportul verificării precedente (pe licitație cu loturi) NU ajung în prompt
Deno.test('loturi r2: răspuns din document blocat / conflict pe planșă blocată / raport vechi pe are_loturi => scoase din prompt', async () => {
  const rulare = async (stare: string) => {
    const supa: any = supaFals({ ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1', autoritate: 'X', obiect: 'gaze', stare_loturi: stare }],
      ofertare_licitatie_loturi: [{ licitatie_id: 95, nr: 2, participam: true }],
      ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Cerinta comuna', lot_domeniu: 'toate', sursa_document_id: 10 }],
      ofertare_acoperire: [], ofertare_cantitati: [],
      ofertare_verificari: [{ verdict: 'galben', raport: 'RAPORT_VECHI_LOT1', created_at: '2026-10-01T00:00:00Z' }],
      ofertare_documente_atribuire: [{ id: 10, nume_original: 'CS.pdf' }],
      ofertare_clarificari: [{ id: 1, nr: 1, intrebare: 'Intrebarea noastra', status: 'raspunsa', raspuns: 'RASPUNS_DIN_DOC_BLOCAT', raspuns_document_id: 999 },
        { id: 2, nr: 2, intrebare: 'Alta', status: 'raspunsa', raspuns: 'RASPUNS_MANUAL', raspuns_document_id: null }],
      v_ofertare_transfer_conflicte: [] })
    const rpcVechi = supa.rpc
    // planșa 777 din conflicte e blocată (lipsește din harta porții), documentul 10 e eligibil
    supa.rpc = (n: string, a?: any) => n === 'fn_ofertare_eligibilitate'
      ? Promise.resolve({ data: [{ document_id: 10, eligibil: true, motiv: stare === 'fara_loturi' ? 'fara_loturi' : 'comun' }], error: null })
      : n === 'fn_ofertare_document_eligibil'   // documentul 999 (răspunsul blocat) e de triat, restul eligibile
        ? Promise.resolve({ data: Number(a?.p_document_id) === 999 ? { eligibil: false, motiv: 'de_triat', licitatie_id: 95 } : { eligibil: true, motiv: 'comun', licitatie_id: 95 }, error: null })
        : rpcVechi(n, a)
    const fromVechi = supa.from.bind(supa)
    supa.from = (t: string) => t === 'v_ofertare_transfer_conflicte'
      ? { select: () => ({ eq: () => Promise.resolve({ data: [{ document_id: 777, nume_original: 'PL_BLOCATA.pdf', stare: 'conflicte', n: 1, deschis: true, restante: [{ tip: 'dn_nestandard', n: 1 }] }], error: null }) }) }
      : fromVechi(t)
    let corp = ''
    const fetchVechi = globalThis.fetch
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => { corp = String(init?.body || ''); return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })) }) as typeof fetch
    try { await propuneClarificari(supa, { licitatie_id: 95, dry_run: true }) } finally { globalThis.fetch = fetchVechi }
    return corp ? JSON.parse(corp).messages[0].content as string : ''
  }
  const m = await rulare('are_loturi')
  assert(m.length > 0, 'AI-ul trebuia chemat (cerința comună e eligibilă)')
  // (fake-ul ignoră filtrele, deci aceleași rânduri apar și la „alte licitații” — se verifică doar secțiunea acestei licitații)
  const ex = m.slice(m.indexOf('CLARIFICĂRI DEJA EXISTENTE'), m.indexOf('RĂSPUNSURI PRIMITE LA ALTE'))
  assert(!ex.includes('RASPUNS_DIN_DOC_BLOCAT') && ex.includes('RASPUNS_MANUAL') && ex.includes('Intrebarea noastra'), 'răspunsul din document blocat scos, întrebarea rămâne')
  assert(!m.includes('PL_BLOCATA'), 'conflictul pe planșa blocată scos')
  assert(!m.includes('RAPORT_VECHI_LOT1') && m.includes('raportul verificării finale omis'), 'raportul vechi omis explicit pe are_loturi')
  const f = await rulare('fara_loturi')
  assert(f.includes('RAPORT_VECHI_LOT1'), 'pe fara_loturi raportul rămâne')
})