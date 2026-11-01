// Redări teren — verificarea șabloanelor DOCX cu placeholder-e (public/redari/sabloane/*.docx; harta câmpurilor în
// docs/redari/SABLOANE.md, contract docs/redari/CONTRACT_SCHEMA.md §8 + §10).
// Rulare: node scripts/redari_sabloane_verifica.mjs            (ieșire Markdown; cod de ieșire 1 dacă e vreo problemă)
//         node scripts/redari_sabloane_verifica.mjs --toate    (include și convocator_provizoriu.docx)
//
// Pentru fiecare șablon:
//  1. listează placeholder-ele {{camp}} găsite (document + antete + subsoluri), cu numărul de apariții;
//  2. verifică că fiecare placeholder stă ÎNTREG într-un singur <w:t> (docx.js îl înlocuiește local, fără să mute text
//     între run-uri — vezi limita 1 din src/redari/docx.js); „rupte” trebuie să fie 0;
//  3. verifică că {{qr}} (dacă există) e singur în paragraful lui (altfel docx.js nu îl transformă în imagine);
//  4. caută text variabil rămas în afara placeholder-elor („____”, „zz.ll.aaaa”, „[...]”, „Nume Prenume”, „(exemplu)”) și îl
//     împarte în „intenționat” (linii de semnătură olografă, bife completate de mână de destinatar — lista INTENTIONATE)
//     și „de corectat”;
//  5. semnalează placeholder-ele de rând-șablon {{rand.camp}} (tabel cu rânduri repetate): docx.js NU le cunoaște încă
//     (RX_PLACEHOLDER nu acceptă punctul) — le tratează viitoarea funcție repetaRand (SABLOANE.md).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const RADACINA = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(RADACINA, 'public/redari/sabloane')
const TOATE = process.argv.includes('--toate')

// aceleași expresii ca în src/redari/docx.js (RX_PLACEHOLDER de acolo nu acceptă „.”; aici îl acceptăm ca să vedem rand.*)
const RX_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g
const RX_PARAGRAF = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_WT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g
const unescapeXml = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// text variabil rămas (în afara placeholder-elor) — ce căutăm
const RX_RESTURI = [
  [/_{3,}/g, 'linie „____”'],
  [/\bzz\.ll\.aaaa\b/gi, 'dată „zz.ll.aaaa”'],
  [/\[\.{3}\]/g, '„[...]”'],
  [/Nume Prenume/g, '„Nume Prenume”'],
  [/\(exemplu\)/g, '„(exemplu)”'],
]
// paragrafe în care liniile „____” sunt intenționate (se completează de mână) — pe textul paragrafului fără placeholder-e
const INTENTIONATE = [
  [/^_+$/, 'linie de semnătură olografă'],
  [/^\s*☐ (Particip la sesiune|Nu particip\. Am următoarele obiecții)/, 'opțiune bifată de mână de destinatar (convocator)'],
  [/^Dezafișat la data de/, 'dezafișarea se consemnează de mână, la final (PV afișare)'],
  [/^Calitatea \(proprietar \/ coproprietar, cotă ___/, 'antet de coloană (PV A), nu câmp'],
]

const verificaSablon = async (cale) => {
  const zip = await JSZip.loadAsync(readFileSync(cale))
  const parti = Object.keys(zip.files).filter(p => p === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(p)).sort()
  const aparitii = new Map()  // nume → număr
  const rupte = []            // {nume, text}
  const resturi = []          // {tip, fragment, text, intentionat}
  let qrSingur = null         // null = nu există {{qr}}; true/false
  let paragrafe = 0
  // Copilot FE r1 P2-04: relații externe (TargetMode="External" în *.rels) — un șablon nu are voie să tragă nimic de pe servere
  // externe (imagini/legături la deschidere) când documentul poartă PII + token; hyperlink-urile mailto:/https: din text se listează
  const externe = []
  for (const relPath of Object.keys(zip.files).filter(p => /\.rels$/.test(p))) {
    const xml = await zip.file(relPath).async('string')
    for (const m of xml.matchAll(/<Relationship(?=\s)[^>]*TargetMode="External"[^>]*>/g)) {
      const target = /Target="([^"]*)"/.exec(m[0])?.[1] ?? ''
      const tip = /Type="[^"]*\/([a-zA-Z]+)"/.exec(m[0])?.[1] ?? ''
      externe.push({ rel: relPath, tip, target })
    }
  }
  for (const partPath of parti) {
    const xml = await zip.file(partPath).async('string')
    for (const m of xml.matchAll(RX_PARAGRAF)) {
      const pXml = m[0]
      const wts = [...pXml.matchAll(RX_WT)].map(w => unescapeXml(w[1] ?? ''))
      const text = wts.join('')
      if (!text) continue
      paragrafe += 1
      const inText = [...text.matchAll(RX_PLACEHOLDER)].map(x => x[1])
      if (!inText.length && text.includes('{{')) rupte.push({ nume: '{{…}} malformat', text })
      const inWt = new Map()
      for (const w of wts) for (const x of w.matchAll(RX_PLACEHOLDER)) inWt.set(x[1], (inWt.get(x[1]) ?? 0) + 1)
      const cnt = new Map()
      for (const n of inText) cnt.set(n, (cnt.get(n) ?? 0) + 1)
      for (const [n, c] of cnt) {
        aparitii.set(n, (aparitii.get(n) ?? 0) + c)
        if ((inWt.get(n) ?? 0) < c) rupte.push({ nume: n, text })
        if (n === 'qr') qrSingur = /^\s*\{\{\s*qr\s*\}\}\s*$/.test(text)
      }
      const fara = text.replace(RX_PLACEHOLDER, '')
      for (const [rx, tip] of RX_RESTURI) {
        for (const r of fara.matchAll(rx)) {
          const motiv = INTENTIONATE.find(([irx]) => irx.test(fara))?.[1] ?? null
          resturi.push({ tip, fragment: r[0].slice(0, 30), text, intentionat: motiv })
        }
      }
    }
  }
  return { parti, paragrafe, aparitii, rupte, resturi, qrSingur, externe }
}

