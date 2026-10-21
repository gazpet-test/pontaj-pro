// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — payload-ul de TEST pentru proiectul „TEST IZOMETRIE” (testul Janetei), FĂRĂ scriere în BD
// ════════════════════════════════════════════════════════════════════════
// Citește documentele de test generate de chat (C:\Users\Public\claude-server\pv_test: 2 avize de țeavă + 1 listă de
// ambalare curbe, date fictive 999TS… / TS… / heat 999…, gen/totals.json) și scrie, ca la preview-ul LOT 2:
//   • raportul markdown (<iesire.md>): bucăți pe document, refuzate, carantină, totaluri vs. ținta din totals.json;
//   • payload-ul pentru public.fn_izo_import_sold_initial (<iesire>.payload.json) — doar dacă totalurile bat.
// Deciziile de recepție sunt cele din fișa de test (FISA_SCENARII_TEST.pdf):
//   – avizul 2, rândul 7 (999TS00210) refuzat la recepție → nu intră (D#14);
//   – avizul 2, rândul 11 (999TS00216) măsurat 12,19 m față de 12,22 pe aviz → intră cu lungimea din aviz + observație
//     (lungimea măsurată separată vine în E3);
//   – curba 9006: 45° pe listă, 30° măsurat → intră în CARANTINĂ (nedisponibilă), cu observație.
// Aplicarea o face DOAR sesiunea de chat, după „da”-ul lui Razvan, pe proiectul de test (niciodată pe LOT 1 / LOT 2):
//   fn_izo_import_sold_initial(<proiect_test>, '<import_id>', <payload>) — proiectul de test e deja la nivelul „stoc”.
//
//   node scripts/izometrie/payload_test_avize.mjs --pv-test <dir pv_test> --proiect <id> --depozit <id> --iesire <fișier.md>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined }
const dir = arg('pv-test'), proiect = Number(arg('proiect')), depozit = Number(arg('depozit')), iesire = arg('iesire')
if (!dir || !iesire || !Number.isInteger(proiect) || proiect <= 0 || !Number.isInteger(depozit) || depozit <= 0) {
  console.error('folosire: node payload_test_avize.mjs --pv-test <dir> --proiect <id> --depozit <id> --iesire <fișier.md>')
  console.error('  --proiect / --depozit = id-urile REALE ale proiectului „TEST IZOMETRIE” și ale depozitului lui (obligatorii)')
  process.exit(2)
}
const payloadPath = iesire.replace(/\.md$/, '') + '.payload.json'
fs.rmSync(payloadPath, { force: true })   // un run neaplicabil nu lasă un payload vechi pe disc

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const T = JSON.parse(fs.readFileSync(path.join(dir, 'gen', 'totals.json'), 'utf8'))
const DOC = { a1: 'AVIZ_TEST_1_teava_6m.pdf', a2: 'AVIZ_TEST_2_teava_12m.pdf', c: 'LISTA_AMBALARE_TEST_curbe.pdf' }
const surse = Object.values(DOC).map(f => ({ fisier: f, sha256: sha(path.join(dir, f)) }))

const SPEC = 'Tevi sudate elicoidal 610x7,10 mm, L 360 NE, izolate'
const FURNIZOR = 'FURNIZOR TEST SRL'
const DATA_DOC = '2026-10-22'
const mm = s => Math.round(Number(s) * 1000)
const zec = s => Number(String(s).replace(',', '.'))
const bucati = [], refuzate = [], carantina = []

// țevile de pe cele două avize
for (const [cheie, fisier, nr] of [['aviz1_randuri', DOC.a1, T.aviz1.aviz_nr], ['aviz2_randuri', DOC.a2, T.aviz2.aviz_nr]]) {
  for (const r of T[cheie]) {
    const sursa = { fisier, foaie: 'aviz', rand: r.nr_crt }
    if (fisier === DOC.a2 && r.serie === T.aviz2_extra.nr7) { refuzate.push({ ...sursa, serie: r.serie, m: r.lungime_m, motiv: 'refuzat la recepție (fișa de test)' }); continue }
    const masurat = fisier === DOC.a2 && r.serie === T.aviz2_extra.nr11 ? T.aviz2_extra.L11_masurat : null
    bucati.push({
      tip: 'teava', serie: r.serie, sarja: r.sarja, lot: String(r.lot), lungime_mm: mm(r.lungime_m), perete_mm: 7.1, diametru_mm: 610,
      greutate_kg: r.kg, stare: 'sosit', depozit_id: depozit, nr_aviz: nr, data_aviz: DATA_DOC, furnizor: FURNIZOR,
      grad_otel: 'L360NE', descriere: SPEC,
      observatii: masurat ? `măsurat la recepție ${String(masurat).replace('.', ',')} m față de ${String(r.lungime_m).replace('.', ',')} m pe aviz` : undefined,
      sursa,
    })
  }
}
// curbele de pe lista de ambalare
for (const r of T.curbe_randuri) {
  const neconforma = r.bend === T.curbe.curba_neconforma
  const b = {
    tip: 'curba', serie: String(r.bend), sarja: String(r.heat), unghi_curba: r.deg, perete_mm: zec(r.wall), diametru_mm: r.size,
    greutate_kg: r.net, standard: r.std, stare: neconforma ? 'carantina' : 'sosit', depozit_id: depozit,
    nr_aviz: 'TEST-FACT-0001', data_aviz: DATA_DOC, furnizor: FURNIZOR, descriere: `${r.desc} ${r.code}`,
    observatii: [`pachet ${r.pkg}`, neconforma ? `NECONFORM: măsurat ${T.curbe.grade_masurat}° față de ${r.deg}° pe listă — CARANTINĂ, nedisponibilă la montaj` : null].filter(Boolean).join(' · '),
    sursa: { fisier: DOC.c, foaie: 'lista', rand: T.curbe_randuri.indexOf(r) + 1 },
  }
  if (neconforma) carantina.push(b)
  bucati.push(b)
}

