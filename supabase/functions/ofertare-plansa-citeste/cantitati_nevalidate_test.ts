// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/cantitati_nevalidate_test.ts
// R5 (Copilot 25.09.2026): la RECITIREA unei planșe, rândurile scrise de transferul anterior (extrase, nevalidate)
// nu mai sunt tratate ca memoriu: fără „confirmă" fals, fără „Memoriu X m" pe o cifră care e tot din planșă.
// Fixture = rândurile REALE 1751–1756 ale lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { randDinPlansa, treciInCantitati } from './handler.ts'

const SURSA = 'Planșa 1 — tabel de dimensionare, citit automat din scanare'
const rand = (id: number, dn: number, m: number, extra: any = {}) => ({ id, licitatie_id: 95, denumire: `Conductă distribuție gaze Dn${dn}`, categorie: 'Conducte și montaj',
  um: 'm', cantitate: m, cantitate_plansa: m, status: 'extras', sursa: SURSA, tip_sursa: null, ...extra })
const LIC95 = () => [rand(1751, 200, 17785), rand(1752, 125, 2275), rand(1753, 110, 780), rand(1754, 90, 4545), rand(1755, 63, 9670), rand(1756, 40, 13140)]

function supaFals(existente: any[]) {
  const apeluri: any[] = []
  let select = ''
  const supa = {
    from: (_t: string) => {
      const b: any = { select: (s: string) => { select = s; return b }, eq: () => b,
        then: (ok: any, ko: any) => Promise.resolve({ data: existente, error: null }).then(ok, ko) }
      return b
    },
    rpc: (nume: string, a: any) => { apeluri.push({ nume, ...a }); return Promise.resolve({ data: { ok: true, adaugate: 0, actualizate: a.p_randuri.length }, error: null }) },
  }
  return { supa, apeluri, select: () => select }
}
// tronsoane din recitire: câte un tronson PE pe diametru, cu lungimile date
const tr = (m: Record<number, number>) => Object.entries(m).map(([dn, l]) => ({ diametru_mm: Number(dn), material: 'PE', lungime_m: l, de_la: 'A', la: 'B' }))
const DOC = { id: 470, licitatie_id: 95, nume_original: 'PL1.pdf' }

Deno.test('randDinPlansa: sursa de transfer sau tip_sursa=plansa = din planșă; memoriu nu', () => {
  assert(randDinPlansa({ sursa: SURSA }))
  assert(randDinPlansa({ tip_sursa: 'plansa', sursa: 'x' }))
  assertFalse(randDinPlansa({ tip_sursa: 'memoriu', sursa: 'Memoriu tehnic, pag. 4' }))
  assertFalse(randDinPlansa(null))
})

Deno.test('R5: recitire cu aceleași cifre pe 1752–1755 => NU „confirmă", status neschimbat', async () => {
  const f = supaFals(LIC95())
  await treciInCantitati(f.supa, DOC, tr({ 125: 2275, 110: 780, 90: 4545, 63: 9670 }), '1', 'R2')
  assert(/\bsursa\b/.test(f.select()) && /\btip_sursa\b/.test(f.select()), 'select-ul citește sursa și tip_sursa')
  const ops = f.apeluri[0].p_randuri
  assertEquals(ops.map((o: any) => o.id), [1752, 1753, 1754, 1755])
  for (const o of ops) {
    assertFalse(/confirmă/.test(o.patch.diferenta_nota), `fals „confirmă" pe ${o.id}: ${o.patch.diferenta_nota}`)
    assertFalse(/^Memoriu/.test(o.patch.diferenta_nota))
    assert(/nu confirmare din memoriu/.test(o.patch.diferenta_nota))
    assertEquals(o.patch.status, undefined, 'statusul rămâne extras (nevalidat), nu devine altceva')
  }
})

