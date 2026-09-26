// deno test --node-modules-dir=none --no-lock supabase/functions/ofertare-cantitati-extrage/sectiuni_test.ts
// Secțiunile unei liste de cantități (F3 / C6 / C7–C9) și tip_sursa scris de handler.
// Fixture-ul imită STRUCTURA doc 434 Jilava (antete eDevize, marcaje ⟦PAGINA n⟧, subsoluri „Formular …"),
// cu rânduri inventate — nu e textul documentului.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { FELIE, SUPRAPUNERE, felii, feliiDocument, sectiuniLista } from './sectiuni.ts'
import { cerere, fakeSupa, getUser, LICITATII, OWNER, PROFILE } from '../_test/fake_supa.ts'
import { handler } from './handler.ts'

// ── fixture ─────────────────────────────────────────────────────
const pagina = (n: number, corp: string) => `⟦PAGINA ${n}⟧\n\n${corp}\n\n`
const cap = 'Beneficiar: UAT Test / Operator Test\nExecutant: Proiectant Test\nObiectivul: Protejare conducta DN700\n'
const paginaF3 = (n: number, obj: string, randuri: string[]) => pagina(n, `${cap}Obiectul: ${obj}\nStadiul fizic: Dev1\nFormular F3\n` +
  `Lista cu cantitati de lucrari pe categorii de lucrari\n\nNr. | Capitol de lucrari | U.M. | Cantitatea | Pretul unitar | TOTALUL\n` +
  `0 | 1 | 2 | 3 | 4 | 5 = 3 x 4\n${randuri.join('\n')}\nTOTAL 1 (Cheltuieli directe) |\n\nDeviz "Dev1" - Formular F3 Pagina 1 din 1\n` +
  'Formular generat cu programul (www.eDevize.ro)')
const paginaC6 = (n: number, cuAntet: boolean, randuri: string[], k: number) => pagina(n, (cuAntet
  ? `${cap}\nFormular C6\nLista cuprinzand consumurile de resurse materiale\n\n| Nr. | Denumirea resursei materiale | U.M. | Consumul cuprins in oferta |\n`
  : 'Nr. | Denumirea resursei materiale | U.M. | Consumul cuprins in oferta\n') + `${randuri.join('\n')}\n\nInvestitie - Formular C6 Pagina ${k} din 2`)
const paginaC = (n: number, f: string, titlu: string, randuri: string[]) =>
  pagina(n, `${cap}\nFormular ${f}\n${titlu}\n\n${randuri.join('\n')}\n\nInvestitie - Formular ${f} Pagina 1 din 1`)

// coperta + deviz general (fără antet de formular) + 2 obiecte F3 + C6 pe 2 pagini + C7 + C8 + C9
function docJilava(umplutura = 0): string {
  const f3 = [
    paginaF3(10, 'Obj1 Terasamente drum principal', ['1 | TSE01C1 - Sapatura manuala | 100 mp | 121.500 | |', '1.1 | 2200044 - Pietris nespalat | mc | 2.680 | |']),
    paginaF3(11, 'Obj3 Montare tub de protectie', ['4 | IZZ-PC-DN700 - Izolarea cu patura ceramica | mp | 85.950 | |']),
  ]
  // umplutura: pagini F3 în plus, ca secțiunea F3 să treacă de 2 felii (testul de felii)
  for (let i = 0; i < umplutura; i++) f3.push(paginaF3(12 + i, 'Obj4 Umplutura', [`${i + 1} | TSD06A1 - Umplutura ${'x'.repeat(2000)} | mc | 1.000 | |`]))
  return pagina(1, 'CANTITATI DE LUCRARI\nDEVIZ GENERAL\nCapitolul 4 | Cheltuieli pentru investitia de baza |') + f3.join('') +
    paginaC6(76, true, ['| 1 | 20010013 - Material marunt | % | | | | Depozit | 0.000 |', '| 2 | 2100012 - Ciment portland | kg | 470.400 | | | Depozit | 0.470 |'], 1) +
    paginaC6(77, false, ['23 | 3304811 - Teava pentru instalatii | m | 0.280 | | | Depozit | 0.000'], 2) +
    paginaC(81, 'C7', 'Lista cuprinzand consumurile cu mana de lucru', ['1 | 11000 - Betonist | 8.629 | | |']) +
    paginaC(82, 'C8', 'Lista cuprinzand consumurile de ore de functionare a utilajelor de constructii', ['1 | 2509 - Motocompresor de aer | 35.846 | |']) +
    paginaC(83, 'C9', 'Lista cuprinzand consumurile privind transporturile', ['| TOTAL Transport | | | | |'])
}
// felii() de dinainte de 25.09.2026 (copie), pentru testele de nemodificare
const feliiVechi = (t: string) => { if (t.length <= 55000) return [t]; const o: string[] = []; for (let i = 0; i < t.length; i += 53000) o.push(t.slice(i, i + 55000)); return o }
const tipLa = (t: string, poz: number) => sectiuniLista(t).find((s) => poz >= s.de && poz < s.pana)?.tip

