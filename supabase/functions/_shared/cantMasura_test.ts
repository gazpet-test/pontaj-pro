// TKT-0329 A, PR-extragere (Task 6): funcțiile pure ale plafonului de pagini, ale reconstruirii rolului pe felie, ale completitudinii
// feliilor și ale inventarului rulării. Fără rețea, fără BD. Paritate cu SQL (fn_ofertare_masura_pagini_permise) pe tabelul comun
// supabase/tests/20270112a_cazuri_plafon.json (L19).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { sha256Hex } from './cantNormalizare.ts'
import { arePartiDeExtras, cheieFelie, completitudineFelii, type Context, type FelieServita, type Fotografie, type FotoDocument, eFotografie, limitaPagini,
  numarPagini, paginaText, paginiInterval, paginiRulare, plafonFelii, rezumatSemnale, rolFelie, segmentePagini, verificaContext } from './cantMasura.ts'

const CAZURI = JSON.parse(await Deno.readTextFile(new URL('../../tests/20270112a_cazuri_plafon.json', import.meta.url)))
const CAZURI_PAGINI = JSON.parse(await Deno.readTextFile(new URL('../../tests/20270112a_cazuri_pagini.json', import.meta.url)))

// ─── plafonul (decizia 18), aceeași definiție ca fn_ofertare_masura_pagini_permise ───
Deno.test('plafonFelii: paritate cu SQL pe tabelul comun de cazuri (limita, plafon_atins, feliile permise / nepermise)', () => {
  assert(CAZURI.cazuri.length >= 6)
  for (const c of CAZURI.cazuri) {
    const docs = c.documente.map((d: any) => ({ id: d.id, pagini: d.pagini }))
    const felii = c.felii.map((f: any) => ({ document_id: f.document_id, pagina_de_la: f.pagina_de_la, pagina_pana_la: f.pagina_pana_la }))
    const r = plafonFelii(docs, felii, c.plafon)
    assertEquals(r.limita, c.limita, c.nume + ': limita')
    assertEquals(r.plafon_atins, c.plafon_atins, c.nume + ': plafon_atins')
    for (const f of c.felii) assertEquals(r.permise.has(cheieFelie(f)), f.permisa, c.nume + ': felia ' + cheieFelie(f))
    // limitaPagini (folosită în extrageStructurat înaintea buclei de felii) = aceeași limită
    assertEquals(limitaPagini(docs, c.plafon), { limita: c.limita, plafon_atins: c.plafon_atins }, c.nume + ': limitaPagini')
  }
})

Deno.test('plafonFelii: 3 × 100 pagini, plafon 200 → feliile documentului 3 nepermise, paginile lui în pagini_necitite, plafon_atins', () => {
  const docs = [{ id: 1, pagini: 100 }, { id: 2, pagini: 100 }, { id: 3, pagini: 100 }]
  const felii = [{ document_id: 1, pagina_de_la: 1, pagina_pana_la: 100 }, { document_id: 2, pagina_de_la: 1, pagina_pana_la: 100 }, { document_id: 3, pagina_de_la: 1, pagina_pana_la: 60 }, { document_id: 3, pagina_de_la: 55, pagina_pana_la: 100 }]
  const r = plafonFelii(docs, felii, 200)
  assertEquals([...r.permise].sort(), ['1:1-100', '2:1-100'])
  assertEquals(r.plafon_atins, true)
  assertEquals(r.pagini_necitite, [{ document_id: 3, pagini: Array.from({ length: 100 }, (_, i) => i + 1) }])
})

