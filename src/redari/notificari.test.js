// 📬 Notificări — agregarea pe deținător / UAT, filtrele, exportul și ghidul modelelor. Date fictive.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { agregaDetinatori, centralizeaza, filtreaza, FILTRE_NOTIF, csvDetinatori, ANTET_DETINATORI, foaieCentralizatorNotif,
  ghidModele, comaseazaLipsuri, statisticiCanale, randuriCorespondenta, CANALE_RASPUNS } from './notificari.js'
import { hartaSms } from './smsStare.js'
import { motivBlocareConvocator } from './ui/comune.jsx'

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const U1 = { id: 'u1', nume: 'Alfa', uat3: 'ALF', afisare_pv_nr: 'PV-7', afisare_data_start: '2026-12-01', afisare_data_end: '2026-12-11' }
const U2 = { id: 'u2', nume: 'Beta', uat3: 'BET' }
const rand = (n, uat, extra = {}) => ({ parcela_id: 'p' + n, detinator_id: id(n), uat_id: uat.id, uat3: uat.uat3, uat_nume: uat.nume, id_parcela: `T1-${uat.uat3}-000${n}`,
  tronson: 1, nume: 'Persoana ' + n, calitate: 'proprietar', adresa_cunoscuta: true, stare: 'DE_CONVOCAT', ...extra })

// 1: convocat, expediat, AR → canal reușit (ar)
// 2: convocat, expediat, fără AR → de trimis, plecat neconfirmat
// 3: retur fără AR ulterior; SMS eșuat → de trimis, netrimis
// 4: neidentificat în UAT cu afișare → afișat (reușit)
// 5: fără adresă în UAT fără afișare → de trimis
// 6: răspuns online (ultimul), PV A semnat
// 7: SMS livrat → reușit
const randuri = [rand(1, U1), rand(2, U1), rand(3, U1), rand(4, U1, { calitate: 'neidentificat', adresa_cunoscuta: null }), rand(5, U2, { adresa_cunoscuta: false, tronson: null }),
  rand(6, U2), rand(7, U2)]
const conv = (n, extra) => ({ id: 'c' + n, detinator_id: id(n), stare: 'activ', sters_la: null, nr_document: 'C-000' + n, fisier_convocator_path: 'x/C-000' + n + '-v1.docx', ...extra })
const convocari = [conv(1, { data_expediere: '2026-11-10', data_confirmare_primire: '2026-11-14' }), conv(2, { data_expediere: '2026-11-10' }),
  conv(3, { data_expediere: '2026-11-10', retur: 'mutat', retur_data: '2026-11-20' }), { ...conv(9, {}), detinator_id: id(2), stare: 'anulat' }]
const raspunsuri = [{ id: 'r1', detinator_id: id(6), canal: 'telefon', data: '2026-11-15T10:00:00Z', seq: 1, optiune: 'particip' },
  { id: 'r2', detinator_id: id(6), canal: 'online', data: '2026-11-16T10:00:00Z', seq: 2, optiune: 'nu_particip_fara_obiectii' }]
const pvs = [{ id: 'v1', tip: 'A', parcela_id: 'p6', detinator_id: id(6), stare: 'semnat', sters_la: null }, { id: 'v2', tip: 'B', parcela_id: 'p2', detinator_id: null, stare: 'anulat', sters_la: null }]
const smsRand = (n, categorie, extra = {}) => ({ detinator_id: id(n), nr_trimise: 1, nr_livrate: categorie === 'livrat' ? 1 : 0, nr_esuate: categorie === 'esuat' ? 1 : 0, nr_in_curs: 0,
  ultima_stare: categorie, categorie, ultima_trimitere: '2026-11-12T08:00:00Z', ultima_livrare: categorie === 'livrat' ? '2026-11-12T08:01:00Z' : null, loturi: 1, ...extra })