// ── sectiuniLista ───────────────────────────────────────────────
Deno.test('sectiuni: F3 + C6 + C7–C9 în același PDF → 3 secțiuni, granița la începutul paginii antetului', () => {
  const t = docJilava()
  const s = sectiuniLista(t)
  assertEquals(s.map((x) => x.tip), ['lista_f3', 'lista_c6', 'lista_alt'])
  assertEquals(s.map((x) => x.de), [0, t.indexOf('⟦PAGINA 76⟧'), t.indexOf('⟦PAGINA 81⟧')])
  assertEquals(s[2].pana, t.length)
  for (let i = 1; i < s.length; i++) assertEquals(s[i - 1].pana, s[i].de, 'secțiuni lipite, fără goluri')
})
Deno.test('sectiuni: fiecare rând cade în secțiunea formularului lui (C6 fără antet pe pagina 2 rămâne C6)', () => {
  const t = docJilava()
  assertEquals(tipLa(t, t.indexOf('TSE01C1')), 'lista_f3')
  assertEquals(tipLa(t, t.indexOf('2200044 - Pietris')), 'lista_f3', 'sub-rândul de material din F3 e F3')
  assertEquals(tipLa(t, t.indexOf('IZZ-PC-DN700')), 'lista_f3')
  assertEquals(tipLa(t, t.indexOf('20010013 - Material marunt')), 'lista_c6')
  assertEquals(tipLa(t, t.indexOf('3304811 - Teava')), 'lista_c6', 'pagina 77 n-are antet, doar subsol C6')
  assertEquals(tipLa(t, t.indexOf('11000 - Betonist')), 'lista_alt')
  assertEquals(tipLa(t, t.indexOf('2509 - Motocompresor')), 'lista_alt')
  assertEquals(tipLa(t, t.indexOf('TOTAL Transport')), 'lista_alt')
  assertEquals(tipLa(t, t.indexOf('DEVIZ GENERAL')), 'lista_f3', 'coperta ține de primul formular (ca înainte)')
})
Deno.test('sectiuni: fără niciun antet → o secțiune lista_f3 pe tot textul (comportamentul vechi)', () => {
  const t = 'Lista oarecare\n1 | Conducta PE DN110 | m | 120 |\n'.repeat(40)
  assertEquals(sectiuniLista(t), [{ de: 0, pana: t.length, tip: 'lista_f3' }])
})
Deno.test('sectiuni: fișier C6 separat (tip Domnești) → tot lista_c6, inclusiv preambulul', () => {
  const t = pagina(1, `${cap}\nFormular C6\nLista cuprinzand consumurile de resurse materiale\n| 1 | 2100012 - Ciment | kg | 470.400 |`)
  assertEquals(sectiuniLista(t), [{ de: 0, pana: t.length, tip: 'lista_c6' }])
  const t8 = pagina(1, `${cap}\nFormular C8\nLista cuprinzand consumurile de ore de functionare a utilajelor\n1 | 2509 - Motocompresor | 35.846 |`)
  assertEquals(sectiuniLista(t8)[0].tip, 'lista_alt')
})
Deno.test('sectiuni: listă F3 doar cu titlul „Lista cu cantități de lucrări" (fără „Formular F3", tip Racari) → F3', () => {
  const t = 'Obiect 1\nLista cu cantități de lucrări pe categorii de lucrări\n1 | TSC03B1 - Sapatura | mc | 12 |\n'
  assertEquals(sectiuniLista(t).map((s) => s.tip), ['lista_f3'])
})
Deno.test('sectiuni: antet C6 doar în SUBSOLUL primei pagini → rândurile de pe pagina aceea sunt tot C6', () => {
  const t = paginaF3(10, 'Obj1', ['1 | TSE01C1 - Sapatura | 100 mp | 121.500 |']) +
    pagina(11, '| 1 | 2100012 - Ciment portland | kg | 470.400 |\n\nInvestitie - Formular C6 Pagina 1 din 1')
  assertEquals(tipLa(t, t.indexOf('2100012 - Ciment')), 'lista_c6')
  assertEquals(tipLa(t, t.indexOf('TSE01C1')), 'lista_f3')
})
Deno.test('sectiuni: fără marcaje de pagină → granița e chiar la antet', () => {
  const t = 'Formular F3\n1 | TSE01C1 - Sapatura | 100 mp | 121.500 |\nFormular C6\n| 1 | 2100012 - Ciment | kg | 470.400 |\n'
  const s = sectiuniLista(t)
  assertEquals(s.map((x) => [x.de, x.tip]), [[0, 'lista_f3'], [t.indexOf('Formular C6'), 'lista_c6']])
})
Deno.test('sectiuni: „Formular C 60" / „C61" NU sunt C6; diacriticele din titlu sunt acceptate', () => {
  assertEquals(sectiuniLista('Formular F3\nx\nFormular C 60\ny\nFormular C61\nz').map((s) => s.tip), ['lista_f3'])
  assertEquals(sectiuniLista('Formular F3\nx\nLista cuprinzând consumurile de resurse materiale\ny').map((s) => s.tip), ['lista_f3', 'lista_c6'])
})