Deno.test('plafonFelii: felia 198–203 la plafon 200 → nepermisă întreagă, paginile 198–203 (și 201–250 peste limită) necitite; la 250 → permisă', () => {
  const docs = [{ id: 1, pagini: 250 }]
  const f = [{ document_id: 1, pagina_de_la: 198, pagina_pana_la: 203 }, { document_id: 1, pagina_de_la: 190, pagina_pana_la: 200 }]
  const r = plafonFelii(docs, f, 200)
  assertEquals([r.permise.has('1:198-203'), r.permise.has('1:190-200')], [false, true])
  const nec = r.pagini_necitite[0].pagini
  assertEquals([nec[0], nec[nec.length - 1], nec.length, nec.includes(197), nec.includes(198)], [198, 250, 53, false, true])
  assertEquals(plafonFelii(docs, f, 250).permise.has('1:198-203'), true)
  assertEquals(plafonFelii(docs, f, 250).pagini_necitite, [])
})

Deno.test('plafonFelii: documentul din cache (id mic) numără la fel ca unul nou; un document necunoscut fotografiei = nepermis (conservator)', () => {
  const r = plafonFelii([{ id: 5, pagini: 150 }, { id: 9, pagini: 100 }], [{ document_id: 9, pagina_de_la: 1, pagina_pana_la: 50 }, { document_id: 9, pagina_de_la: 50, pagina_pana_la: 51 }, { document_id: 77, pagina_de_la: 1, pagina_pana_la: 1 }], 200)
  assertEquals([r.permise.has('9:1-50'), r.permise.has('9:50-51'), r.permise.has('77:1-1')], [true, false, false])
  assertEquals(r.pagini_necitite, [{ document_id: 9, pagini: Array.from({ length: 51 }, (_, i) => i + 50) }, { document_id: 77, pagini: [1] }])
  // plafon invalid (NaN / negativ) = 0 pagini permise (fail-closed), ca coalesce(p_plafon, 0) în SQL
  assertEquals(limitaPagini([{ id: 1, pagini: 10 }], NaN), { limita: [{ document_id: 1, ultima_pagina_permisa: 0 }], plafon_atins: true })
  // ordinea intrării nu contează: documentele se ordonează după id (ca ORDER BY id)
  assertEquals(limitaPagini([{ id: 9, pagini: 100 }, { id: 5, pagini: 150 }], 200).limita, [{ document_id: 5, ultima_pagina_permisa: 150 }, { document_id: 9, ultima_pagina_permisa: 50 }])
})

// ─── paginile unei felii și numărul de pagini al unui text (paritate cu fn_ofertare_masura_pagini / _pagina pe tabelul comun; r3 P2) ───
const T3 = '⟦PAGINA 1⟧\nunu\n⟦PAGINA 2⟧\ndoi\n⟦PAGINA 3⟧\ntrei\n'
Deno.test('pagini: paritate cu SQL pe tabelul comun 20270112a_cazuri_pagini.json (numărul de pagini, textul fiecărei pagini, intervalele plafonului)', () => {
  assert(CAZURI_PAGINI.cazuri.length >= 10)
  for (const c of CAZURI_PAGINI.cazuri) {
    assertEquals(numarPagini(c.text), c.pagini, c.nume + ': numarPagini')
    for (const [p, asteptat] of Object.entries(c.pagina)) assertEquals(paginaText(c.text, Number(p)), asteptat, c.nume + ': pagina ' + p)
    for (const i of c.intervale) assertEquals(paginiInterval(c.text, i.de_la, i.pana_la), { pagina_de_la: i.pagina_de_la, pagina_pana_la: i.pagina_pana_la }, c.nume + ': interval ' + i.de_la + '-' + i.pana_la)
  }
  // textul NULL din BD: zero pagini, nicio pagină (fn_ofertare_masura_pagina(NULL, 1) = NULL; textul gol '' rămâne '' la pagina 1)
  assertEquals([numarPagini(null), numarPagini(undefined), paginaText(null, 1), paginaText(undefined, 1), paginaText('', 1)], [0, 0, null, null, ''])
})

