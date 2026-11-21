// ═══════════════════════════════════════════════════════════════════════════
// citeste_extrase.mjs — materialele din ofertă, faza 2: extrasele Excel (C6–C9)
// → previzualizare pe proiect. Determinist, fără AI, fără BD: nu scrie nimic în ERP.
//
//   node scripts/materiale_oferta/citeste_extrase.mjs --surse <dir> --iesire <dir>
//
// <surse> conține câte un folder P<id> per proiect, cu EXACT un extras .xls/.xlsx.
// În <iesire> scrie (fără să șteargă altceva):
//   P<id>.tsv           liniile C6 (materiale), cu sursa (foaie, rând) și starea ok / de_verificat
//   P<id>_resurse.tsv   manoperă (C7), utilaj (C8), transport (C9)
//   rezumat.md          pe proiect: linii, total, comparația cu TOTAL tipărit, liniile suspecte
//   manifest.json       SHA-256 al fiecărei surse + cifrele de control (pentru importul ulterior)
// Cod de ieșire: 0 = toate citite; 1 = cel puțin un proiect cu eroare de citire (celelalte se scriu oricum).
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { citesteExtras, tsvMateriale, tsvResurse, rezumatProiect, VERSIUNE } from './extrase_lib.mjs'

const fmt = (x) => (x == null ? '—' : x.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export async function ruleaza({ surse, iesire, acum = new Date() }) {
  if (!surse || !iesire) throw new Error('lipsește --surse sau --iesire')
  const dirs = fs.readdirSync(surse, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^P\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  fs.mkdirSync(iesire, { recursive: true })
  const proiecte = []
  const sectiuni = []
  for (const p of dirs) {
    const fisiere = fs.readdirSync(path.join(surse, p)).filter((f) => /\.xlsx?$/i.test(f))
    if (fisiere.length !== 1) {
      const mesaj = `aștept exact un extras .xls/.xlsx, am găsit ${fisiere.length}${fisiere.length ? ': ' + fisiere.join(', ') : ''}`
      proiecte.push({ proiect: p, eroare: mesaj })
      sectiuni.push(`## ${p}\n\n- EROARE: ${mesaj}\n`)
      continue
    }
    const fisier = fisiere[0]
    const buf = fs.readFileSync(path.join(surse, p, fisier))
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    let rez
    try { rez = await citesteExtras(buf) } catch (e) {
      proiecte.push({ proiect: p, fisier, sha256, eroare: `fișierul nu se poate citi: ${e.message}` })
      sectiuni.push(`## ${p} — \`${fisier}\`\n\n- EROARE: fișierul nu se poate citi: ${e.message}\n`)
      continue
    }
    if (rez.foi.C6) fs.writeFileSync(path.join(iesire, `${p}.tsv`), tsvMateriale(p, fisier, rez.foi.C6))
    fs.writeFileSync(path.join(iesire, `${p}_resurse.tsv`), tsvResurse(p, fisier, rez.foi))
    sectiuni.push(rezumatProiect({ proiect: p, fisier, sha256, rez }))
    const c6 = rez.foi.C6
    const control = (s) => (s ? { linii: s.linii.length, suma: s.suma, total_tiparit: s.total_tiparit, diferenta: s.diferenta, concorda: s.concorda,
      de_verificat: s.linii.filter((l) => l.stare === 'de_verificat').length + s.nerecunoscute.length } : null)
    proiecte.push({
      proiect: p, fisier, sha256, completa: rez.completa,
      erori: rez.erori, foi_ignorate: rez.ignorate.map((g) => g.foaie),
      materiale: c6 ? { ...control(c6), linii_import: rez.paritate?.linii_import ?? null, valoare_import: rez.paritate?.valoare_import ?? null, paritate_ok: !!rez.paritate?.ok } : null,
      manopera: control(rez.foi.C7), utilaj: control(rez.foi.C8), transport: control(rez.foi.C9),
    })
  }

  // tabelul general + secțiunile pe proiect
  const t = ['| Proiect | Linii C6 | Valoare materiale (lei) | TOTAL tipărit (lei) | Diferență | De verificat | Import ERP actual (lei) | Stare |', '|---|---|---|---|---|---|---|---|']
  for (const x of proiecte) {
    if (x.eroare) { t.push(`| ${x.proiect} | — | — | — | — | — | — | EROARE |`); continue }
    const m = x.materiale
    if (!m) { t.push(`| ${x.proiect} | — | — | — | — | — | — | fără C6 |`); continue }
    t.push(`| ${x.proiect} | ${m.linii} | ${fmt(m.suma)} | ${fmt(m.total_tiparit)} | ${m.concorda === true ? '0' : m.concorda === false ? fmt(m.diferenta) : 'necunoscut'} | ${m.de_verificat} | ${fmt(m.valoare_import)} | ${x.completa ? 'completă' : 'incompletă'} |`)
  }
  const md = [
    '# Materialele din ofertă — previzualizare din extrasele Excel (faza 2)', '',
    `Generat ${acum.toISOString()} de \`scripts/materiale_oferta/citeste_extrase.mjs\` (${VERSIUNE}). Citire deterministă, fără AI; nimic nu e scris în ERP.`,
    'Fișierele `P<id>.tsv` au zecimalele cu punct; `stare = de_verificat` înseamnă că linia trebuie văzută de un om înainte de import.',
    '„Import ERP actual” = ce ar insera azi butonul de import din ecranul Materiale (liniile fără cantitate, ca materialul mărunt, nu intră).', '',
    ...t, '', ...sectiuni,
  ].join('\n')
  fs.writeFileSync(path.join(iesire, 'rezumat.md'), md)
  fs.writeFileSync(path.join(iesire, 'manifest.json'), JSON.stringify({ versiune: VERSIUNE, generat_la: acum.toISOString(), proiecte }, null, 2) + '\n')
  return { proiecte, ok: proiecte.every((x) => !x.eroare) }
}

function argumente(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--surse') a.surse = argv[++i]
    else if (argv[i] === '--iesire') a.iesire = argv[++i]
    else throw new Error(`argument necunoscut: ${argv[i]}`)
  }
  return a
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { proiecte, ok } = await ruleaza(argumente(process.argv.slice(2)))
    for (const x of proiecte) {
      console.log(x.eroare ? `${x.proiect}: EROARE ${x.eroare}`
        : `${x.proiect}: ${x.materiale?.linii ?? 0} linii C6, ${fmt(x.materiale?.suma)} lei vs TOTAL ${fmt(x.materiale?.total_tiparit)}, de verificat ${x.materiale?.de_verificat ?? '—'}, ${x.completa ? 'completă' : 'incompletă'}`)
    }
    process.exitCode = ok ? 0 : 1
  } catch (e) { console.error('EROARE: ' + e.message); process.exitCode = 1 }
}
