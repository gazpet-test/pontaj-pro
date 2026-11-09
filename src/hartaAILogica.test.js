import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NOD_H, NOD_L, cautaNoduri, cautaSecret, cheieLegatura, comparaProbleme, drumLegatura, insigneProbleme, limiteHarta,
  listaProbleme, numaraProbleme, pasiFlux, pozitiiNoduri, punctMargine, valideazaHarta, veciniNod, vizibile,
} from './hartaAILogica.js'

const exemplu = () => JSON.parse(readFileSync(new URL('../scripts/harta_ai/exemplu.json', import.meta.url), 'utf8'))

describe('Harta AI › validare', () => {
  it('exemplul din repo e valid, fără erori și fără avertismente', () => {
    expect(valideazaHarta(exemplu())).toEqual({ erori: [], avertismente: [] })
  })
  it('refuză intrări care nu sunt obiect sau fără noduri', () => {
    expect(valideazaHarta(null).erori).toEqual(['fișierul nu e un obiect JSON'])
    expect(valideazaHarta([]).erori).toEqual(['fișierul nu e un obiect JSON'])
    expect(valideazaHarta({}).erori).toContain('lipsesc nodurile (noduri: [])')
  })
  it('prinde id-uri duplicate, grupuri și capete inexistente, legături lipsă din flux', () => {
    const d = exemplu()
    d.noduri.push({ id: 'om', grup: 'oameni', nume: 'Dublură' })
    d.noduri.push({ id: 'orfan', grup: 'nu-exista', nume: 'Orfan' })
    d.legaturi.push({ de: 'om', la: 'fantoma', ce: 'x' })
    d.fluxuri.push({ id: 'rupt', drum: ['om', 'api'] })
    const { erori } = valideazaHarta(d)
    expect(erori).toContain('nod duplicat: om')
    expect(erori).toContain('nodul orfan: grup inexistent nu-exista')
    expect(erori.some(e => e.includes('nod destinație inexistent fantoma'))).toBe(true)
    expect(erori).toContain('fluxul rupt: lipsește legătura om → api')
  })
  it('o legătură „dublu” acoperă și sensul invers într-un flux', () => {
    const d = exemplu()
    d.fluxuri.push({ id: 'invers', drum: ['api', 'worker'] })
    expect(valideazaHarta(d).erori).toEqual([])
  })
  it('oprește orice șir care arată a valoare de secret, telefon sau CNP, cu calea lui', () => {
    const d = exemplu()
    d.noduri[4].fisa.cont = 'cheia sk-ant-api03-AbCdEfGhIjKlMnOpQr'
    const { erori } = valideazaHarta(d)
    expect(erori.some(e => e.startsWith('noduri[4].fisa.cont: arată a'))).toBe(true)
  })
  it('lasă să treacă adresele de rol permise și semnalează restul ca avertisment', () => {
    const d = exemplu()
    d.noduri[0].fisa.cont = 'office@exemplu.ro'
    expect(valideazaHarta(d).avertismente).toEqual([])
    d.noduri[0].fisa.cont = 'ion.popescu@exemplu.ro'
    expect(valideazaHarta(d).avertismente).toEqual(['noduri[0].fisa.cont: adresă de mail ion.popescu@exemplu.ro (adaug-o în meta.emailuri_permise dacă e o adresă de rol)'])
  })
})