const scurt = (t, n = 90) => (t.length > n ? `${t.slice(0, n)}…` : t)
const fisiere = readdirSync(DIR).filter(f => f.endsWith('.docx') && (TOATE || f !== 'convocator_provizoriu.docx')).sort()
let probleme = 0
const global = new Map() // placeholder → set de șabloane
console.log(`# Verificare șabloane Redări — ${fisiere.length} fișiere din public/redari/sabloane (${new Date().toISOString().slice(0, 10)})\n`)
for (const f of fisiere) {
  const r = await verificaSablon(resolve(DIR, f))
  const nume = [...r.aparitii.keys()].sort()
  const rand = nume.filter(n => n.startsWith('rand.'))
  for (const n of nume) global.set(n, (global.get(n) ?? new Set()).add(basename(f, '.docx')))
  const eroriResturi = r.resturi.filter(x => !x.intentionat)
  // relații externe: hyperlink-urile (deschise doar la clic) se acceptă; orice altceva (imagine/OLE/etc. externă) e problemă
  const externeRele = r.externe.filter(x => x.tip !== 'hyperlink')
  const ok = r.rupte.length === 0 && eroriResturi.length === 0 && r.qrSingur !== false && externeRele.length === 0
  if (!ok) probleme += 1
  console.log(`## ${f} — ${ok ? 'OK' : 'PROBLEME'}`)
  console.log(`- părți citite: ${r.parti.join(', ')}; paragrafe cu text: ${r.paragrafe}`)
  console.log(`- placeholder-e distincte: ${nume.length} (apariții: ${[...r.aparitii.values()].reduce((a, b) => a + b, 0)}); rupte între run-uri: ${r.rupte.length}`)
  console.log(`- ${nume.map(n => `\`{{${n}}}\`${r.aparitii.get(n) > 1 ? `×${r.aparitii.get(n)}` : ''}`).join(' ')}`)
  if (r.qrSingur !== null) console.log(`- {{qr}} singur în paragraf: ${r.qrSingur ? 'da' : 'NU — nu devine imagine'}`)
  console.log(`- relații externe (.rels TargetMode=External): ${r.externe.length ? r.externe.map(x => `${x.tip}→${scurt(x.target, 60)}`).join('; ') : 'niciuna'}`)
  for (const x of externeRele) console.log(`- EXTERN NEPERMIS: ${x.tip} „${x.target}” în ${x.rel}`)
  if (rand.length) console.log(`- rând-șablon (de repetat cu viitoarea \`repetaRand\`, docx.js nu le cunoaște azi): ${rand.map(n => `\`{{${n}}}\``).join(' ')}`)
  for (const x of r.rupte) console.log(`- RUPT: {{${x.nume}}} în „${scurt(x.text)}”`)
  const intent = r.resturi.filter(x => x.intentionat)
  if (intent.length) {
    const grup = new Map()
    for (const x of intent) grup.set(x.intentionat, (grup.get(x.intentionat) ?? 0) + 1)
    console.log(`- resturi intenționate: ${[...grup].map(([m, c]) => `${c}× ${m}`).join('; ')}`)
  }
  for (const x of eroriResturi) console.log(`- DE CORECTAT: ${x.tip} „${x.fragment}” în „${scurt(x.text)}”`)
  console.log('')
}
console.log(`## Toate placeholder-ele (${global.size})\n`)
console.log('| placeholder | șabloane |\n|---|---|')
for (const [n, s] of [...global].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`| \`{{${n}}}\` | ${[...s].join(', ')} |`)
console.log(`\nRezultat: ${probleme ? `${probleme} șablon(oane) cu probleme` : 'toate șabloanele OK'}`)
process.exit(probleme ? 1 : 0)