Deno.test('paginiInterval / segmentePagini: paginile atinse de o felie (offseturi de caractere); fără marcaje = pagina 1; preambulul = prima pagină marcată; tab-ul nu e marcaj', () => {
  assertEquals(paginiInterval(T3, 0, T3.length), { pagina_de_la: 1, pagina_pana_la: 3 })
  const p2 = T3.indexOf('⟦PAGINA 2⟧')
  assertEquals(paginiInterval(T3, p2, p2 + 5), { pagina_de_la: 2, pagina_pana_la: 2 })
  assertEquals(paginiInterval(T3, p2 - 2, p2 + 5), { pagina_de_la: 1, pagina_pana_la: 2 })
  assertEquals(paginiInterval('fara marcaje', 0, 5), { pagina_de_la: 1, pagina_pana_la: 1 })
  assertEquals(paginiInterval('copertă\n' + T3, 0, 3), { pagina_de_la: 1, pagina_pana_la: 1 })
  assertEquals(segmentePagini('copertă\n' + T3).map((s) => s.nr), [null, 1, 2, 3])
  assertEquals(segmentePagini('').map((s) => [s.nr, s.de, s.pana]), [[null, 0, 0]])
  assertEquals(segmentePagini('⟦PAGINA\t2⟧\nBODY').map((s) => s.nr), [null])
  // felia goală la capătul textului = ultima pagină (nu „nimic”)
  assertEquals(paginiInterval(T3, T3.length, T3.length), { pagina_de_la: 3, pagina_pana_la: 3 })
  assertEquals(numarPagini('⟦PAGINA 7⟧\nx\n⟦PAGINA 2⟧\ny'), 7)   // maximul, ca în SQL
})

Deno.test('arePartiDeExtras (r4 P1): EXACT regula extragerii pe secțiunile efective — rol_confirmat pe o secțiune bate nu_e_sursa_cantitativa pe „*”; doar „alt” = nimic de extras; fără text = necitit dacă omul nu l-a scos', () => {
  const c = (text: string | null, decizii: Context['decizii'], tip = 'cs_volum', nume = 'Caiet de sarcini.pdf'): Context => ({ document_id: 1, text_extras: text, nume_original: nume, tip, sha: 's', decizii, decizii_sha: 'd' })
  const CS = '⟦PAGINA 1⟧\nCaiet de sarcini\nconducta Dn 160, lungime 250 m\n⟦PAGINA 2⟧\nalte conditii\n'
  assertEquals(arePartiDeExtras(c(CS, [])), true)
  assertEquals(arePartiDeExtras(c(CS, [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }])), false)
  // cazul r4 P1: „*” nu e sursă + rol_confirmat cs pe pagina 1 → pagina 1 rămâne cantitativă pentru extractor → documentul ARE ce extrage
  assertEquals(arePartiDeExtras(c(CS, [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }, { id: 2, rol: 'cs', sectiune: '1-2', decizie: 'rol_confirmat' }])), true)
  // același caz cu două secțiuni (pagina 2 = ATR prin marcaj): rol_confirmat cs pe „1-1” bate „*” pe pagina 1 → are ce extrage; doar „*” → nu
  const CS2 = '⟦PAGINA 1⟧\nCaiet de sarcini\nconducta Dn 160, lungime 250 m\n⟦PAGINA 2⟧\nAVIZ TEHNIC DE RACORDARE\nlungime totala 3.995 m\n'
  assertEquals(arePartiDeExtras(c(CS2, [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }, { id: 2, rol: 'cs', sectiune: '1-1', decizie: 'rol_confirmat' }])), true)
  assertEquals(arePartiDeExtras(c(CS2, [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }])), false)
  // decizia pe o secțiune care NU există („9-9”) nu schimbă nimic; nu_e_sursa pe secțiunea întreagă („1-2”) = la fel ca „*”
  assertEquals(arePartiDeExtras(c(CS, [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }, { id: 2, rol: 'cs', sectiune: '9-9', decizie: 'rol_confirmat' }])), false)
  assertEquals(arePartiDeExtras(c(CS, [{ id: 1, rol: null, sectiune: '1-2', decizie: 'nu_e_sursa_cantitativa' }])), false)
  assertEquals(arePartiDeExtras(c(CS, [{ id: 1, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }])), true)
  // un document `alta` fără marcaj ATR și fără titlu cantitativ → rol „alt” → extragerea nu-l atinge → nu poate fi „necitit”
  assertEquals(arePartiDeExtras(c('Certificat de urbanism nr. 1\ntext', [], 'alta', 'C.U. retea.pdf')), false)
  assertEquals(arePartiDeExtras(c('AVIZ TEHNIC DE RACORDARE\nlungime 250 m', [], 'alta', 'ATR.pdf')), true)
  // fără text (încă necitit OCR): nu știm ce conține → are ce extrage (și la „alt”), dacă omul nu l-a scos
  assertEquals(arePartiDeExtras(c('', [], 'alta', 'Scan.pdf')), true)
  assertEquals(arePartiDeExtras(c(null, [], 'alta', 'Scan.pdf')), true)
  assertEquals(arePartiDeExtras(c('', [{ id: 1, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }], 'alta', 'Scan.pdf')), false)
  assertEquals(arePartiDeExtras({ ...c(CS, []), decizii: null as unknown as Context['decizii'] }), true)
})

