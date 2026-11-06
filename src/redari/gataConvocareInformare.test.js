// Test weekend 06.11.2026: „gata de convocare” (Setări / UAT-uri / Notificări / Registru) trebuie să țină cont de autorizarea TGZ (art. 28),
// exact ca generarea convocatorului (verificaDateConvocator). Date fictive.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { motivBlocareConvocator } from './ui/comune.jsx'
import { MOTIV_INFORMARE_NEPUBLICATA, cuInformarePublicata, avertismentInformare, AVERTISMENT_INFORMARE_NEVERIFICATA } from './informareGdpr.js'
import { MESAJ_INFORMARE_NEGATA } from './docx.js'
import { ghidModele } from './notificari.js'
import { motiveGataConvocare } from './setari.js'

const uat = { id: 'u1', nume: 'Alfa', sesiune_zi1: '2099-12-10', program_zi1: '09:00-15:00' }
const pr = { cod: 'TEST-X', contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '1', imputernicire_data: '2026-10-01', text_gdpr: 'x',
  reprezentant_tgz_nume: 'R', reprezentant_tgz_telefon: '0711', contact_nume: 'N', contact_telefon: '0700', contact_email: 'a@b.test' }

describe('motivBlocareConvocator — informarea GDPR (autorizarea TGZ)', () => {
  it('nepublicată (false de la server) → blocat, cu motivul autorizării', () => {
    expect(motivBlocareConvocator({ ...pr, informare_publicata: false }, uat, null)).toBe(MOTIV_INFORMARE_NEPUBLICATA)
  })
  it('publicată (true) → null', () => {
    expect(motivBlocareConvocator({ ...pr, informare_publicata: true }, uat, null)).toBeNull()
  })
  it('necunoscut (null = verificare eșuată, sau lipsă) → nu blochează aici (generatorul recitește proaspăt)', () => {
    expect(motivBlocareConvocator({ ...pr, informare_publicata: null }, uat, null)).toBeNull()
    expect(motivBlocareConvocator(pr, uat, null)).toBeNull()
  })
  it('se adună cu celelalte lipsuri, separat prin „; ” (Notificări le desparte)', () => {
    const m = motivBlocareConvocator({ ...pr, informare_publicata: false, text_gdpr: '' }, uat, null)
    expect(m.split('; ')).toEqual([MOTIV_INFORMARE_NEPUBLICATA, 'proiect fără text GDPR'])
  })
  it('motivul nu conține „; ” (altfel s-ar rupe în Notificări / UAT-uri)', () => {
    expect(MOTIV_INFORMARE_NEPUBLICATA.includes('; ')).toBe(false)
  })
  it('aceeași cauză ca refuzul generatorului (autorizarea Transgaz art. 28)', () => {
    expect(MESAJ_INFORMARE_NEGATA).toMatch(/autorizarea Transgaz \(art\. 28\)/)
    expect(MOTIV_INFORMARE_NEPUBLICATA).toMatch(/autorizarea Transgaz \(art\. 28\)/)
  })
})

describe('ecranele care arătau „gata”', () => {
  it('UAT-uri: „gata de convocare” are motivul informării', () => {
    expect(motiveGataConvocare([], motivBlocareConvocator({ ...pr, informare_publicata: false }, uat, null))).toEqual([MOTIV_INFORMARE_NEPUBLICATA])
  })
  it('Notificări → Ghidul modelelor: convocatorul e „blocat”, nu „gata”', () => {
    const m = Object.fromEntries(ghidModele({ proiect: { ...pr, informare_publicata: false }, uats: [uat] }).map(x => [x.cod, x]))
    expect(m.convocator.stare).toBe('blocat')
    expect(m.convocator.lipsuri.join(' ')).toMatch(/informarea GDPR nepublicată/)
    const ok = Object.fromEntries(ghidModele({ proiect: { ...pr, informare_publicata: true }, uats: [uat] }).map(x => [x.cod, x]))
    expect(ok.convocator.stare).toBe('gata')
  })
})

describe('cuInformarePublicata — ce primește Redari.jsx de la server', () => {
  const client = v => ({ rpc: async () => v })
  it('true / false de la RPC → pe proiect; eroare → null (nu blochează)', async () => {
    expect((await cuInformarePublicata(client({ data: true, error: null }), pr)).informare_publicata).toBe(true)
    expect((await cuInformarePublicata(client({ data: false, error: null }), pr)).informare_publicata).toBe(false)
    expect((await cuInformarePublicata(client({ data: null, error: { message: 'x' } }), pr)).informare_publicata).toBeNull()
    expect(motivBlocareConvocator(await cuInformarePublicata(client({ data: null, error: { message: 'x' } }), pr), uat, null)).toBeNull()
  })
})

// Jakarinos r1 P2 (L18): verificarea eșuată nu blochează, dar „✓ gata” nu apare fără avertisment
describe('avertismentInformare', () => {
  it('null (RPC eșuat) → avertisment; true / false / lipsă → nimic (false are deja motivul de blocare)', () => {
    expect(avertismentInformare({ ...pr, informare_publicata: null })).toBe(AVERTISMENT_INFORMARE_NEVERIFICATA)
    expect(avertismentInformare({ ...pr, informare_publicata: true })).toBeNull()
    expect(avertismentInformare({ ...pr, informare_publicata: false })).toBeNull()
    expect(avertismentInformare(pr)).toBeNull()
    expect(avertismentInformare(null)).toBeNull()
  })
})