// verificări: totalurile documentelor (inclusiv refuzatul) și ținta din fișă
const suma = (lista, f) => lista.reduce((s, x) => s + f(x), 0)
const m2 = n => (Math.round(n) / 1000).toFixed(2)
const verif = []
const ok = (et, a, b) => verif.push({ et, a: String(a), b: String(b), bun: String(a) === String(b) })
for (const [cheie, t] of [['aviz1_randuri', T.aviz1], ['aviz2_randuri', T.aviz2]]) {
  ok(`${t.document}: rânduri`, T[cheie].length, t.randuri)
  ok(`${t.document}: Σ m (inclusiv refuzate)`, m2(suma(T[cheie], r => mm(r.lungime_m))), t.metri)
  ok(`${t.document}: Σ kg`, suma(T[cheie], r => r.kg), t.kg)
}
ok('curbe: bucăți', T.curbe_randuri.length, T.curbe.bucati)
ok('curbe: pachete', new Set(T.curbe_randuri.map(r => r.pkg)).size, T.curbe.pachete)
ok('curbe: Σ net kg', suma(T.curbe_randuri, r => r.net), T.curbe.net_kg)
ok('curbe: Σ brut kg', suma(T.curbe_randuri, r => r.gross), T.curbe.brut_kg)
const disp = bucati.filter(b => b.stare === 'sosit')
ok('ținta: bucăți disponibile', disp.length, T.asteptat.erp.card.disponibil.n)
ok('ținta: metri disponibili', m2(suma(disp, b => b.lungime_mm || 0)), T.asteptat.erp.card.disponibil.m)
ok('ținta: în carantină', carantina.length, T.asteptat.erp.card.carantina.n)
ok('ținta: în listă (fără refuzat)', bucati.length, T.asteptat.erp.lista.n)
const serii = new Set(), dubluri = []
for (const b of bucati) { const k = `${b.tip}|${b.serie}|${b.sarja}|${b.unghi_curba ?? ''}`; if (serii.has(k)) dubluri.push(k); serii.add(k) }
ok('fără dubluri în payload', dubluri.length, 0)
const aplicabil = verif.every(v => v.bun)

const L = []
L.push('# Izometrie — payload de TEST (proiectul „TEST IZOMETRIE”), fără scriere în BD', '')
L.push(`Generat: ${new Date().toISOString()} · \`scripts/izometrie/payload_test_avize.mjs\` · proiect ${proiect}, depozit ${depozit}. **Doar pentru proiectul de test.** Documentele sunt fictive (date de test).`, '')
L.push('## Sursele', ...surse.map(s => `- \`${s.fisier}\` · sha256 \`${s.sha256}\``), '')
L.push('## Verificări', '| verificare | calculat | așteptat | |', '|---|---|---|---|', ...verif.map(v => `| ${v.et} | ${v.a} | ${v.b} | ${v.bun ? '✓' : '✗'} |`), '')
L.push(`## Refuzate la recepție (nu intră): ${refuzate.length}`, ...refuzate.map(r => `- ${r.fisier} r${r.rand} · ${r.serie} · ${r.m} m · ${r.motiv}`), '')
L.push(`## În carantină (intră, nedisponibile): ${carantina.length}`, ...carantina.map(b => `- curba ${b.serie} · heat ${b.sarja} · ${b.unghi_curba}° · ${b.observatii}`), '')
L.push(`## Bucăți în payload: ${bucati.length} (țevi ${bucati.filter(b => b.tip === 'teava').length}, curbe ${bucati.filter(b => b.tip === 'curba').length})`, '')
L.push('## Verdict', '')
if (aplicabil) {
  const txt = JSON.stringify({ motiv: 'Date de TEST pentru recepția Izometrie (documente fictive, proiect TEST IZOMETRIE)', surse, bucati }, null, 1)
  fs.writeFileSync(payloadPath + '.tmp', txt + '\n'); fs.renameSync(payloadPath + '.tmp', payloadPath)
  L.push(`**APLICABIL.** Payload: \`${path.basename(payloadPath)}\` (${bucati.length} bucăți, sha256 fișier \`${crypto.createHash('sha256').update(txt + '\n').digest('hex')}\`). Se aplică DOAR pe proiectul de test, de sesiunea de chat, după „da”-ul lui Razvan: \`fn_izo_import_sold_initial(${proiect}, 'test-receptie-1', <payload>)\` (proiectul la nivelul „stoc”).`)
} else L.push('**NEAPLICABIL** — verificările de mai sus nu bat; payload-ul nu s-a scris.')
fs.writeFileSync(iesire, L.join('\n') + '\n')
console.log(`${aplicabil ? 'APLICABIL' : 'NEAPLICABIL'} · ${bucati.length} bucăți · disponibile ${disp.length} / ${m2(suma(disp, b => b.lungime_mm || 0))} m · carantină ${carantina.length} · scris ${iesire}`)
process.exit(aplicabil ? 0 : 1)