// ─── rolul pe felie din contextul legat de fotografie (decizia 17) ───
const F3 = '⟦PAGINA 1⟧\nFormularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. A\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
const MEM = '⟦PAGINA 1⟧\nMemoriu tehnic\nconducta Dn 160, lungime 250 m\n⟦PAGINA 2⟧\nAVIZ TEHNIC DE RACORDARE\nlungime totala 3.995 m\n'
const ctx = (text: string, nume: string, tip: string, decizii: Context['decizii'] = []): Context =>
  ({ document_id: 1, text_extras: text, nume_original: nume, tip, sha: 'x', decizii, decizii_sha: 'd' })

Deno.test('rolFelie: F3 dintr-un formular → f3; memoriu → memoriu; pagina cu marcaj ATR → atr; în afara textului → null; decizia nu_e_sursa_cantitativa → null', () => {
  assertEquals(rolFelie(ctx(F3, 'Formulare.pdf', 'formular'), { de_la: 0, pana_la: F3.length }), 'f3')
  assertEquals(rolFelie(ctx(MEM, 'Memoriu tehnic.pdf', 'alta'), { de_la: 0, pana_la: 30 }), 'memoriu')
  const p2 = MEM.indexOf('⟦PAGINA 2⟧')
  assertEquals(rolFelie(ctx(MEM, 'Memoriu tehnic.pdf', 'alta'), { de_la: p2, pana_la: MEM.length }), 'atr')
  assertEquals(rolFelie(ctx(MEM, 'Memoriu tehnic.pdf', 'alta'), { de_la: MEM.length, pana_la: MEM.length }), null)
  assertEquals(rolFelie(ctx(F3, 'Formulare.pdf', 'formular', [{ id: 1, rol: 'f3', sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }]), { de_la: 0, pana_la: 10 }), null)
  assertEquals(rolFelie(ctx(F3, 'Formulare.pdf', 'formular', [{ id: 2, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }]), { de_la: 0, pana_la: 10 }), 'atr')
})

// ─── contextul verificat față de fotografie ───
const docFoto = (id: number, text: string, nume: string, tip: string, extra: Partial<FotoDocument> = {}): Promise<FotoDocument> =>
  sha256Hex(text).then((sha) => ({ id, tip, nume_original: nume, revizie: '-', sha, pagini: numarPagini(text), pagini_necitite: [], lot_stare: 'comun',
    extragere_id: 7, extractor_id: 'x', felii_distincte: 1, felii_sha: 'f', obs_sha: 'o', decizii_sha: await0(''), ...extra }))