// ── felii ───────────────────────────────────────────────────────
Deno.test('felii: document fără secțiuni diferite → felii IDENTICE cu varianta veche (F3 lung, alta, cs_volum)', () => {
  assertEquals([FELIE, SUPRAPUNERE], [55000, 2000])
  const f3Lung = ('Formular F3\nLista cu cantitati de lucrari pe categorii de lucrari\n' + '1 | TSE01C1 - Sapatura | 100 mp | 1.000 |\n'.repeat(60)).repeat(80)
  assert(f3Lung.length > 3 * 53000)
  assertEquals(feliiDocument(f3Lung, 'lista_cantitati').map((f) => f.bucata), feliiVechi(f3Lung))
  assert(feliiDocument(f3Lung, 'lista_cantitati').every((f) => f.tipSursa === 'lista_f3'))
  const alt = 'Formular C6\n'.repeat(10) + 'text'.repeat(40000)   // „alta" nu se secționează chiar dacă pomenește C6
  for (const tip of ['alta', 'cs_volum']) {
    const fd = feliiDocument(alt, tip)
    assertEquals(fd.map((f) => f.bucata), feliiVechi(alt))
    assert(fd.every((f) => f.tipSursa === null))
  }
  assertEquals(felii('scurt'), ['scurt'])
})
Deno.test('felii: F3 lung + C6 + C7–C9 → felii F3, apoi C6, apoi alt; nicio felie nu amestecă formulare', () => {
  const t = docJilava(60)   // ~130k caractere de F3 → 3 felii F3
  const fd = feliiDocument(t, 'lista_cantitati')
  assertEquals(fd.map((f) => f.tipSursa), ['lista_f3', 'lista_f3', 'lista_f3', 'lista_c6', 'lista_alt'])
  assertEquals(fd.map((f) => f.nr), [1, 2, 3, 4, 5])
  assert(fd.every((f) => f.din === 5))
  assertEquals(fd.map((f) => f.inceputSectiune), [true, false, false, true, true])
  for (const f of fd) {
    const are = (re: RegExp) => re.test(f.bucata)
    assert(!(are(/Formular F3/) && are(/Formular C[6-9]/)), `felia ${f.nr} amestecă F3 cu C6–C9`)
  }
  assert(fd[3].bucata.includes('20010013 - Material marunt') && fd[3].bucata.includes('3304811 - Teava'))
  assert(fd[4].bucata.includes('11000 - Betonist') && fd[4].bucata.includes('TOTAL Transport'))
  // tot textul e acoperit: ultima felie F3 se termină exact unde începe C6
  assertEquals(fd[2].bucata.slice(-20), t.slice(t.indexOf('⟦PAGINA 76⟧') - 20, t.indexOf('⟦PAGINA 76⟧')))
})