const sms = hartaSms([smsRand(3, 'esuat'), smsRand(7, 'livrat')])
const cuTelefon = new Set([id(1), id(7)])
const toate = () => agregaDetinatori({ randuri, convocari, raspunsuri, pvs, sms, cuTelefon, uats: [U1, U2] })

describe('agregaDetinatori', () => {
  it('o înregistrare per pereche, cu canalele reușite și „de trimis”', () => {
    const d = Object.fromEntries(toate().map(x => [x.detinator_id, x]))
    expect(Object.keys(d)).toHaveLength(7)
    expect(d[id(1)]).toMatchObject({ convocator: true, convocator_fisier: true, expediat: true, ar: true, retur: false, de_trimis: false, canale_reusite: ['ar'] })
    expect(d[id(2)]).toMatchObject({ expediat: true, ar: false, de_trimis: true, in_curs: true, pv_b: null })   // convocarea anulată și PV B anulat nu contează
    expect(d[id(3)]).toMatchObject({ retur: true, sms: 'esuat', de_trimis: true, in_curs: false })
    expect(d[id(4)]).toMatchObject({ neidentificat: true, fara_adresa: false, afisat: true, de_trimis: false, canale_reusite: ['afisare'] })
    expect(d[id(5)]).toMatchObject({ fara_adresa: true, afisat: false, de_trimis: true, sms: 'fara', fara_telefon: true })
    expect(d[id(6)]).toMatchObject({ raspuns_canal: 'online', raspuns_optiune: 'nu_particip_fara_obiectii', raspunsuri: 2, pv_a: 'semnat', de_trimis: false })
    expect(d[id(7)]).toMatchObject({ sms: 'livrat', sms_trimise: 1, de_trimis: false, fara_telefon: false })
  })
  it('AR după retur stinge returul (aceeași regulă ca stare.js / vederea)', () => {
    const c = [conv(3, { data_expediere: '2026-11-10', retur: 'mutat', retur_data: '2026-11-20', data_confirmare_primire: '2026-11-25' })]
    const [x] = agregaDetinatori({ randuri: [randuri[2]], convocari: c, sms: new Map(), cuTelefon: new Set(), uats: [U1] })
    expect(x).toMatchObject({ retur: false, ar: true })
  })
  it('SMS / telefon necitite → null (necunoscut), nu „fără SMS” / „fără telefon” (L18)', () => {
    const [x] = agregaDetinatori({ randuri: [randuri[0]], convocari: [], uats: [U1] })
    expect(x.sms).toBeNull(); expect(x.sms_trimise).toBeNull(); expect(x.fara_telefon).toBeNull()
    const c = centralizeaza([x]).total
    expect(c.sms_trimis).toBeNull(); expect(c.sms_livrat).toBeNull(); expect(c.fara_telefon).toBeNull()
    expect(c.total).toBe(1)
  })
  it('PV în curs de semnare: „trimis”; doar generat: „generat”', () => {
    const [a, b] = agregaDetinatori({ randuri: [randuri[0], randuri[1]], pvs: [{ tip: 'A', detinator_id: id(1), parcela_id: 'p1', stare: 'trimis_spre_semnare', sters_la: null },
      { tip: 'B', parcela_id: 'p2', stare: 'generat', sters_la: null }], sms: new Map(), uats: [U1] })
    expect(a.pv_a).toBe('trimis'); expect(b.pv_b).toBe('generat'); expect(b.pv_a).toBeNull()
  })
})

