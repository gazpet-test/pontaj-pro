// Fereastra „📱 SMS proprietari” cu șablon fix (20261130c): textul needitabil, contorul, blocarea la lipsă / >160 / nepotrivire cu BD-ul.
// Randare statică (fără rețea): ziua fixă prin aziInitial, previzualizarea prin previewInitial. Date fictive.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { RedariSmsFereastra, motivBlocareCreare } from './RedariSmsButon.jsx'

const proiect = { id: 'p1', cod: 'TEST-PROIECT', contact_telefon: '0700 000 111' }
const uatOk = { id: 'u1', uat3: 'TST', nume: 'Testeni', sesiune_zi1: '2026-11-05', program_zi1: '08:00 - 12:00', sesiune_zi2: '2026-11-12', program_zi2: '09:30 – 16:00' }
const uatFaraProgram = { id: 'u2', uat3: 'TSF', nume: 'Fara Program', sesiune_zi1: '2026-11-12' }
const uatLung = { id: 'u3', uat3: 'TSE', nume: 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte', sesiune_zi1: '2026-11-12', program_zi1: '09:00' }
const TEXT = 'Gazpet pt Transgaz: sesiune redare teren la Primaria Testeni, 12.11 ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700 000 111'
const uats = [uatOk, uatFaraProgram, uatLung]
const randeaza = (props) => renderToStaticMarkup(<RedariSmsFereastra proiect={proiect} uats={uats} aziInitial="2026-11-10" onClose={() => {}} {...props} />)
const butonDezactivat = (html, eticheta) => new RegExp(`<button[^>]*disabled=""[^>]*>${eticheta}`).test(html)

describe('RedariSmsFereastra — șablonul fix', () => {
  it('fără UAT: niciun text, contor 0/160, butoanele blocate, fără „Tot proiectul”', () => {
    const html = randeaza({ uatInitial: '' })
    expect(html).toContain('0/160')
    expect(html).toContain('Alege UAT-ul')
    expect(html).not.toContain('Tot proiectul')
    expect(butonDezactivat(html, '🔍 Previzualizează')).toBe(true)
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(true)
  })
  it('UAT complet: textul generat (ziua 1 trecută → ziua 2), needitabil (fără textarea / input), contorul, previzualizarea activă', () => {
    const html = randeaza({ uatInitial: 'u1' })
    expect(html).toContain(TEXT)
    expect(html).toContain(`${TEXT.length}/160`)
    expect(html).toContain('aria-readonly="true"')
    expect(html).not.toMatch(/<textarea|<input/)
    expect(butonDezactivat(html, '🔍 Previzualizează')).toBe(false)
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(true)
  })
  it('r2: sesiunea de azi deja începută (09:00 la 10:00) → textul ia ziua următoare; înainte de 09:00 → azi', () => {
    const u = { ...uatOk, sesiune_zi1: '2026-11-10', program_zi1: '09:00 - 12:00' }
    const dupa = renderToStaticMarkup(<RedariSmsFereastra proiect={proiect} uats={[u]} uatInitial="u1" aziInitial="2026-11-10" oraInitial="10:00" onClose={() => {}} />)
    expect(dupa).toContain(TEXT)
    const inainte = renderToStaticMarkup(<RedariSmsFereastra proiect={proiect} uats={[u]} uatInitial="u1" aziInitial="2026-11-10" oraInitial="08:59" onClose={() => {}} />)
    expect(inainte).toContain('Primaria Testeni, 10.11 ora 09:00.')
  })
  it('câmp lipsă: spune exact ce lipsește, cu trimitere la Setări UAT; nimic nu se poate crea', () => {
    const html = randeaza({ uatInitial: 'u2' })
    expect(html).toContain('Nu se poate crea lotul. Lipsește:')
    expect(html).toContain('ora de început (HH:MM) în programul zilei de sesiune (Setări UAT): ziua 1 (12.11)')
    expect(html).toContain('Redări → UAT (Setări UAT)')
    expect(html).toContain('0/160')
    expect(butonDezactivat(html, '🔍 Previzualizează')).toBe(true)
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(true)
  })
  it('telefonul de contact al proiectului lipsă: trimitere la Setări proiect', () => {
    const html = renderToStaticMarkup(<RedariSmsFereastra proiect={{ ...proiect, contact_telefon: '' }} uats={uats} uatInitial="u1" aziInitial="2026-11-10" onClose={() => {}} />)
    expect(html).toContain('telefonul de contact Gazpet al proiectului (Setări proiect → Contact pe convocări)')
    expect(butonDezactivat(html, '🔍 Previzualizează')).toBe(true)
  })
  it('peste 160: arată lungimea și blochează', () => {
    const html = randeaza({ uatInitial: 'u3' })
    const lung = `Gazpet pt Transgaz: sesiune redare teren la Primaria ${uatLung.nume}, 12.11 ora 09:00. Raspuns si online, cu QR-ul din scrisoare. Tel 0700 000 111`
    expect(lung.length).toBeGreaterThan(160)
    expect(html).toContain(`textul are ${lung.length} caractere GSM-7, maximum 160`)
    expect(butonDezactivat(html, '🔍 Previzualizează')).toBe(true)
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(true)
  })
  it('previzualizarea: câți primesc, câți sunt excluși și de ce, costul; crearea activă', () => {
    const preview = { text_final: TEXT, nr_destinatari: 2, candidati: 9, excluse_a_raspuns: 2, excluse_pv_semnat: 2, excluse_fara_mobil: 1, excluse_optout: 1,
      excluse_duplicat: 1, cost_estimat_eur: 0.098, depaseste_plafon_zi: false, lot_activ_uat: null, campanie_existenta: null, set_hash: 'h' }
    const html = randeaza({ uatInitial: 'u1', previewInitial: preview })
    for (const t of ['<b>2</b> proprietari primesc SMS-ul', 'Din 9 proprietari convocați în UAT', '2 au răspuns', '2 cu PV semnat', '1 fără mobil RO', '1 opt-out', '1 telefon dublat', 'Textul trimis (din BD):'])
      expect(html).toContain(t)
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(false)
  })
  it('blocarea creării: text BD diferit, lot activ pe UAT, zero destinatari', () => {
    const s = { ok: true, text: TEXT }
    const p = { text_final: TEXT, nr_destinatari: 2, set_hash: 'h' }
    expect(motivBlocareCreare(s, null)).toBe('Previzualizează întâi')
    expect(motivBlocareCreare(s, { ...p, text_final: TEXT + 'x' })).toMatch(/diferă de cel afișat/)
    expect(motivBlocareCreare(s, { ...p, lot_activ_uat: 'l1' })).toMatch(/lot activ/)
    expect(motivBlocareCreare(s, { ...p, campanie_existenta: 'l0' })).toMatch(/această zi de sesiune există deja/)
    expect(motivBlocareCreare(s, { ...p, set_hash: null })).toMatch(/nu a fixat lista/)
    expect(motivBlocareCreare(s, { ...p, sablon_aprobat: false })).toMatch(/Șablon provizoriu, nu poate fi aprobat/)
    expect(motivBlocareCreare(s, { ...p, sablon_aprobat: true })).toBeNull()
    expect(motivBlocareCreare(s, { ...p, nr_destinatari: 0 })).toMatch(/Niciun proprietar/)
    expect(motivBlocareCreare(s, p)).toBeNull()
    const html = randeaza({ uatInitial: 'u1', previewInitial: { text_final: TEXT, nr_destinatari: 3, candidati: 3, lot_activ_uat: 'l1' } })
    expect(html).toContain('UAT-ul are deja un lot activ')
    expect(butonDezactivat(html, '＋ Creează lot')).toBe(true)
  })
})