// decizii_sha pentru „fără decizii” = sha256('') (coalesce(string_agg(...), '') în SQL)
const await0 = (s: string) => s === '' ? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' : s
Deno.test('verificaContext: egal → true; text cu alt sha / decizii_sha diferit / nume diferit / tip diferit / alt document → false', async () => {
  const d = await docFoto(1, F3, 'Formulare.pdf', 'formular')
  const c: Context = { document_id: 1, text_extras: F3, nume_original: 'Formulare.pdf', tip: 'formular', sha: d.sha, decizii: [], decizii_sha: await0('') }
  assertEquals(await verificaContext(c, d), true)
  assertEquals(await verificaContext({ ...c, text_extras: F3 + ' ' }, d), false)
  assertEquals(await verificaContext({ ...c, decizii_sha: 'alt' }, d), false)
  assertEquals(await verificaContext({ ...c, nume_original: 'Alt.pdf' }, d), false)
  assertEquals(await verificaContext({ ...c, tip: 'alta' }, d), false)
  assertEquals(await verificaContext({ ...c, document_id: 2 }, d), false)
  // textul NULL din BD = sha256('') în fotografie
  const g = await docFoto(3, '', 'Gol.pdf', 'alta')
  assertEquals(await verificaContext({ ...c, document_id: 3, text_extras: null, nume_original: 'Gol.pdf', tip: 'alta' }, g), true)
})

// ─── completitudinea feliilor (decizia 17 + r7 P1: indicatorul obs_atribuibile ÎNAINTEA rolului) ───
const felie = (x: Partial<FelieServita>): FelieServita => ({ document_id: 1, extragere_id: 7, felie_nr: 0, incercare: 1, incercari: 1, de_la: 0, pana_la: F3.length, stare: 'gata',
  obs_numar: 0, obs_atribuibile: true, obs: [], ...x })
const obsF3 = (t: string, ...cant: string[]) => cant.map((c, i) => ({ id: i + 1, felie_nr: 0, pozitie_dovedita: true, cantitate_offset: t.indexOf(c), hash_rand: 'h' + i, e_total: false, e_subtotal: false }))
const CTX_F3 = new Map([[1, ctx(F3, 'Formulare.pdf', 'formular')]])
const CTX_MEM = new Map([[1, ctx(MEM, 'Memoriu tehnic.pdf', 'alta')]])

Deno.test('completitudineFelii: f3 cu un rând-ancoră neacoperit → deficit; cu ancore și ZERO observații → deficit; completă → absentă', () => {
  assertEquals(completitudineFelii([felie({ obs: obsF3(F3, '1160.000'), obs_numar: 1 })], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }])
  assertEquals(completitudineFelii([felie({})], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }])
  assertEquals(completitudineFelii([felie({ obs: obsF3(F3, '174.000', '1160.000'), obs_numar: 2 })], CTX_F3), [])
})

Deno.test('completitudineFelii: atr / memoriu cu observații atribuibile → ignorată (text liber, fără poartă); esuat → stare:esuat; rol null → rol_nereconstructibil', () => {
  const p2 = MEM.indexOf('⟦PAGINA 2⟧')
  assertEquals(completitudineFelii([felie({ de_la: p2, pana_la: MEM.length, obs_numar: 1, obs: [{ id: 1, felie_nr: 0, pozitie_dovedita: true, cantitate_offset: MEM.indexOf('3.995'), hash_rand: 'h', e_total: false, e_subtotal: false }] })], CTX_MEM), [])
  assertEquals(completitudineFelii([felie({ de_la: 0, pana_la: p2 })], CTX_MEM), [])
  assertEquals(completitudineFelii([felie({ stare: 'esuat', felie_nr: 2 })], CTX_F3), [{ extragere_id: 7, felie_nr: 2, motiv: 'stare:esuat' }])
  // în afara oricărei secțiuni (sau secțiune cu rol null prin decizie) → blochează conservator
  assertEquals(completitudineFelii([felie({ de_la: F3.length, pana_la: F3.length })], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'rol_nereconstructibil' }])
  const dec = new Map([[1, ctx(F3, 'Formulare.pdf', 'formular', [{ id: 1, rol: 'f3', sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }])]])
  assertEquals(completitudineFelii([felie({})], dec), [{ extragere_id: 7, felie_nr: 0, motiv: 'rol_nereconstructibil' }])
  // fără context pentru document → tot rol_nereconstructibil (nu „nimic”)
  assertEquals(completitudineFelii([felie({ document_id: 9 })], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'rol_nereconstructibil' }])
})

