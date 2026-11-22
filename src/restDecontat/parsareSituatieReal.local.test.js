// Test LOCAL (nu în CI): parseSituatieF3 pe situațiile de plată Transgaz REALE, dintr-un folder dat prin REST_DECONTAT_SURSE_DIR
// (subfoldere pe situație, cu fișierele F3 .docx). Fără variabilă / fără folder suita e SĂRITĂ vizibil. Așteptările vin din calibrarea
// independentă a chat-ului (22.11.2026, control_docx.py: numărul de devize pe fișier și 46/46 devize reconciliate), nu din parser (L25).
// Nicio valoare din fișiere nu ajunge în ieșire: se afișează doar numărători.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseSituatieF3 } from './parsareSituatie.js'

const DIR = process.env.REST_DECONTAT_SURSE_DIR
const activ = Boolean(DIR && fs.existsSync(DIR))
const MOTIV = 'SĂRIT: REST_DECONTAT_SURSE_DIR lipsește sau nu există (test local pe fișiere reale, nu în CI)'
if (!activ) console.warn(`[parsareSituatieReal.local.test] ${MOTIV}`)
const local = activ ? describe : describe.skip

// fișierele calibrate (subfolder / fișier → devize); CALIBRARE: 17 + 1 + 10 + 12 + 6 = 46, toate reconciliate
const CALIBRATE = [
  ['sit.16', 'F3 lucrari mecanice.docx', 17],
  ['sit.16', 'F3 NCS Ad.1_DS2 gama.docx', 1],
  ['sit.8', 'F3 mecanice_civile.docx', 10],
  ['sit.3', 'F3 lucrari mecanice sit.3_Septembrie.docx', 12],
  ['sit.3', 'F3 lucrari civile sit.3_Septembrie.docx', 6],
]
const citeste = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

local(activ ? 'F3 reale (local)' : `F3 reale (local) — ${MOTIV}`, () => {
  it('cele 5 fișiere calibrate: numărul de devize din calibrare, 46/46 reconciliate, TOTAL GENERAL pe fiecare, complet: true', async () => {
    let devize = 0, reconciliate = 0
    for (const [sub, nume, asteptat] of CALIBRATE) {
      const r = await parseSituatieF3(citeste(path.join(DIR, sub, nume)))
      expect(r.devize.length, `${sub}/${nume}: devize`).toBe(asteptat)
      expect(r.devize.filter(d => d.reconciliat).length, `${sub}/${nume}: reconciliate`).toBe(asteptat)
      expect(r.devize.every(d => d.total_general != null), `${sub}/${nume}: TOTAL GENERAL`).toBe(true)
      expect(r.probleme, `${sub}/${nume}: probleme`).toEqual([])
      expect(r.complet, `${sub}/${nume}: complet`).toBe(true)
      expect(r.linii.length, `${sub}/${nume}: linii`).toBeGreaterThan(0)
      expect(r.linii.every(l => l.valoare != null && Number.isFinite(l.cantitate) && l.um && l.cod && l.nr), `${sub}/${nume}: linii întregi`).toBe(true)
      devize += r.devize.length; reconciliate += r.devize.filter(d => d.reconciliat).length
      console.log(`[F3 real] ${sub}/${nume}: devize ${r.devize.length}, reconciliate ${r.devize.filter(d => d.reconciliat).length}, linii ${r.linii.length}, complet ${r.complet}, ignorate ${r.ignorate.length}, avertismente ${r.avertismente.length}`)
    }
    expect([devize, reconciliate]).toEqual([46, 46])
  })
  it('TOATE fișierele .docx din folder se citesc complet (devize ≥ 1, fiecare reconciliat, cu TOTAL GENERAL)', async () => {
    const fisiere = []
    for (const sub of fs.readdirSync(DIR)) {
      const cale = path.join(DIR, sub)
      if (!fs.statSync(cale).isDirectory()) continue
      for (const f of fs.readdirSync(cale)) if (/\.docx$/i.test(f)) fisiere.push([sub, f])
    }
    expect(fisiere.length).toBeGreaterThanOrEqual(CALIBRATE.length)
    for (const [sub, f] of fisiere) {
      const r = await parseSituatieF3(citeste(path.join(DIR, sub, f)))
      expect(r.devize.length, `${sub}/${f}`).toBeGreaterThanOrEqual(1)
      expect(r.probleme, `${sub}/${f}: probleme`).toEqual([])
      expect(r.complet, `${sub}/${f}`).toBe(true)
      expect(r.devize.every(d => d.reconciliat && d.total_general != null), `${sub}/${f}: devize`).toBe(true)
      console.log(`[F3 real] ${sub}/${f}: devize ${r.devize.length}, linii ${r.linii.length}, complet ${r.complet}, ignorate ${r.ignorate.length}, avertismente ${r.avertismente.length}`)
    }
  })
})