Deno.test('R5: Dn40 recitit 13.740 (dedup multiset) vs 13.140 în rând => „citirea anterioară", nu „Memoriu"; status diferenta', async () => {
  const f = supaFals(LIC95())
  await treciInCantitati(f.supa, DOC, tr({ 40: 13740 }), '1', 'R2')
  const [o] = f.apeluri[0].p_randuri
  assertEquals(o.id, 1756)
  assertEquals(o.patch.cantitate_plansa, 13740)
  assert(/citirea anterioară/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
  assertFalse(/Memoriu 13/.test(o.patch.diferenta_nota))
  assertEquals(o.patch.status, 'diferenta')
})

// R5 runda 4 (verificator R3, MAJOR): regula veche „rândul validat nu primește status nou” lăsa o cifră automată NEVERIFICATĂ
// (cantitate_plansa rescrisă) să treacă drept aprobată în grafic (baza „planșe”). Acum: cifră nouă => „diferenta” (runda 1b: orice
// valoare diferită, fără prag de 1 m; nota spune severitatea).
Deno.test('R5 runda 4: rând VALIDAT + recitire cu altă cifră (13.140 → 13.740) => „diferenta”, nota spune pe ce cifră fusese validat', async () => {
  const f = supaFals(LIC95().map((r) => r.id === 1756 ? { ...r, status: 'validat' } : r))
  await treciInCantitati(f.supa, DOC, tr({ 40: 13740 }), '1', 'R2')
  const [o] = f.apeluri[0].p_randuri
  assertEquals([o.id, o.patch.cantitate_plansa, o.patch.status], [1756, 13740, 'diferenta'])
  assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 13.140 m; planșa 1 dă acum 13.740 m (diferență mare: +600 m, +4,57 %) — validarea se reface. '), o.patch.diferenta_nota)
})
Deno.test('R5 runda 4 → 1b: rând VALIDAT + recitire cu ACEEAȘI cifră => validarea rămâne; 13.140 → 13.140,4 (sub 1 m) NU mai e „aceeași cifră”: „diferenta”, severitate mică', async () => {
  const f = supaFals(LIC95().map((r) => r.id === 1756 ? { ...r, status: 'validat' } : r))
  await treciInCantitati(f.supa, DOC, tr({ 40: 13140 }), '1', 'R2')
  const [o] = f.apeluri[0].p_randuri
  assertEquals([o.id, o.patch.status], [1756, undefined])
  const g = supaFals(LIC95().map((r) => r.id === 1756 ? { ...r, status: 'validat' } : r))
  await treciInCantitati(g.supa, DOC, tr({ 40: 13140.4 }), '1', 'R2')
  const [p] = g.apeluri[0].p_randuri
  assertEquals([p.id, p.patch.cantitate_plansa, p.patch.status, 'cantitate' in p.patch], [1756, 13140.4, 'diferenta', false])
  assert(p.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 13.140 m; planșa 1 dă acum 13.140,4 m (diferență mică: +0,4 m, sub 0,01 %) — validarea se reface. '), p.patch.diferenta_nota)
})

Deno.test('regula veche neschimbată pentru memoriu: „confirmă" doar când memoriul chiar are cifra', async () => {
  const mem = [{ id: 1, licitatie_id: 95, denumire: 'Țeavă PE100 SDR11 Dn110', categorie: 'Conducte și montaj', um: 'm', cantitate: 500, status: 'extras', sursa: 'Memoriu tehnic', tip_sursa: 'memoriu' }]
  const f1 = supaFals(structuredClone(mem))
  await treciInCantitati(f1.supa, DOC, tr({ 110: 500 }), '1', 'R')
  assertEquals(f1.apeluri[0].p_randuri[0].patch.diferenta_nota, 'Planșa 1 confirmă: 500 m.')
  const f2 = supaFals(structuredClone(mem))
  await treciInCantitati(f2.supa, DOC, tr({ 110: 620 }), '1', 'R')
  assert(/^Memoriu 500 m vs planșa 1 620 m/.test(f2.apeluri[0].p_randuri[0].patch.diferenta_nota))
  assertEquals(f2.apeluri[0].p_randuri[0].patch.status, 'diferenta')
})
Deno.test('runda 1b: referința se afișează cu 2 zecimale — 35.620,59 → recitire 35.620,6 nu mai apare ca „35.620,6 → 35.620,6”', async () => {
  const r9 = [{ id: 9, licitatie_id: 95, denumire: 'Conductă distribuție gaze Dn110', categorie: 'Conducte și montaj', um: 'm', cantitate: 35620.59, cantitate_plansa: 35620.59, status: 'validat', sursa: SURSA, tip_sursa: null }]
  const f = supaFals(r9)
  await treciInCantitati(f.supa, DOC, tr({ 110: 35620.6 }), '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertEquals(o.patch.status, 'diferenta')
  assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 35.620,59 m; planșa 1 dă acum 35.620,6 m (diferență mică: +0,01 m, sub 0,01 %) — validarea se reface.'), o.patch.diferenta_nota)
})
Deno.test('runda 1b: „confirmă” = ACEEAȘI valoare — memoriul 500 vs planșa 500,4 nu mai e „confirmă” (înainte: < 1 m), rândul trece pe „diferenta”', async () => {
  const mem = [{ id: 1, licitatie_id: 95, denumire: 'Țeavă PE100 SDR11 Dn110', categorie: 'Conducte și montaj', um: 'm', cantitate: 500, status: 'extras', sursa: 'Memoriu tehnic', tip_sursa: 'memoriu' }]
  const f = supaFals(structuredClone(mem))
  await treciInCantitati(f.supa, DOC, tr({ 110: 500.4 }), '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertFalse(/confirmă/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
  assert(/^Memoriu 500 m vs planșa 1 500,4 m/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
  assertEquals([o.patch.cantitate_plansa, o.patch.status, 'cantitate' in o.patch], [500.4, 'diferenta', false])
  // același memoriu VALIDAT: observația 500,4 îl scoate din „validat”; cantitatea aprobată (500) nu se scrie, e numită în notă
  const v = supaFals(structuredClone(mem).map((r: any) => ({ ...r, status: 'validat' })))
  await treciInCantitati(v.supa, DOC, tr({ 110: 500.4 }), '1', 'R')
  const [w] = v.apeluri[0].p_randuri
  assertEquals([w.patch.status, 'cantitate' in w.patch], ['diferenta', false])
  assert(w.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cantitatea 500 m (fără cifră din planșă); planșa 1 dă acum 500,4 m (diferență mică: +0,4 m, +0,08 %) — validarea se reface. Memoriu 500 m vs planșa 1 500,4 m'), w.patch.diferenta_nota)
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// R5 runda 4 (verificatorul rundei 3). Regula aplicată = varianta (a): scriitorul automat care schimbă cifra din planșă a unui
// rând (runda 1b: orice valoare diferită — nu doar ≥ 1 m — față de cantitate_plansa existentă sau, dacă n-are, față de cantitate) îl
// trece pe „diferenta” — și pe „validat”.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
import { cifraSchimbata, dinAceeasiPlansa } from './handler.ts'
// regula „aprobat” din UI (graficul) — modul JS pur, importat direct (fără React)
import { controlCantitatiGrafic, fronturiDinCantitati } from '../../../src/ofertareCantitatiAprobare.js'
// aplică operațiile exact ca RPC-ul ofertare_transfer_plansa_cantitati (pg_get_functiondef, 26.09): cantitate_plansa /
// diferenta_nota / status DIN PATCH, fără gardă pe statusul curent
const aplicaRpc = (rows: any[], ops: any[]) => rows.map((r) => {
  const o = ops.find((x: any) => x.op === 'update' && x.id === r.id)
  if (!o) return r
  const p = o.patch
  return { ...r, ...('cantitate_plansa' in p ? { cantitate_plansa: p.cantitate_plansa } : {}), ...('diferenta_nota' in p ? { diferenta_nota: p.diferenta_nota } : {}),
    ...('status' in p ? { status: p.status } : {}) }
})
// rândurile REALE ale lic. 3 (SELECT ofertare_cantitati, 26.09.2026): 2 și 3 sunt „validat” pe memoriu; transferul planșei 1.1
// din 15.09 15:19:52.967–53.053 le-a scris cantitate_plansa DUPĂ validare (updated_at = batch-ul transferului).
const LIC3 = (extra: Record<number, any> = {}) => [
  { id: 1, licitatie_id: 3, status: 'diferenta', tip_sursa: 'memoriu', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn250 — tronsoane magistrală', cantitate: 23630, cantitate_plansa: 34465, sursa: 'PT partea scrisă (memoriu, OCR)' },
  { id: 2, licitatie_id: 3, status: 'validat', tip_sursa: 'memoriu', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi', cantitate: 1100, cantitate_plansa: 2210, sursa: 'PT partea scrisă (memoriu)' },
  { id: 3, licitatie_id: 3, status: 'validat', tip_sursa: 'memoriu', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn160 — Coconi + Sultana', cantitate: 5250, cantitate_plansa: 5245, sursa: 'PT partea scrisă (memoriu)' },
].map((r) => ({ ...r, ...(extra[r.id] || {}) }))
const DOC3 = { id: 130, licitatie_id: 3, nume_original: 'PL1.1.pdf' }

Deno.test('runda 4 (MAJOR) lic. 3 real: transferul din 15.09 pe rândurile 2/3 VALIDATE (fără cifră din planșă) => „diferenta” pe ambele', async () => {
  // starea dinaintea transferului: validat, cantitate_plansa goală
  const inainte = LIC3({ 2: { cantitate_plansa: null }, 3: { cantitate_plansa: null } })
  const f = supaFals(inainte)
  await treciInCantitati(f.supa, DOC3, tr({ 180: 2210, 160: 5245 }), '1.1', 'R')
  const ops = f.apeluri[0].p_randuri
  const dupa = aplicaRpc(inainte, ops)
  const r2 = dupa.find((r: any) => r.id === 2), r3 = dupa.find((r: any) => r.id === 3)
  assertEquals([r2.cantitate_plansa, r2.status, r3.cantitate_plansa, r3.status], [2210, 'diferenta', 5245, 'diferenta'])
  assert(r2.diferenta_nota.startsWith('Rândul era VALIDAT cu cantitatea 1.100 m (fără cifră din planșă); planșa 1.1 dă acum 2.210 m (diferență mare: +1.110 m, +100,91 %) — validarea se reface.'), r2.diferenta_nota)
  // consecința în grafic (baza „planșe”): nu mai e „ok, toate validate” și nu mai iese frontul Dn180 2.210 neverificat
  const dupaR1 = dupa.map((r: any) => r.id === 1 ? { ...r, status: 'validat' } : r)
  assertEquals(controlCantitatiGrafic(dupaR1, 'plansa').stare, 'block')
  assertEquals(fronturiDinCantitati(dupaR1, 'plansa').fronturi.map((x: any) => x.lungime_m), [34465])
})
Deno.test('runda 4 lic. 3 real, starea de AZI: recitirea planșei 1.1 cu aceleași cifre NU redeschide (referința = cantitate_plansa existentă) — datele vechi cer SQL-ul propus', async () => {
  const f = supaFals(LIC3())
  await treciInCantitati(f.supa, DOC3, tr({ 180: 2210, 160: 5245 }), '1.1', 'R')
  const ops = f.apeluri[0].p_randuri
  assertEquals(ops.filter((o: any) => o.id === 2 || o.id === 3).map((o: any) => o.patch.status), [undefined, undefined])
})
Deno.test('runda 4 ADV1: rândul 1752 VALIDAT 2.275 + recitire 3.000 => „diferenta”; poarta graficului (baza planșe) = block, fără front de 3.000', async () => {
  const rows = LIC95().map((r) => r.id === 1752 ? { ...r, status: 'validat' } : r).filter((r) => r.id === 1752)
  const f = supaFals(rows)
  await treciInCantitati(f.supa, DOC, tr({ 125: 3000 }), '1', 'R')
  const dupa = aplicaRpc(rows, f.apeluri[0].p_randuri)
  assertEquals([dupa[0].cantitate_plansa, dupa[0].status], [3000, 'diferenta'])
  assertEquals(controlCantitatiGrafic(dupa, 'plansa').stare, 'block')
  assertEquals(fronturiDinCantitati(dupa, 'plansa').fronturi, [])
})
Deno.test('runda 4 (cursa citire → RPC): rând „diferenta” la citire, VALIDAT de om înainte de RPC, cifră nouă => RPC-ul îl scoate din „validat”', async () => {
  const laCitire = LIC95().filter((r) => r.id === 1752).map((r) => ({ ...r, status: 'diferenta' }))
  const f = supaFals(laCitire)
  await treciInCantitati(f.supa, DOC, tr({ 125: 3000 }), '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertEquals(o.patch.status, 'diferenta', 'statusul pleacă în patch indiferent de statusul citit')
  const laRpc = laCitire.map((r) => ({ ...r, status: 'validat' }))       // omul a validat între timp (pe 2.275)
  assertEquals(aplicaRpc(laRpc, [o])[0].status, 'diferenta')
})
Deno.test('runda 4 / 1b: cifraSchimbata — referința e cantitate_plansa, apoi cantitate; fără cifră => orice cifră nouă e schimbare; fără prag (2.210 → 2.210,4 = schimbare)', () => {
  assert(cifraSchimbata({ cantitate: 1100, cantitate_plansa: 2210 }, 2210.4))
  assert(!cifraSchimbata({ cantitate: 1100, cantitate_plansa: 2210 }, 2210))
  assert(!cifraSchimbata({ cantitate: 1100, cantitate_plansa: '2210.000' }, 2210))
  assert(cifraSchimbata({ cantitate: 1100, cantitate_plansa: 2210 }, 2211))
  assert(cifraSchimbata({ cantitate: 1100, cantitate_plansa: null }, 2210))
  assert(cifraSchimbata({ cantitate: 1100, cantitate_plansa: null }, 1100.5))
  assert(!cifraSchimbata({ cantitate: 1100, cantitate_plansa: null }, 1100))
  assert(cifraSchimbata({ cantitate: null, cantitate_plansa: null }, 10))
  assert(!cifraSchimbata({ cantitate: 5, cantitate_plansa: 5 }, null))
})
Deno.test('runda 4 ADV4: tip_sursa declarat bate sursa — rând reclasificat F3 (sursa încă „citit automat”) = F3, nu „citire anterioară”', async () => {
  assertFalse(randDinPlansa({ tip_sursa: 'lista_f3', sursa: SURSA }))
  assertFalse(randDinPlansa({ tip_sursa: 'memoriu', sursa: SURSA }))
  assert(randDinPlansa({ tip_sursa: null, sursa: SURSA }))
  const f = supaFals(LIC95().filter((r) => r.id === 1752).map((r) => ({ ...r, cantitate: 2300, cantitate_plansa: null, tip_sursa: 'lista_f3' })))
  await treciInCantitati(f.supa, DOC, tr({ 125: 2275 }), '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertFalse(/citirea anterioară|recitire/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
  assert(o.patch.diferenta_nota.startsWith('F3 2.300 m vs planșa 1 2.275 m (-25 m'), o.patch.diferenta_nota)
  assertEquals(o.patch.status, 'diferenta')
})
Deno.test('runda 4 ADV3: planșa 2 (alt document) pe rândul scris de planșa 1 => NU „recitire”, NU suprascrie; raportat ambiguu', async () => {
  const rows = LIC95().filter((r) => r.id === 1755)
  const f = supaFals(rows)
  const rez: any = await treciInCantitati(f.supa, { id: 999, licitatie_id: 95, nume_original: 'PL2.pdf' }, tr({ 63: 500 }), '2', 'R')
  // RPC-ul se apelează oricum (închide transferul: stare „facut”), dar cu ZERO operații
  assertEquals(f.apeluri.map((a: any) => a.p_randuri.length), [0], 'nicio scriere: singura poziție pe Dn63 e a altei planșe')
  assertEquals(rez.ambigue.length, 1)
  assertEquals(rez.ambigue[0].pozitii, [{ id: 1755, denumire: 'Conductă distribuție gaze Dn63' }])
  assert(/altei planșe/.test(rez.ambigue[0].motiv), rez.ambigue[0].motiv)
})
Deno.test('runda 4 ADV3: altă planșă + rest „de verificat” pe același Dn => poziția altei planșe NU se golește', async () => {
  const rows = LIC95().filter((r) => r.id === 1755)
  const f = supaFals(rows)
  const rest = { peDnMat: { '63|OL': { n: 1, m: 120 } }, global: '1 rând de tabel fără identitate sigură (120 m)' }
  const rez: any = await treciInCantitati(f.supa, { id: 999, licitatie_id: 95, nume_original: 'PL2.pdf' }, tr({ 63: 500 }), '2', 'R', rest)
  assertEquals(f.apeluri.map((a: any) => a.p_randuri.length), [0])
  assertEquals(rez.doar_de_verificat, [{ dn: 63, material: 'OL', pozitie_id: 1755, actiune: 'ambiguu' }])
})
Deno.test('runda 4: „aceeași planșă” = sursa începe cu eticheta ei (nr. din cartuș SAU numele fișierului); „Planșa 1” ≠ „Planșa 12”', async () => {
  assert(dinAceeasiPlansa({ sursa: SURSA }, ['Planșa 1']))
  assertFalse(dinAceeasiPlansa({ sursa: 'Planșa 12 — tabel de dimensionare, citit automat din scanare' }, ['Planșa 1']))
  assert(dinAceeasiPlansa({ sursa: 'Planșa „PL1.pdf” — tabel de dimensionare, citit automat din scanare' }, ['Planșa 1', 'Planșa „PL1.pdf”']))
  // rândul scris la o rulare fără nr. de planșă (eticheta = numele fișierului) e recitit ca atare când nr-ul apare
  const f = supaFals(LIC95().filter((r) => r.id === 1755).map((r) => ({ ...r, sursa: 'Planșa „PL1.pdf” — tabel de dimensionare, citit automat din scanare' })))
  await treciInCantitati(f.supa, DOC, tr({ 63: 9670 }), '1', 'R')
  assert(/\(recitire\)/.test(f.apeluri[0].p_randuri[0].patch.diferenta_nota))
})
// ADV5 după rebase peste R4 runda 6 (f1c4b66): același defect preexistent (două grupuri pe o singură poziție => două update-uri,
// ultimul câștigă) e reparat și în R4, cu altă semantică pe poziție: O notă care numește toate grupurile, cantitate_plansa NEatinsă,
// „extras” => „diferenta”, o singură intrare în `ambigue` cu `grupuri`. R5 lăsa poziția fără nimic (urma rămânea doar în JSON-ul
// transferului, pe care UI-ul nu-l arată). Aserțiunea „1755 nu primește nimic” contrazicea direct testul R4 „runda 6 MAJOR transfer”
// pe același scenariu; rămâne semantica R4. Intenția ADV5 se păstrează: nicio cifră scrisă sau adunată, ambele grupuri numite,
// aceleași operații și același raport în orice ordine a tronsoanelor.
Deno.test('runda 4 ADV5 (după R4 runda 6): Dn63 PE + Dn63 OL pe o singură poziție „Dn63” => doar nota, cifra neatinsă, ambele grupuri raportate; ordinea inversă dă aceleași operații', async () => {
  const t = [
    { diametru_mm: 63, material: 'PE', lungime_m: 100.05, de_la: 'X', la: 'Y' },
    { diametru_mm: 40, material: 'PE', lungime_m: 100.05, de_la: 'X', la: 'Y' },
    { diametru_mm: 63, material: 'PE', lungime_m: 0.15, de_la: 'Y', la: 'Z' },
    { diametru_mm: 63, material: 'OL', lungime_m: 30, de_la: 'Y', la: 'Z' },
  ]
  const baza = () => [rand(1755, 63, 100), rand(1756, 40, 100)]
  const f1 = supaFals(baza()), f2 = supaFals(baza())
  const r1: any = await treciInCantitati(f1.supa, DOC, t, '1', 'R')
  const r2: any = await treciInCantitati(f2.supa, DOC, [...t].reverse(), '1', 'R')
  assertEquals(JSON.stringify(f1.apeluri[0].p_randuri), JSON.stringify(f2.apeluri[0].p_randuri))
  assertEquals(f1.apeluri[0].p_randuri.map((o: any) => o.id), [1755, 1756], 'o singură operație pe 1755 (nota coliziunii)')
  const [o] = f1.apeluri[0].p_randuri
  assertFalse('cantitate_plansa' in o.patch, '1755: cifra din planșă neatinsă (nici 30, nici 100,2, nici suma)')
  assertEquals(o.patch.status, 'diferenta')
  assertEquals(o.patch.diferenta_nota, 'De verificat: Planșa 1 dă 2 grupuri sigure pe aceeași poziție — Dn63 OL 30 m (1 rând); Dn63 PE 100,2 m (2 rânduri); ' +
    'împreună 130,2 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (100 m e dintr-o citire anterioară).')
  assertEquals(JSON.stringify(r1.ambigue), JSON.stringify(r2.ambigue))
  assertEquals(r1.ambigue.map((a: any) => [a.dn, a.pozitii[0].id, a.grupuri.map((x: any) => [x.material, x.metri])]), [[63, 1755, [['OL', 30], ['PE', 100.2]]]])
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Rebase R5 peste R4 runda 6 (ab5c449): interacțiunea „coliziune de grupuri sigure” (R4) × „altă planșă” (R5 ADV3) și
// × rest „doar de verificat” (R4 runda 5). Pe fiecare ramură luată singură, aceste cazuri se comportau altfel.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const T_COLIZ = [
  { diametru_mm: 63, material: 'PE', lungime_m: 100.05, de_la: 'X', la: 'Y' },
  { diametru_mm: 63, material: 'OL', lungime_m: 30, de_la: 'Y', la: 'Z' },
  { diametru_mm: 63, material: 'PE', lungime_m: 0.15, de_la: 'Y', la: 'Z' },
]
Deno.test('rebase R4×R5: coliziune pe poziția ALTEI planșe => nimic scris pe ea (nici nota coliziunii); o intrare ambiguă cu grupurile și motivul altei planșe; aceeași în orice ordine', async () => {
  // doar R4: nota coliziunii rescria diferenta_nota (și statusul) rândului scris de planșa 1; doar R5: două intrări, fără `grupuri`
  const DOC2 = { id: 999, licitatie_id: 95, nume_original: 'PL2.pdf' }
  const f1 = supaFals(LIC95().filter((r) => r.id === 1755)), f2 = supaFals(LIC95().filter((r) => r.id === 1755))
  const r1: any = await treciInCantitati(f1.supa, DOC2, T_COLIZ, '2', 'R')
  const r2: any = await treciInCantitati(f2.supa, DOC2, [...T_COLIZ].reverse(), '2', 'R')
  assertEquals([f1.apeluri[0].p_randuri.length, f2.apeluri[0].p_randuri.length], [0, 0], 'nicio operație pe rândul planșei 1')
  assertEquals(JSON.stringify(r1.ambigue), JSON.stringify(r2.ambigue))
  assertEquals(r1.ambigue.length, 1)
  const [a] = r1.ambigue
  assertEquals([a.dn, a.metri, a.pozitii, a.grupuri.map((x: any) => [x.material, x.metri, x.randuri])],
    [63, 130.2, [{ id: 1755, denumire: 'Conductă distribuție gaze Dn63' }], [['OL', 30, 1], ['PE', 100.2, 2]]])
  assert(a.motiv.startsWith('mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă; poziția are cifra altei planșe („Planșa 1 — tabel'), a.motiv)
})
Deno.test('rebase R4×R5: rest „doar de verificat” (Dn63 OL) pe poziția unei coliziuni din ACEEAȘI planșă => se adaugă la nota coliziunii (R4), nu „neatinsă”', async () => {
  // doar R5: poziția coliziunii era „neatinsă” și restul Dn63 OL ajungea doar în JSON; acum nota de pe poziție îl numește
  const f = supaFals(LIC95().filter((r) => r.id === 1755))
  const t = [{ diametru_mm: 63, material: 'PE', lungime_m: 100.2, de_la: 'X', la: 'Y' }, { diametru_mm: 63, material: '', lungime_m: 30, de_la: 'Y', la: 'Z' }]
  const rest = { peDnMat: { '63|OL': { n: 1, m: 120 } }, global: '1 rând de tabel fără identitate sigură (120 m)' }
  const rez: any = await treciInCantitati(f.supa, DOC, t, '1', 'R', rest)
  const ops = f.apeluri[0].p_randuri
  assertEquals(ops.map((o: any) => o.id), [1755])
  assertFalse('cantitate_plansa' in ops[0].patch)
  assertEquals(ops[0].patch.status, 'diferenta')
  assertEquals(ops[0].patch.diferenta_nota, 'De verificat: Planșa 1 dă 2 grupuri sigure pe aceeași poziție — Dn63 PE 100,2 m (1 rând); Dn63 fără material 30 m (1 rând); ' +
    'împreună 130,2 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (9.670 m e dintr-o citire anterioară).' +
    ' De verificat, NEincluse în cifra din planșă: pe planșă: 1 rând de tabel fără identitate sigură (120 m).' +
    ' De verificat (Dn63 OL, fără nicio cifră sigură): 1 rând Dn63 OL fără identitate sigură (120 m).')
  assertEquals(rez.doar_de_verificat, [{ dn: 63, material: 'OL', pozitie_id: 1755, actiune: 'nota' }])
  assertEquals(rez.ambigue.length, 1, 'doar coliziunea; restul nu mai e raportat separat ca „ambiguu”')
})
// R5 varianta B (decizia 26.09.2026, pe principiul Copilot „identitate ambiguă = conflict vizibil”, „niciodată pierdere tăcută”):
// cifra rămâne neatinsă, dar planșa NU confirmă cifra aprobată => rândul iese din „validat”, cu aprobarea veche numită.
// Înainte (R4 runda 6 + rebase-ul 2): status neschimbat — graficul și H2 foloseau în continuare cifra ca aprobată.
Deno.test('R5 varianta B: coliziune pe un rând VALIDAT => cifra neatinsă, status „diferenta”, prefixul „Rândul era VALIDAT cu … — validarea se reface”', async () => {
  const f = supaFals(LIC95().filter((r) => r.id === 1755).map((r) => ({ ...r, status: 'validat' })))
  await treciInCantitati(f.supa, DOC, T_COLIZ, '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertEquals([o.id, 'cantitate_plansa' in o.patch, o.patch.status], [1755, false, 'diferenta'])
  assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 9.670 m; planșa 1 dă 2 grupuri sigure pe aceeași poziție, fără să confirme cifra — validarea se reface. De verificat: Planșa 1 dă 2 grupuri sigure pe aceeași poziție'), o.patch.diferenta_nota)
})
Deno.test('R5 varianta B (control): coliziune pe un rând „diferenta” => nicio dublă prefixare, status neatins', async () => {
  const f = supaFals(LIC95().filter((r) => r.id === 1755).map((r) => ({ ...r, status: 'diferenta' })))
  await treciInCantitati(f.supa, DOC, T_COLIZ, '1', 'R')
  const [o] = f.apeluri[0].p_randuri
  assertEquals([o.id, 'cantitate_plansa' in o.patch, o.patch.status], [1755, false, undefined])
  assert(o.patch.diferenta_nota.startsWith('De verificat: Planșa 1 dă 2 grupuri sigure'), o.patch.diferenta_nota)
})

// ---- R5 pas B — runda 6 (decis în audit 26.09.2026, reversibil): marcajul DOCUMENTAT („ | R5 pas B (…)”, SQL-ul pasului B din
// docs/R5_RECONCILIERE_470_V2.md §7.3: valoarea verificată în `cantitate`, `cantitate_plansa` = istoricul extragerii) și cel VECHI al
// ramurii („ | R5 v2 pas B”, cifra corectată și în `cantitate_plansa`) sunt recunoscute; eticheta numește CANTITATEA drept valoarea
// verificată de om; recitirea poate actualiza `cantitate_plansa` (nu pe un rând VALIDAT pe care îl confirmă), nu atinge `cantitate`;
// marcajul (gărzile B / RB / RB-manual) rămâne la sfârșitul notei, o singură dată.
const NOTA_ANT = 'Diametru care nu apare în cantitățile din memoriu. Planșa 1 dă 13.140 m pe 56 tronsoane.'
const SUF_DOC = ' | R5 pas B (26.09.2026): Nr 40 = 300 m și Nr 41 = 300 m (planșa 470, felii z2_6/z2_7, rândurile 9–10 ale fragmentului) și Nr 38 = 260 m, verificate pe imagine de Oana Nica. ' +
  'Cantitatea ofertată Dn40 = 13740 m; cantitate_plansa = 13140 m (citirea automată curentă, vezi nota anterioară) rămâne ca istoric al extragerii. NEAPROBATĂ: aprobarea = bifa ✓ după reconcilierea obiectului și a etapelor. status anterior: extras'
const SUF_V2 = ' | R5 v2 pas B: Nr 40 = 300 m și Nr 41 = 300 m validate pe imaginea planșei de Oana Nica la 26.09.2026; Nr 38 = 260 m. Dn40 = 13740 m.'
// modelul documentat: cantitate 13.740 (verificată), cantitate_plansa 13.140 (extragerea); modelul vechi: ambele 13.740
const MODELE = [
  { nume: 'marcaj documentat „ | R5 pas B”', lit: 'R5 pas B', suf: SUF_DOC, rand: (x: any = {}) => rand(1756, 40, 13140, { cantitate: 13740, status: 'diferenta', diferenta_nota: NOTA_ANT + SUF_DOC, ...x }) },
  { nume: 'marcaj vechi „ | R5 v2 pas B”', lit: 'R5 v2 pas B', suf: SUF_V2, rand: (x: any = {}) => rand(1756, 40, 13740, { status: 'diferenta', diferenta_nota: NOTA_ANT + SUF_V2, ...x }) },
]
const VER = 'valoarea verificată e cantitatea 13.740 m, verificată de om pe imaginea planșei (pasul B din R5)'
const literalOdata = (n: string, lit: string) => {
  assertEquals(n.split(lit).length, 2, `literalul „${lit}” apare o singură dată: ${n}`)
  if (lit !== 'R5 pas B') assertFalse(n.includes('R5 pas B'), 'eticheta nu introduce literalul marcajului documentat (gărzile SQL)')
}
for (const M of MODELE) {
  Deno.test(`R5 pas B (${M.nume}): recitirea dă 13.140 => cantitatea verificată 13.740 numită, nu „citire anterioară”; cantitate_plansa = extragerea; marcajul rămâne la sfârșit`, async () => {
    const f = supaFals([M.rand()])
    await treciInCantitati(f.supa, DOC, tr({ 40: 13140 }), '1', 'R3')
    const [o] = f.apeluri[0].p_randuri
    assertEquals([o.id, o.patch.cantitate_plansa, 'cantitate' in o.patch, o.patch.status], [1756, 13140, false, 'diferenta'])
    assert(o.patch.diferenta_nota.startsWith(`Planșa 1 (recitire) dă 13.140 m pe 1 tronsoane — ${VER}, nu o citire automată; recitirea diferă (diferență mare: -600 m, -4,37 %): cantitatea verificată NU se modifică automat — verifică pe planșă.`), o.patch.diferenta_nota)
    assertFalse(/citirea anterioară|citire anterioară|^Memoriu/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
    literalOdata(o.patch.diferenta_nota, M.lit)
    assert(o.patch.diferenta_nota.endsWith(M.suf), o.patch.diferenta_nota)
  })
  Deno.test(`R5 pas B (${M.nume}): recitirea confirmă 13.740 => „recitirea o confirmă”, status neatins; VALIDAT + confirmă => nimic atins; VALIDAT + diferă => varianta B cu cantitatea numită`, async () => {
    const f = supaFals([M.rand()])
    await treciInCantitati(f.supa, DOC, tr({ 40: 13740 }), '1', 'R3')
    const [o] = f.apeluri[0].p_randuri
    assertEquals([o.patch.cantitate_plansa, o.patch.status], [13740, undefined])
    assert(o.patch.diferenta_nota.includes(`${VER}, nu o citire automată; recitirea o confirmă.`) && o.patch.diferenta_nota.endsWith(M.suf), o.patch.diferenta_nota)
    const c = supaFals([M.rand({ status: 'validat' })])
    await treciInCantitati(c.supa, DOC, tr({ 40: 13740 }), '1', 'R3')
    const [oc] = c.apeluri[0].p_randuri
    assertEquals(['cantitate_plansa' in oc.patch, oc.patch.status], [false, undefined], 'validat + recitire care confirmă => nimic din aprobare nu se atinge')
    const v = supaFals([M.rand({ status: 'validat' })])
    await treciInCantitati(v.supa, DOC, tr({ 40: 13140 }), '1', 'R3')
    const [w] = v.apeluri[0].p_randuri
    assertEquals([w.patch.cantitate_plansa, w.patch.status], [13140, 'diferenta'])
    assert(w.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cantitatea 13.740 m (verificată de om pe imaginea planșei, pasul B din R5); planșa 1 dă acum 13.140 m (diferență mare: -600 m, -4,37 %) — validarea se reface. '), w.patch.diferenta_nota)
    literalOdata(w.patch.diferenta_nota, M.lit)
    // runda 1b: 13.739,6 NU mai „confirmă” 13.740 (înainte: < 1 m) — pe VALIDAT: „diferenta”, severitate mică, cantitatea neatinsă
    const u = supaFals([M.rand({ status: 'validat' })])
    await treciInCantitati(u.supa, DOC, tr({ 40: 13739.6 }), '1', 'R3')
    const [x] = u.apeluri[0].p_randuri
    assertEquals([x.patch.cantitate_plansa, x.patch.status, 'cantitate' in x.patch], [13739.6, 'diferenta', false])
    assert(x.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cantitatea 13.740 m (verificată de om pe imaginea planșei, pasul B din R5); planșa 1 dă acum 13.739,6 m (diferență mică: -0,4 m, sub 0,01 %) — validarea se reface. '), x.patch.diferenta_nota)
    assert(x.patch.diferenta_nota.includes('recitirea diferă (diferență mică: -0,4 m, sub 0,01 %): cantitatea verificată NU se modifică automat'), x.patch.diferenta_nota)
    literalOdata(x.patch.diferenta_nota, M.lit)
  })
  Deno.test(`R5 pas B (${M.nume}): Dn40 doar „de verificat” => cifra NU se golește, cantitatea verificată numită „neatinsă”; VALIDAT => varianta B; marcajul rămâne`, async () => {
    const rest = { peDnMat: { '40|PE': { n: 2, m: 600 } }, global: '2 rânduri de tabel fără identitate sigură (600 m)' }
    for (const st of ['extras', 'diferenta', 'validat']) {
      const f = supaFals([M.rand({ status: st })])
      await treciInCantitati(f.supa, DOC, [], '1', 'R3', rest)
      const [o] = f.apeluri[0].p_randuri
      assertEquals([o.id, 'cantitate_plansa' in o.patch, o.patch.status], [1756, false, st === 'diferenta' ? undefined : 'diferenta'], st) // deja „diferenta” => rămâne
      assert(o.patch.diferenta_nota.includes(`; ${VER}, neatinsă.`), o.patch.diferenta_nota)
      if (st === 'validat') assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT cu cantitatea 13.740 m (verificată de om pe imaginea planșei, pasul B din R5); planșa 1 nu dă nicio cifră sigură pentru el (doar rânduri de verificat), fără să confirme cifra — validarea se reface. De verificat: '), o.patch.diferenta_nota)
      literalOdata(o.patch.diferenta_nota, M.lit)
      assert(o.patch.diferenta_nota.endsWith(M.suf), o.patch.diferenta_nota)
    }
  })
}
Deno.test('R5 pas B (marcaj documentat): după recitire, RB găsește marcajul — left(nota, strpos(nota, \' | R5 pas B\') - 1) = nota codului, sufixul = cel pus de SQL', async () => {
  const f = supaFals([MODELE[0].rand()])
  await treciInCantitati(f.supa, DOC, tr({ 40: 13140 }), '1', 'R3')
  const n: string = f.apeluri[0].p_randuri[0].patch.diferenta_nota
  const i = n.indexOf(' | R5 pas B')
  assert(i > 0 && n.slice(i) === SUF_DOC && !n.slice(0, i).includes('R5 pas B'), n)
})
Deno.test('R5 pas B: control — același scenariu FĂRĂ marcaj => comportamentul R4 (golire „dintr-o citire anterioară”)', async () => {
  const rest = { peDnMat: { '40|PE': { n: 2, m: 600 } }, global: '2 rânduri de tabel fără identitate sigură (600 m)' }
  const g = supaFals([rand(1756, 40, 13140)])
  await treciInCantitati(g.supa, DOC, [], '1', 'R3', rest)
  assertEquals(g.apeluri[0].p_randuri[0].patch.cantitate_plansa, null)
  assert(g.apeluri[0].p_randuri[0].patch.diferenta_nota.includes('dintr-o citire anterioară'))
})
