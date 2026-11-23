// TKT-2026-0372 — fișierul KML / KMZ cu traseul conductei, ca document al lucrării.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TIP_TRASEU, MIME_KML, MIME_KMZ, ACCEPT_DOC_CONTRACT, mimeTraseu, esteFisierTraseu, tipPentruFisier, verificaInceputTraseu,
  clasificaEroareUpload, refuzDeterminist } from './executieDocTraseu.js'

const enc = s => new TextEncoder().encode(s)

describe('extensii și tipuri MIME', () => {
  it('KML / KMZ, indiferent de majuscule; restul = null', () => {
    expect(mimeTraseu('Traseu Lot1.KML')).toBe(MIME_KML)
    expect(mimeTraseu('traseu.kmz')).toBe(MIME_KMZ)
    expect(mimeTraseu('traseu.kml.pdf')).toBe(null)
    expect(mimeTraseu('kml')).toBe(null)
    expect(mimeTraseu('')).toBe(null)
    expect(esteFisierTraseu('a.kmz')).toBe(true)
  })
  it('lista accept păstrează extensiile de azi și le adaugă pe cele noi', () => {
    for (const e of ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xls', '.xlsx', '.kml', '.kmz', MIME_KML, MIME_KMZ])
      expect(ACCEPT_DOC_CONTRACT.split(',')).toContain(e)
  })
})

describe('tipul de document', () => {
  it('KML / KMZ merg la „Traseu”, oricare ar fi tipul ales', () => {
    expect(tipPentruFisier('contract', 'traseu.kml')).toEqual({ tip: TIP_TRASEU, schimbat: true })
    expect(tipPentruFisier(TIP_TRASEU, 'traseu.kmz')).toEqual({ tip: TIP_TRASEU, schimbat: false })
  })
  it('la „Traseu” nu intră alte fișiere; celelalte tipuri rămân ca azi', () => {
    expect(tipPentruFisier(TIP_TRASEU, 'plan.pdf').eroare).toMatch(/doar fișiere \.kml sau \.kmz/)
    expect(tipPentruFisier('contract', 'contract.pdf')).toEqual({ tip: 'contract' })
  })
  it('tipul e în lista din ecran', () => {
    const src = readFileSync(new URL('./Executie.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/\{ value: TIP_TRASEU,\s+label: '🗺️ Traseu \(KML \/ KMZ\)' \}/)
    expect(src).toMatch(/accept=\{ACCEPT_DOC_CONTRACT\}/)
  })
})

describe('conținutul se potrivește cu extensia', () => {
  it('KML: XML cu <kml>, cu sau fără BOM / declarație', () => {
    expect(verificaInceputTraseu('a.kml', enc('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">'))).toBe(null)
    expect(verificaInceputTraseu('a.kml', new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('<kml>')]))).toBe(null)
    expect(verificaInceputTraseu('a.kml', enc('<kml:kml xmlns:kml="x">'))).toBe(null)
    expect(verificaInceputTraseu('a.kml', enc('%PDF-1.7'))).toMatch(/nu pare un fișier KML/)
    expect(verificaInceputTraseu('a.kml', enc('<kmlx>'))).toMatch(/nu pare/)
  })
  it('KMZ: arhivă zip', () => {
    expect(verificaInceputTraseu('a.kmz', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0]))).toBe(null)
    expect(verificaInceputTraseu('a.kmz', enc('<kml>'))).toMatch(/nu pare o arhivă KMZ/)
    expect(verificaInceputTraseu('a.kmz', new Uint8Array(0))).toMatch(/nu pare/)
  })
  it('alte fișiere: nu se verifică', () => {
    expect(verificaInceputTraseu('a.pdf', enc('orice'))).toBe(null)
  })
})

describe('erori', () => {
  it('refuzul de tip / mărime al Storage-ului', () => {
    expect(clasificaEroareUpload({ statusCode: '415', message: 'mime type application/vnd.google-earth.kml+xml is not supported' })).toBe('tip')
    expect(clasificaEroareUpload({ message: 'invalid_mime_type' })).toBe('tip')
    expect(clasificaEroareUpload({ statusCode: '413', message: 'Payload too large' })).toBe('marime')
    expect(clasificaEroareUpload({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe(null)
    expect(clasificaEroareUpload(null)).toBe(null)
  })
  it('doar refuzurile deterministe ale rândului scot fișierul urcat (L05)', () => {
    expect(refuzDeterminist({ code: '23514' })).toBe(true)
    expect(refuzDeterminist({ code: '22P02' })).toBe(true)
    expect(refuzDeterminist({ code: '42501' })).toBe(false)
    expect(refuzDeterminist({ code: '' , message: 'Failed to fetch' })).toBe(false)
    expect(refuzDeterminist({ code: '57014' })).toBe(false)
    expect(refuzDeterminist(null)).toBe(false)
  })
})