// ── handler: ce tip_sursa s-ar scrie ────────────────────────────
// Modelul simulat răspunde după ce vede în felie (ca un model real, care copiază rândurile din bucată).
function fetchDupaFelie(n: { ai: number }): typeof fetch {
  return ((_u: unknown, init?: RequestInit) => {
    n.ai++
    const text: string = JSON.parse(String(init?.body)).input[0].content[0].text
    const bucata = text.slice(text.indexOf('--- BUCATA'))
    const p: unknown[] = []
    if (bucata.includes('TSE01C1')) p.push(['Obj1 Terasamente drum principal', 'TSE01C1', 'Sapatura manuala', 'mp', 121.5, 'F3 Obj1 poz.1', 0])
    if (bucata.includes('IZZ-PC-DN700')) p.push(['Obj3 Montare tub de protectie', 'IZZ-PC-DN700', 'Izolarea cu patura ceramica', 'mp', 85.95, 'F3 Obj3 poz.4', 0])
    if (bucata.includes('2100012 - Ciment')) p.push([null, '2100012', 'Ciment portland', 'kg', 470.4, 'C6 poz.2', 0])
    if (bucata.includes('3304811 - Teava')) p.push([null, '3304811', 'Teava pentru instalatii', 'm', 0.28, 'C6 poz.23', 0])
    if (bucata.includes('11000 - Betonist')) p.push([null, '11000', 'Betonist', 'ore', 8.629, 'C7 poz.1', 0])
    if (bucata.includes('Conducta PE')) p.push(['Obiect 1', null, 'Conducta PE Dn110', 'm', 120, 'memoriu cap.3', 0])
    const corp = { output_text: JSON.stringify({ p }), usage: { input_tokens: 100, output_tokens: 20 }, status: 'completed' }
    return Promise.resolve(new Response(JSON.stringify(corp), { status: 200 }))
  }) as typeof fetch
}
function ruleaza(docs: Record<string, unknown>[], body: Record<string, unknown>) {
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: docs })
  const deps = { db: supa, getUser, fetch: fetchDupaFelie(n), chei: { A: 'a', G: 'g', O: 'o' } }
  return handler(cerere(OWNER, body), deps).then(async (r) => ({ status: r.status, j: await r.json(), n }))
}
const scrise = (n: { upsertate: { tabel: string; rows: any[] }[] }) =>
  n.upsertate.filter((u) => u.tabel === 'ofertare_cantitati').flatMap((u) => u.rows)

const DOC_LISTA = { id: 1, licitatie_id: 95, nume_original: 'LST-002 Cantitati de lucrari.pdf', tip: 'lista_cantitati', text_extras: docJilava() }
const DOC_MEMORIU = { id: 2, licitatie_id: 95, nume_original: 'Memoriu.pdf', tip: 'cs_volum', text_extras: 'Formular C6 pomenit in memoriu. Conducta PE Dn110 120 m.\n'.repeat(20) }

Deno.test('handler: rândurile C6 → lista_c6, C7 → lista_alt, F3 → lista_f3; memoriul fără tip_sursa', async () => {
  const r = await ruleaza([DOC_LISTA, DOC_MEMORIU], { licitatie_id: 95 })
  assertEquals(r.status, 200)
  assertEquals(r.j.felii_total, 4)   // lista: F3 | C6 | C7–C9 ; memoriu: 1
  const rows = scrise(r.n)
  const tip = (cod: string) => rows.find((x) => x.cod_articol === cod)?.tip_sursa
  assertEquals(tip('TSE01C1'), 'lista_f3')
  assertEquals(tip('IZZ-PC-DN700'), 'lista_f3')
  assertEquals(tip('2100012'), 'lista_c6')
  assertEquals(tip('3304811'), 'lista_c6')
  assertEquals(tip('11000'), 'lista_alt')
  const mem = rows.find((x) => x.denumire === 'Conducta PE Dn110')
  assert(mem && !('tip_sursa' in mem), 'documentele care nu sunt liste de cantități rămân fără tip_sursa')
  assertEquals(r.j.pe_tip_sursa, { lista_f3: 2, lista_c6: 2, lista_alt: 1, null: 1 })
  assertEquals(r.j.raport.map((x: any) => x.tip_sursa ?? null), ['lista_f3', 'lista_c6', 'lista_alt', null])
})
Deno.test('handler: obiectul F3 NU se moștenește pe rândurile C6 (C6 e pe investiție)', async () => {
  const r = await ruleaza([DOC_LISTA], { licitatie_id: 95 })
  const rows = scrise(r.n)
  assertEquals(rows.find((x) => x.cod_articol === 'IZZ-PC-DN700')?.obiect, 'Obj3 Montare tub de protectie')
  assertEquals(rows.find((x) => x.cod_articol === '2100012')?.obiect, null)
  assertEquals(rows.find((x) => x.cod_articol === '11000')?.obiect, null)
})
Deno.test('handler: reluare (de_la) exact pe felia C6 → fără căutarea obiectului anterior, tip lista_c6', async () => {
  const r = await ruleaza([DOC_LISTA], { licitatie_id: 95, de_la: 1, max_felii: 1 })
  assertEquals(r.status, 200)
  assertEquals(r.j.continua, true); assertEquals(r.j.urmatorul, 2)
  assertEquals(r.n.citiri.filter((t) => t === 'ofertare_cantitati').length, 1, 'doar upsert-ul, fără SELECT obiect')
  assert(scrise(r.n).every((x) => x.tip_sursa === 'lista_c6'))
  assertEquals(r.j.raport, [{ doc: DOC_LISTA.nume_original, bucata: '2/3', tip_sursa: 'lista_c6', pozitii: 2 }])
})