describe('centralizeaza + filtre', () => {
  it('cifrele pe UAT și totalul', () => {
    const { randuri: r, total } = centralizeaza(toate())
    expect(r.map(x => x.uat_nume)).toEqual(['Alfa', 'Beta'])
    expect(r[0]).toMatchObject({ total: 4, convocator: 3, expediat: 3, ar: 1, retur: 1, sms_trimis: 1, sms_esuat: 1, de_trimis: 2, in_curs: 1, neidentificat: 1, afisat: 1 })
    expect(r[1]).toMatchObject({ total: 3, convocator: 0, raspuns: 1, r_online: 1, pv_a_semnat: 1, sms_livrat: 1, fara_adresa: 1, de_trimis: 1 })
    expect(total).toMatchObject({ total: 7, de_trimis: 3, fara_telefon: 5, raspuns: 1, r_telefon: 0 })
  })
  it('filtrele: UAT, de trimis, netrimis, fără telefon; filtru necunoscut = eroare', () => {
    const t = toate()
    expect(filtreaza(t, { uatId: 'u2' })).toHaveLength(3)
    expect(filtreaza(t, { filtru: 'de_trimis' }).map(d => d.id_parcela)).toEqual(['T1-ALF-0002', 'T1-ALF-0003', 'T1-BET-0005'])
    expect(filtreaza(t, { filtru: 'netrimis' }).map(d => d.id_parcela)).toEqual(['T1-ALF-0003', 'T1-BET-0005'])
    expect(filtreaza(t, { uatId: 'u1', filtru: 'fara_telefon' })).toHaveLength(3)
    expect(filtreaza(t, { filtru: 'sms_esuat' })).toHaveLength(1)
    expect(() => filtreaza(t, { filtru: 'xyz' })).toThrow(/Filtru necunoscut/)
    expect(FILTRE_NOTIF.every(f => f.cod === '' || typeof f.f === 'function')).toBe(true)
  })
  it('statisticile pe canal: toate răspunsurile vs. ultimul', () => {
    expect(statisticiCanale(raspunsuri, toate())).toEqual({ toate: { telefon: 1, online: 1 }, ultim: { online: 1 } })
    expect(CANALE_RASPUNS.map(c => c.canal)).toEqual(['online', 'telefon', 'sesiune', 'scris', 'sms', 'email'])
  })
})

describe('export', () => {
  it('CSV: BOM, ;, fără telefoane, anti formula-injection', () => {
    const t = toate(); t[0].nume = '=HYPERLINK("x")'
    const csv = csvDetinatori(t)
    expect(csv.startsWith('﻿' + ANTET_DETINATORI.join(';'))).toBe(true)
    expect(csv).not.toMatch(/telefon\s*[:;]\s*\+?\d/i)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.trim().split('\r\n')).toHaveLength(8)
  })
  it('foaia centralizatorului: antet + UAT-uri + TOTAL, „necunoscut” pentru sursa lipsă', () => {
    const f = foaieCentralizatorNotif(centralizeaza(agregaDetinatori({ randuri: [randuri[0]], uats: [U1] })))
    expect(f[0][0]).toBe('UAT'); expect(f.at(-1)[0]).toBe('TOTAL'); expect(f).toHaveLength(3)
    expect(f.at(-1)).toContain('necunoscut')
  })
})