describe('Harta AI › detectorul de secrete', () => {
  const pozitive = [
    ['sk-proj-AbCdEfGhIjKlMnOpQrSt', 'cheie API'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc', 'JWT'],
    ['ghp_0123456789abcdefghijABCDEFGHIJ', 'token GitHub'],
    ['AIzaSyA1234567890abcdefghijklmnopqrstu', 'cheie Google'],
    ['hash 5d1098d3193aacb90938981a7989ed4c95fc59da', 'hex 40'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----', 'cheie privată'],
    ['token Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z', 'șir aleator 32'],
    ['parola=Gazpet2026!', 'parolă atribuită'],
    ['sună la 0722 123 456', 'telefon'],
    ['+40 722-123-456', 'telefon internațional'],
    ['CNP 1850101123456', 'CNP'],
  ]
  it.each(pozitive)('semnalează %s (%s)', s => { expect(cautaSecret(s)).not.toBeNull() })

  const negative = [
    'RFQ_INBOX_SECRET',
    'antet x-inbox-secret = RFQ_INBOX_SECRET',
    'session_01AbCdEf2GhIjKl3MnOpQr4S',
    'trig_01XyZaBc5DeFgHi6JkLmNo7P',
    'C:/Users/exemplu/.secrete/parola_cont_test.txt',
    'parola: din fișierul de pe server',
    'parola=ERP_CLAUDE_PAROLA',
    'cron 0 7 * * 1-5, CRON_TZ=Europe/Bucharest 40 10,16 * * 1-5',
    'migrarea 20261124a v20261106174500',
    'Credential Manager furnizor-ai-exemplu / api',
    'supabase/functions/exemplu-functie/index.ts',
    'jobid 56, la minut; 3 documente/minut',
    'qwen3:14b, LightOnOCR-2-1B, MinerU2.5-Pro-1.2B',
    '',
  ]
  it.each(negative)('nu semnalează „%s”', s => { expect(cautaSecret(s)).toBeNull() })
  it('tolerează valori care nu sunt text', () => { expect(cautaSecret(undefined)).toBeNull(); expect(cautaSecret(42)).toBeNull() })
})

describe('Harta AI › poziții și geometrie', () => {
  it('așază nodurile în grila grupului, în ordinea din fișier', () => {
    const poz = pozitiiNoduri(exemplu())
    // grup „oameni”: x 0, w 420, 2 coloane → celula (420 - 24) / 2 = 198, nodul de 176 centrat: 12 + (198 - 176) / 2 = 23
    expect(poz.om).toEqual({ x: 23, y: 44, w: NOD_L, h: NOD_H })
    expect(poz.da).toEqual({ x: 23 + 198, y: 44, w: NOD_L, h: NOD_H })
    // grup „cloud”: al treilea nod (index 2) trece pe rândul al doilea (44 + 64)
    expect(poz.worker.y).toBe(108)
    expect(poz.worker.x).toBe(460 + 23)
  })
  it('x/y explicite au prioritate față de grilă', () => {
    const d = exemplu()
    d.noduri[0].x = 5; d.noduri[0].y = 7
    expect(pozitiiNoduri(d).om).toEqual({ x: 5, y: 7, w: NOD_L, h: NOD_H })
  })
  it('limitele cuprind toate grupurile, cu margine de 30', () => {
    expect(limiteHarta(exemplu())).toEqual({ x: -30, y: -30, w: 1150 + 60, h: 200 + 60 })
    expect(limiteHarta({})).toEqual({ x: 0, y: 0, w: 1000, h: 600 })
  })
  it('săgeata pornește de pe marginea nodului, nu din centru', () => {
    expect(punctMargine({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })).toEqual({ x: 100, y: 25 })
    expect(punctMargine({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 })).toEqual({ x: 50, y: 50 })
    const { d } = drumLegatura({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })
    expect(d.startsWith('M100.0,25.0 Q')).toBe(true)
    expect(d.endsWith(' 300.0,25.0')).toBe(true)
  })
})

describe('Harta AI › fluxuri, vecini, căutare, filtre', () => {
  it('pașii fluxului urmează drumul și găsesc legătura fiecărei perechi', () => {
    const d = exemplu()
    const pf = pasiFlux(d, 'citire')
    expect(pf.pasi.map(p => `${p.de}>${p.la}`)).toEqual(['om>ecran', 'ecran>da', 'da>coada', 'coada>worker', 'worker>tabel', 'tabel>om'])
    expect(pf.pasi.every(p => p.cheie)).toBe(true)
    expect(pf.ramuri[0].cheie).toBe('w-api')
    expect(pf.chei.has('w-api')).toBe(true)
    expect(pf.ordine.om).toBe(1)
    expect(pf.ordine.tabel).toBe(6)
    expect(pasiFlux(d, 'nu-exista')).toBeNull()
  })
  it('ramurile invalide (null, șir, un singur capăt) dau erori de validare, fără TypeError, și sunt ignorate la desen', () => {
    const d = exemplu()
    d.fluxuri[0].ramuri = [null, 'x', ['worker'], ['worker', ''], ...d.fluxuri[0].ramuri]
    let rez
    expect(() => { rez = valideazaHarta(d) }).not.toThrow()
    const greseli = rez.erori.filter(e => /ramura \d+ nu e \[de, la\]/.test(e))
    expect(greseli).toHaveLength(4)
    let pf
    expect(() => { pf = pasiFlux(d, d.fluxuri[0].id) }).not.toThrow()
    expect(pf.ramuri.map(r => `${r.de}>${r.la}`)).not.toContain('null>undefined')
    expect(pf.ramuri.every(r => typeof r.de === 'string' && typeof r.la === 'string')).toBe(true)
  })
  it('cheia unei legături fără id include indexul', () => {
    expect(cheieLegatura({ de: 'a', la: 'b' }, 3)).toBe('a>b#3')
    expect(cheieLegatura({ id: 'x', de: 'a', la: 'b' }, 3)).toBe('x')
  })
  it('vecinii: ce intră și ce iese, cu legăturile „dublu” în ambele liste', () => {
    const v = veciniNod(exemplu(), 'api')
    expect(v.intrari.map(x => x.cheie)).toEqual(['w-api'])
    expect(v.iesiri.map(x => x.cheie)).toEqual(['w-api'])
    const w = veciniNod(exemplu(), 'worker')
    expect(w.intrari.map(x => x.alt).sort()).toEqual(['api', 'coada'])
    expect(w.iesiri.map(x => x.alt).sort()).toEqual(['api', 'tabel'])
  })
  it('caută fără diacritice în nume, fișă și numele secretelor', () => {
    const d = exemplu()
    expect(cautaNoduri(d, 'cerinte')).toEqual(['tabel'])
    expect(cautaNoduri(d, 'EXEMPLU_API')).toEqual(['worker'])
    expect(cautaNoduri(d, '   ')).toEqual([])
  })
  it('ascunderea unui grup scoate nodurile lui și legăturile care le ating', () => {
    const v = vizibile(exemplu(), new Set(['externi']))
    expect(v.ids.has('api')).toBe(false)
    expect(v.legaturi.some(x => x.cheie === 'w-api')).toBe(false)
    expect(v.legaturi.length).toBe(6)
  })
})

describe('Harta AI › probleme', () => {
  it('aceeași problemă (același id) pe nod și pe săgeată se numără o dată, cu ambele ținte', () => {
    const l = listaProbleme(exemplu())
    expect(l.length).toBe(3)
    const p1 = l.find(r => r.problema.id === 'P1')
    expect(p1.tinte).toEqual([{ tip: 'nod', id: 'worker' }, { tip: 'leg', id: 'w-api' }])
  })
  it('ordinea: gravitatea întâi (mare, medie, mică), apoi tipul, apoi titlul', () => {
    expect(listaProbleme(exemplu()).map(r => r.problema.gravitate)).toEqual(['mare', 'medie', 'mica'])
    const a = { gravitate: 'medie', tip: 'propunere', titlu: 'A' }
    const b = { gravitate: 'medie', tip: 'greseala_coleg', titlu: 'Z' }
    expect([a, b].sort(comparaProbleme)).toEqual([b, a])
  })
  it('numărătoarea pe tip × gravitate', () => {
    const n = numaraProbleme(exemplu())
    expect(n.total).toBe(3)
    expect(n.oprire_tacuta).toEqual({ total: 1, mare: 1, medie: 0, mica: 0 })
    expect(n.dublura_moarta.medie).toBe(1)
    expect(n.propunere.mica).toBe(1)
    expect(n.greseala_coleg.total).toBe(0)
  })
  it('insignele: o pastilă pe tip, în ordinea fixă a tipurilor, cu numărul de probleme', () => {
    const ins = insigneProbleme([{ tip: 'propunere' }, { tip: 'oprire_tacuta' }, { tip: 'propunere' }, { tip: 'necunoscut' }])
    expect(ins.map(i => [i.tip, i.numar])).toEqual([['oprire_tacuta', 1], ['propunere', 2]])
    expect(insigneProbleme(undefined)).toEqual([])
  })
  it('validarea refuză tip / gravitate în afara listelor și titlul gol; avertizează la dovadă lipsă', () => {
    const d = exemplu()
    d.noduri[0].probleme = [{ tip: 'grava', gravitate: 'enorma', titlu: ' ' }]
    d.noduri[1].probleme = [{ tip: 'propunere', gravitate: 'mica', titlu: 'Fără dovadă', propunere: 'x', sursa: 'y' }]
    d.noduri[2].probleme = 'nu e listă'
    const { erori, avertismente } = valideazaHarta(d)
    expect(erori.some(e => e.includes('tip necunoscut „grava”'))).toBe(true)
    expect(erori.some(e => e.includes('gravitate necunoscută „enorma”'))).toBe(true)
    expect(erori.some(e => e.includes('lipsește titlul'))).toBe(true)
    expect(erori.some(e => e.includes('„probleme” trebuie să fie listă'))).toBe(true)
    expect(avertismente.some(a => a.includes('„Fără dovadă”: lipsește „dovada”'))).toBe(true)
  })
  it('„principal” mută ținta aleasă în față (click-ul din listă duce acolo)', () => {
    const d = exemplu()
    d.noduri.find(n => n.id === 'worker').probleme[0].principal = 'worker'
    d.legaturi.find(l => l.id === 'w-api').probleme[0].principal = 'worker'
    expect(listaProbleme(d).find(r => r.problema.id === 'P1').tinte[0]).toEqual({ tip: 'nod', id: 'worker' })
    // săgeata vine prima în fișier dacă principalul e altul? aici legătura e după nod, deci testăm și inversul:
    d.noduri.find(n => n.id === 'coada').probleme = [{ ...d.noduri.find(n => n.id === 'worker').probleme[0], principal: 'coada' }]
    const r = listaProbleme(d).find(x => x.problema.id === 'P1')
    expect(r.tinte[0]).toEqual({ tip: 'nod', id: 'coada' })
    expect(r.tinte.length).toBe(3)
  })
  it('„principal” care nu e nod dă avertisment', () => {
    const d = exemplu()
    d.noduri.find(n => n.id === 'coada').probleme[0].principal = 'nu-exista'
    expect(valideazaHarta(d).avertismente.some(a => a.includes('„principal” nu-exista nu e un nod'))).toBe(true)
  })
  it('căutarea găsește și după titlul unei probleme', () => {
    expect(cautaNoduri(exemplu(), 'coada veche')).toEqual(['coada'])
  })
})