Deno.test('completitudineFelii (r7 P1): obs_atribuibile = false → observatii_neatribuibile pentru ORICE rol, înaintea porții și a rolului; lipsă / non-boolean → la fel', () => {
  const p2 = MEM.indexOf('⟦PAGINA 2⟧')
  // atr reluată: incercari 2, obs_numar 3, obs = []
  assertEquals(completitudineFelii([felie({ de_la: p2, pana_la: MEM.length, incercari: 2, obs_numar: 3, obs_atribuibile: false })], CTX_MEM), [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  // f3 cu ancore și text: NU deficit, ci observatii_neatribuibile (regula (2) decide înaintea porții)
  assertEquals(completitudineFelii([felie({ incercari: 2, obs_numar: 1, obs_atribuibile: false })], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  // rol null + neatribuibile → observatii_neatribuibile (nu rol_nereconstructibil)
  assertEquals(completitudineFelii([felie({ de_la: F3.length, pana_la: F3.length, incercari: 2, obs_numar: 1, obs_atribuibile: false })], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  // reluată FĂRĂ observații → atribuibile (true) → nimic blocat de această regulă
  assertEquals(completitudineFelii([felie({ de_la: p2, pana_la: MEM.length, incercari: 2, obs_numar: 0, obs_atribuibile: true })], CTX_MEM), [])
  // câmpul lipsă / non-boolean = conservator (L18)
  const faraCamp = { ...felie({}) } as Record<string, unknown>; delete faraCamp.obs_atribuibile
  assertEquals(completitudineFelii([faraCamp as unknown as FelieServita], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  assertEquals(completitudineFelii([{ ...felie({}), obs_atribuibile: 'true' as unknown as boolean }], CTX_F3), [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
})

Deno.test('completitudineFelii: determinist — aceeași felie evaluată din rularea cu AI și din cache dă același rezultat (m_deficit_cache, m_neatribuibile_cache)', () => {
  const a = completitudineFelii([felie({ obs: obsF3(F3, '1160.000'), obs_numar: 1 })], CTX_F3)
  const b = completitudineFelii([felie({ obs: obsF3(F3, '1160.000'), obs_numar: 1 })], new Map(CTX_F3))
  assertEquals(a, b)
  const n1 = completitudineFelii([felie({ incercari: 2, obs_numar: 1, obs_atribuibile: false })], CTX_F3)
  const n2 = completitudineFelii([felie({ incercari: 2, obs_numar: 1, obs_atribuibile: false })], new Map(CTX_F3))
  assertEquals(n1, n2)
  // mai multe motive pe aceeași felie: fiecare o intrare (identificată prin extragere, felie, motiv), fără dubluri
  const c6 = '⟦PAGINA 1⟧\nFormular C6\nLista cuprinzand consumurile de resurse materiale\n| 1 | 6701152 | m | 120.00 |\n| 2 | 7330400 | buc | 4.00 |\n| 5 | 6701640 | m | 30.00 |\n'
  const r = completitudineFelii([felie({ de_la: 0, pana_la: c6.length })], new Map([[1, ctx(c6, 'Liste.pdf', 'lista_cantitati')]]))
  assert(r.some((x) => x.motiv === 'deficit'))
  assertEquals(new Set(r.map((x) => x.motiv)).size, r.length)
})

// ─── inventarul rulării ───
Deno.test('paginiRulare: document fără extragere gata → documente_necitite (cu starea din rulare); pagini_necitite = ale documentului ∪ peste limită ∪ peste plafon; felii_incomplete dedup', async () => {
  const d1 = await docFoto(1, F3, 'Formulare.pdf', 'formular', { pagini_necitite: [7], pagini: 10 })
  const d2 = await docFoto(2, MEM, 'Memoriu.pdf', 'alta', { extragere_id: null, pagini: 2 })
  const d3 = await docFoto(3, MEM, 'Caiet.pdf', 'cs_volum', { pagini: 300 })
  const foto: Fotografie = { licitatie_id: 900001, documente: [d1, d2, d3], document_loturi_sha: 'l', stare_loturi: 'fara_loturi', cantitati_sha: 'c', prag: 0.05, plafon: 200, v: 'surse_v1', sha: 's' }
  const r = paginiRulare(foto, new Map([[2, 'in_lucru']]), [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }, { extragere_id: 7, felie_nr: 0, motiv: 'deficit' }], [{ document_id: 3, pagini: [150, 151] }])
  assertEquals(r.documente_necitite, [2])
  assertEquals(r.documente_necitite_stare, [{ document_id: 2, stare: 'in_lucru' }])
  // doc 1: pagina 7 (a documentului); doc 3: 150, 151 (peste plafon în rulare) + 189..300 (peste limita cumulată 10 + 2 + 188 = 200)
  assertEquals(r.pagini_necitite[0], { document_id: 1, pagini: [7] })
  assertEquals(r.pagini_necitite[1].document_id, 3)
  assertEquals([r.pagini_necitite[1].pagini.slice(0, 3), r.pagini_necitite[1].pagini.at(-1), r.pagini_necitite[1].pagini.length], [[150, 151, 189], 300, 2 + 112])
  assertEquals([r.plafon, r.plafon_atins], [200, true])
  assertEquals(r.felii_incomplete, [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }])
  // document necitit fără stare din rulare → eticheta implicită
  assertEquals(paginiRulare(foto, new Map(), [], []).documente_necitite_stare, [{ document_id: 2, stare: 'fara_extragere_gata' }])
  // eligibilitatea: doar documentele pe care extragerea le citește pot fi „necitite” (o planșă / o versiune înlocuită fără extragere nu blochează)
  assertEquals(paginiRulare(foto, new Map(), [], [], new Set([1, 3])).documente_necitite, [])
  assertEquals(paginiRulare(foto, new Map(), [], [], new Set([1, 2, 3])).documente_necitite, [2])
  assertEquals(paginiRulare(foto, new Map(), [], [], null).documente_necitite, [2])
  // paginile și plafonul nu depind de eligibilitate (plafonul numără toate documentele, ca SQL)
  assertEquals(paginiRulare(foto, new Map(), [], [], new Set([1, 3])).pagini_necitite, paginiRulare(foto, new Map(), [], []).pagini_necitite)
})

Deno.test('rezumatSemnale: răspuns mixt al publicării; fără semnale / formă străină → zerouri', () => {
  const r = rezumatSemnale({ evaluare_id: 1, semnale: [{ verdict: 'diferenta' }, { verdict: 'diferenta' }, { verdict: 'de_verificat' }, { verdict: 'neverificat' }, { verdict: 'in_regula' }, { verdict: 'ciudat' }], n: 6 })
  assertEquals(r, { diferente: 2, de_verificat: 1, neverificate: 1, in_regula: 1, altele: 1, total: 6 })
  assertEquals(rezumatSemnale(null), { diferente: 0, de_verificat: 0, neverificate: 0, in_regula: 0, altele: 0, total: 0 })
  assertEquals(rezumatSemnale({ semnale: 'x' }), { diferente: 0, de_verificat: 0, neverificate: 0, in_regula: 0, altele: 0, total: 0 })
})

Deno.test('eFotografie: forma minimă (sha, documente[], plafon finit); orice altceva = nu e fotografie', () => {
  assertEquals(eFotografie({ sha: 'a', documente: [], plafon: 200, licitatie_id: 1 }), true)
  for (const x of [null, {}, { ok: true }, { sha: 'a', documente: 'x', plafon: 200 }, { sha: 'a', documente: [], plafon: 'y' }, { sha: 1, documente: [], plafon: 200 }]) assertEquals(eFotografie(x), false, JSON.stringify(x))
})
