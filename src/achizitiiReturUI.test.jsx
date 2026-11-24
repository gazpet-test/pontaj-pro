// TKT-2026-0347 — retur la furnizor, PR2: randarea ferestrelor (fără jsdom: renderToStaticMarkup) + gărzi pe sursă pentru căile vechi.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import ReturModal, { ReconciliereModal } from './achizitii/ReturModal.jsx'
import ReturIstoric from './achizitii/ReturIstoric.jsx'

const G = { bg:'#000', surface:'#111', border:'#222', border2:'#333', text:'#fff', muted:'#999', dim:'#777', blue:'#00f', green:'#0f0', red:'#f00',
  yellow:'#ff0', purple:'#f0f', orange:'#f80' }
const S = { card:{}, input:{}, btnP:{}, btnS:{}, btnIcon:{} }
const comanda = { id: 7, numar_comanda: 'CMD_T_001', status: 'in_stoc', proiect_id: 3, livrare_tip: 'santier' }
const linie = { id: 11, denumire: 'MAT_A', um: 'buc', cantitate: 100, cantitate_primita: 100, cantitate_intrata_stoc: 40, intrare_reconciliata: true }
const actiuni = (plan = null) => ({ planNeconfirmat: () => plan, executaCF: async () => ({ stare: 'ok' }) })
const scoateTaguri = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('ReturModal', () => {
  it('fereastra nouă: maximul returnabil, locațiile comenzii, butonul de înregistrare', () => {
    const t = scoateTaguri(renderToStaticMarkup(<ReturModal comanda={comanda} linie={linie} G={G} S={S} bucket="b" caleFisierPv={() => '7/x.pdf'}
      actions={actiuni()} onClose={() => {}} onDone={() => {}} />))
    expect(t).toContain('Maxim returnabil: 100 buc')
    expect(t).toContain('Magazia centrală (sediu)')
    expect(t).toContain('Stocul proiectului')
    expect(t).toContain('Înregistrează returul')
    expect(t).not.toContain('Retrimite')
  })
  it('cerere neconfirmată: câmpurile dispar, butonul retrimite aceeași cerere', () => {
    const plan = { v: 1, creat_la: '2026-11-24T20:00:00Z', pasi: [{ rpc: 'fn_cf_retur_inregistreaza', args: { p_cantitate: 20, p_din_stoc: 20, p_motiv: 'neconform' } }] }
    const t = scoateTaguri(renderToStaticMarkup(<ReturModal comanda={comanda} linie={linie} G={G} S={S} bucket="b" caleFisierPv={() => '7/x.pdf'}
      actions={actiuni(plan)} onClose={() => {}} onDone={() => {}} />))
    expect(t).toContain('Cerere trimisă fără rezultat confirmat')
    expect(t).toContain('Retur 20 buc, din stoc 20, motiv „neconform”')
    expect(t).toContain('Retrimite aceeași cerere')
    expect(t).not.toContain('Așteptăm înlocuire')
  })
  it('fără proiect: doar sediul', () => {
    const t = scoateTaguri(renderToStaticMarkup(<ReturModal comanda={{ ...comanda, proiect_id: null }} linie={linie} G={G} S={S} bucket="b"
      caleFisierPv={() => ''} actions={actiuni()} onClose={() => {}} onDone={() => {}} />))
    expect(t).not.toContain('Stocul proiectului')
  })
  it('reconcilierea: primit efectiv și butonul', () => {
    const t = scoateTaguri(renderToStaticMarkup(<ReconciliereModal comanda={comanda} linie={{ ...linie, intrare_reconciliata: false }} G={G} S={S}
      actions={actiuni()} onClose={() => {}} onDone={() => {}} />))
    expect(t).toContain('100 buc primite')
    expect(t).toContain('Reconciliază')
  })
})

