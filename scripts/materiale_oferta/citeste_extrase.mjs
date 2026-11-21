// ═══════════════════════════════════════════════════════════════════════════
// citeste_extrase.mjs — materialele din ofertă, faza 2: extrasele Excel (C6–C9)
// → previzualizare pe proiect. Determinist, fără AI, fără BD: nu scrie nimic în ERP.
//
//   node scripts/materiale_oferta/citeste_extrase.mjs --surse <dir> --iesire <dir>
//
// <surse> conține câte un folder P<id> per proiect, cu EXACT un extras .xls/.xlsx.
// În <iesire> scrie (fără să șteargă altceva):
//   P<id>.tsv           liniile C6 (materiale), cu sursa (foaie, rând) și starea ok / de_verificat
//   P<id>_resurse.tsv   manoperă (C7), utilaj (C8), transport (C9): INFORMATIV, `certificat = nu`, nu se importă
//   rezumat.md          pe proiect: linii, total, comparația cu TOTAL tipărit, liniile suspecte
//   manifest.json       SHA-256 al fiecărei surse + cifrele de control; `completa` certifică DOAR C6
// Cod de ieșire: 0 = toate citite fără nicio eroare; 1 = cel puțin o eroare de citire / parsare (fișier ilizibil,
// antet invalid, C6 lipsă, foaie dublă, importul din ERP care nu citește fișierul, eroare pe o foaie C7–C9) sau niciun proiect găsit.
// Celelalte proiecte se scriu oricum. Un extras citit fără erori, dar `incomplet` (motivele în rezumat) iese cu 0.
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
    const cifre = (s) => ({ linii: s.linii.length, suma: s.suma, total_tiparit: s.total_tiparit, diferenta: s.diferenta, concorda: s.concorda,
      de_verificat: s.linii.filter((l) => l.stare === 'de_verificat').length + s.nerecunoscute.length })
    // resursele: cifrele lor sunt informative (certificat = false); `foaie_completa` = controalele foii, nu certificare
    const informativ = (s) => (s ? { ...cifre(s), certificat: false, foaie_completa: s.completa, motive_foaie: s.motive_incomplet } : null)
    proiecte.push({
      // `completa` și `motive_incomplet` = certificarea C6 (singurul formular importat)
      proiect: p, fisier, sha256, certificat: rez.certificat, completa: rez.completa, motive_incomplet: rez.motive_incomplet,
      erori: rez.erori, erori_resurse: rez.erori_resurse, foi_ignorate: rez.ignorate.map((g) => g.foaie),
      materiale: c6 ? {
        ...cifre(c6), certificat: true, completa: c6.completa,
        linii_import: rez.paritate?.linii_import ?? null, valoare_import: rez.paritate?.valoare_import ?? null, paritate_ok: !!rez.paritate?.ok,
        linii_lipsa_import: rez.paritate?.linii_lipsa?.length ?? null, omise_admise: rez.paritate?.omise_admise?.length ?? null,
      } : null,
      resurse: { certificat: false, resurse_complete: rez.resurse_complete, motive_resurse_incomplete: rez.motive_resurse_incomplete },
      manopera: informativ(rez.foi.C7), utilaj: informativ(rez.foi.C8), transport: informativ(rez.foi.C9),
    })
  }
  if (!dirs.length) sectiuni.push(`## (niciun proiect)\n\n- EROARE: în ${surse} nu e niciun folder P<id>\n`)

  // tabelul general + secțiunile pe proiect
  const t = ['| Proiect | Linii C6 | Valoare materiale (lei) | TOTAL tipărit (lei) | Diferență | De verificat | Import ERP actual (lei) | Stare C6 (certificat) | Resurse C7–C9 (informativ) |', '|---|---|---|---|---|---|---|---|---|']
  const resText = (x) => (x.resurse?.resurse_complete ? 'controale trec' : 'controale nu trec')
  for (const x of proiecte) {
    if (x.eroare) { t.push(`| ${x.proiect} | — | — | — | — | — | — | EROARE | — |`); continue }
    const m = x.materiale
    if (!m) { t.push(`| ${x.proiect} | — | — | — | — | — | — | fără C6 | ${resText(x)} |`); continue }
    t.push(`| ${x.proiect} | ${m.linii} | ${fmt(m.suma)} | ${fmt(m.total_tiparit)} | ${m.concorda === true ? '0' : m.concorda === false ? fmt(m.diferenta) : 'necunoscut'} | ${m.de_verificat} | ${fmt(m.valoare_import)} | ${x.completa ? 'completă' : 'incompletă'} | ${resText(x)} |`)
  }
  const md = [
    '# Materialele din ofertă — previzualizare din extrasele Excel (faza 2)', '',
    `Generat ${acum.toISOString()} de \`scripts/materiale_oferta/citeste_extrase.mjs\` (${VERSIUNE}). Citire deterministă, fără AI; nimic nu e scris în ERP.`,
    'Se certifică și se importă DOAR materialele (C6): „Stare C6” și cifrele de control privesc numai C6. Manopera, utilajele și transportul (C7–C9) sunt informative, în `P<id>_resurse.tsv` cu `certificat = nu`; controalele lor se văd separat și nu schimbă starea C6.',
    'Fișierele `P<id>.tsv` au zecimalele cu punct; `stare = de_verificat` înseamnă că linia trebuie văzută de un om înainte de import.',
    '„Import ERP actual” = ce ar insera azi butonul de import din ecranul Materiale (liniile fără cantitate, ca materialul mărunt, nu intră).', '',
    ...t, '', ...sectiuni,
  ].join('\n')
  fs.writeFileSync(path.join(iesire, 'rezumat.md'), md)
  fs.writeFileSync(path.join(iesire, 'manifest.json'), JSON.stringify({ versiune: VERSIUNE, generat_la: acum.toISOString(), proiecte }, null, 2) + '\n')
  // orice eroare de citire sau parsare = eșec (L13, L18): cele pe C6 / import (rez.erori: C6 lipsă, antet invalid, import ilizibil)
  // și cele pe foile informative (rez.erori_resurse), ca să nu rămână ascunse; ele NU schimbă însă `completa` (C6)
  return { proiecte, ok: dirs.length > 0 && proiecte.every((x) => !x.eroare && x.erori.length === 0 && x.erori_resurse.length === 0) }
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
    if (!proiecte.length) console.error('EROARE: niciun folder P<id> în --surse')
    for (const x of proiecte) {
      if (x.eroare) { console.log(`${x.proiect}: EROARE ${x.eroare}`); continue }
      console.log(`${x.proiect}: ${x.materiale?.linii ?? 0} linii C6, ${fmt(x.materiale?.suma)} lei vs TOTAL ${fmt(x.materiale?.total_tiparit)}, de verificat ${x.materiale?.de_verificat ?? '—'}, ${x.completa ? 'completă' : 'incompletă'}`)
      for (const e of [...x.erori, ...x.erori_resurse]) console.log(`${x.proiect}: EROARE ${e.foaie ? `foaia „${e.foaie}”: ` : ''}${e.mesaj}`)
    }
    process.exitCode = ok ? 0 : 1
  } catch (e) { console.error('EROARE: ' + e.message); process.exitCode = 1 }
}