describe('ghidModele', () => {
  const proiectGata = { cod: 'LOT1-PRUNISOR-JUPA', denumire: 'Lot', beneficiar: 'TGZ', contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '12', imputernicire_data: '2026-11-01',
    reprezentant_tgz_nume: 'R', reprezentant_gazpet_nume: 'G', reprezentant_gazpet_functie: 'f', contact_nume: 'C', contact_telefon: '0700000000', contact_email: 'a@gazpet.ro',
    text_gdpr: 'text', link_informare_gdpr: '' }
  const uatGata = { id: 'u1', nume: 'Alfa', judet: 'MH', sesiune_zi1: '2099-12-10', program_zi1: '09:00-15:00', reprezentant_uat_nume: 'Primar', afisare_pv_nr: '1',
    afisare_data_start: '2099-11-01', afisare_data_end: '2099-12-12', termen_confirmare: '2099-12-01', adresa_nr: 'AU-0001' }
  const pe = l => Object.fromEntries(l.map(m => [m.cod, m]))
  it('convocatorul: aceleași motive ca motivBlocareConvocator, comasate pe UAT', () => {
    const proiect = { ...proiectGata, imputernicire_nr: '', imputernicire_data: null }
    const uats = [uatGata, { ...uatGata, id: 'u2', nume: 'Beta', sesiune_zi1: null }]
    const m = pe(ghidModele({ proiect, uats }))
    const asteptat = motivBlocareConvocator(proiect, uats[0], null)
    expect(m.convocator.stare).toBe('blocat')
    expect(m.convocator.lipsuri).toContain(`${asteptat} (toate UAT-urile)`)
    expect(m.convocator.lipsuri).toContain('UAT fără zi de sesiune cu program: Beta')
    expect(m.plic.stare).toBe('blocat'); expect(m.ar.stare).toBe('blocat')
  })
  it('proiect complet: convocator / plic / AR / PV A gata; GDPR parțial (pagina web nelivrată); mail proprietari nelivrat', () => {
    const m = pe(ghidModele({ proiect: proiectGata, uats: [uatGata], corespondenta: [], smsPanou: { nivel: 'owner', redari_autorizat: false, kill_switch: true } }))
    for (const c of ['convocator', 'plic', 'ar', 'pv_a', 'pv_b', 'adresa_uat', 'afisare', 'formular']) expect([c, m[c].stare, m[c].lipsuri]).toEqual([c, 'gata', []])
    expect(m.gdpr.stare).toBe('partial')
    expect(m.cerere_imputernicire.stare).toBe('gata')
    expect(m.mail_proprietari.stare).toBe('nelivrat')
    expect(m.sms.stare).toBe('blocat')
    expect(m.sms.lipsuri).toEqual(expect.arrayContaining(['Așteaptă autorizarea scrisă Transgaz', 'trimiterea e oprită (kill-switch)']))
  })
  it('textul AR validat doar pe LOT1; eroarea SMS e afișată, nu ascunsă (L18)', () => {
    const m = pe(ghidModele({ proiect: { ...proiectGata, cod: 'TEST-X' }, uats: [uatGata], smsPanouEroare: 'fără nivel pe SMS' }))
    expect(m.ar.lipsuri).toContain('textul AR nu e validat juridic pentru acest proiect')
    expect(m.sms.lipsuri[0]).toMatch(/fără nivel pe SMS/)
    expect(m.coresp.stare).toBe('blocat')   // corespondența necitită ≠ „nimic de trimis”
  })
  it('PV B cere reprezentantul UAT; PV C semnalează perechile fără tronson; fără UAT-uri = blocat', () => {
    const m = pe(ghidModele({ proiect: proiectGata, uats: [{ ...uatGata, reprezentant_uat_nume: '' }], parceleFaraTronson: 5 }))
    expect(m.pv_b.lipsuri.join(' ')).toMatch(/reprezentantul UAT/)
    expect(m.pv_c.lipsuri.join(' ')).toMatch(/5 parcele fără tronson/)
    expect(pe(ghidModele({ proiect: proiectGata, uats: [] })).convocator.stare).toBe('blocat')
  })
  it('comaseazaLipsuri și corespondența sortată, „Aprobat” fără nume', () => {
    expect(comaseazaLipsuri([{ nume: 'A', lipsuri: ['x', 'y'] }, { nume: 'B', lipsuri: ['x'] }])).toEqual(['x (toate UAT-urile)', 'y: A'])
    expect(comaseazaLipsuri([{ nume: 'A', lipsuri: ['x'] }])).toEqual(['x: A'])
    const r = randuriCorespondenta([{ cod: 'B1', ordine: 2, stare: 'draft' }, { cod: 'A1', ordine: 1, stare: 'aprobat' }])
    expect(r.map(x => [x.cod, x.eticheta])).toEqual([['A1', 'Aprobat'], ['B1', 'Draft']])
  })
})