describe('ReturIstoric', () => {
  const rows = [
    { id: 1, tip: 'retur', linie_id: 11, denumire: 'MAT_A', um: 'buc', cantitate: 20, din_stoc: 20, locatie_tip: 'proiect', motiv: 'neconform la livrare',
      asteapta_inlocuire: true, cantitate_inlocuita: 5, cantitate_renuntata: 0, inchis_fel: null, creat_de: 'u1', creat_la: '2026-11-20T10:00:00Z' },
    { id: 2, tip: 'retur', linie_id: 11, denumire: 'MAT_A', um: 'buc', cantitate: 10, din_stoc: 0, locatie_tip: 'sediu', motiv: 'greșit livrat',
      asteapta_inlocuire: false, cantitate_inlocuita: 0, cantitate_renuntata: 0, inchis_fel: 'anulat', inchis_la: '2026-11-21T10:00:00Z', creat_de: 'u1', creat_la: '2026-11-20T11:00:00Z' },
    { id: 3, tip: 'anulare', retur_id: 2, linie_id: 11, denumire: 'MAT_A', cantitate: 10, din_stoc: 0, motiv: 'introdus din greșeală', creat_de: 'u2', creat_la: '2026-11-21T10:00:00Z' },
  ]
  const randeaza = (poateScrie) => scoateTaguri(renderToStaticMarkup(<ReturIstoric retururi={rows} poateScrie={poateScrie} profilesMap={{ u1: 'Utilizator A', u2: 'Utilizator B' }}
    fmtDataOra={() => 'DATA'} openStorageFile={() => {}} G={G} S={S} actions={actiuni()} onDone={() => {}} />))
  it('arată retururile, de înlocuit, anularea cu autorul; acțiunile doar pe returul deschis', () => {
    const t = randeaza(true)
    expect(t).toContain('Retururi la furnizor (2)')
    expect(t).toContain('de înlocuit 15 buc')
    expect(t).toContain('înlocuit 5 buc')
    expect(t).toContain('anulat de Utilizator B')
    expect(t).toContain('Închide fără înlocuire')
    // returul 1 are deja înlocuire → nu se mai anulează; returul 2 e anulat → fără acțiuni
    expect(t).not.toContain('Anulează returul')
  })
  it('fără drept de scriere: fără butoane', () => {
    expect(randeaza(false)).not.toContain('Închide fără înlocuire')
  })
  it('fără retururi: nimic', () => {
    expect(renderToStaticMarkup(<ReturIstoric retururi={[]} poateScrie G={G} S={S} actions={actiuni()} fmtDataOra={() => ''} />)).toBe('')
  })
})

describe('căile vechi nu mai scriu direct cantitățile / mișcările de achiziție (gardă pe sursă)', () => {
  const achizitii = readFileSync(new URL('./Achizitii.jsx', import.meta.url), 'utf8')
  const magazie = readFileSync(new URL('./Magazie.jsx', import.meta.url), 'utf8')
  it('Achizitii.jsx: fără update pe cantitate_primita / cantitate_intrata_stoc și fără insert în stocuri_miscari', () => {
    expect(achizitii).not.toMatch(/cantitate_primita\s*:/)
    expect(achizitii).not.toMatch(/cantitate_intrata_stoc\s*:/)
    expect(achizitii).not.toMatch(/from\('stocuri_miscari'\)/)
    expect(achizitii).toContain("executaCF(`receptie:${c.id}`")
  })
  it('Magazie.jsx: ștergerea poziției prin fn_stoc_sterge_pozitie, nu prin DELETE pe stocuri_miscari / stocuri', () => {
    expect(magazie).toContain("supabase.rpc('fn_stoc_sterge_pozitie', { p_stoc_id: s.id })")
    expect(magazie).not.toMatch(/from\('stocuri_miscari'\)\.delete\(/)
    expect(magazie).not.toMatch(/from\('stocuri'\)\.delete\(/)
    expect(magazie).toContain('...MISCARE_META_RETUR')
  })
})
