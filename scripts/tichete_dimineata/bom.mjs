// bom.mjs — normalizează .ps1/.psm1 din acest folder la CRLF + BOM UTF-8 (PowerShell 5.1 citește fișierele fără BOM ca ANSI
// și strică diacriticele / emoji din șabloane). Rulare după editare: node scripts/tichete_dimineata/bom.mjs
// Testul vitest „fișierele PowerShell au BOM UTF-8” pică dacă uiți.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const d = path.dirname(fileURLToPath(import.meta.url))
for (const f of fs.readdirSync(d).filter(f => /\.(ps1|psm1)$/.test(f))) {
  const p = path.join(d, f)
  const t = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r?\n/g, '\r\n')
  fs.writeFileSync(p, '﻿' + t)
  console.log('bom', f)
}
