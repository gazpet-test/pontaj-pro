import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { patchGenerarePv, cheiCasPv, pvComparabil, parcelaAcoperitaA, detinatoriFaraPvA, numeDestinatariPvB, verificaDatePvB, genereazaPvB, genereazaPvA, referintaPvA } from './pv.js'

// Acelasi tabel de cazuri ca DRY SQL; expected este decizia juridica, nu calculat din implementare.
const dry = readFileSync('supabase/tests/20261130n_redari_pv_utilizatori_dryrun.sql', 'utf8')
const cazuri = [...dry.matchAll(/ \('([a-z_]+)','(\[[^\n]*\])'::jsonb,(true|false)\)/g)]
  .map(([,nume,date,acoperita]) => ({nume,date:JSON.parse(date),acoperita:acoperita === 'true'}))
function dateCaz(caz) {
  const detinatori = caz.date.map((s,i) => ({id:'d'+i,nume:'FICTIV '+i,calitate:s.actual ?? s.rol,sters_la:s.sters ? '2026-11-05' : null}))
  const pvs = caz.date.flatMap((s,i) => s.stare ? [{id:'a'+i,parcela_id:'p',detinator_id:'d'+i,tip:'A',stare:s.stare,
    calitate_semnatar:s.rol,nr_pv:'PVA-ZXP-000'+i,data_pv:'2026-11-05',sters_la:s.sters_pv ? '2026-11-05' : null}] : [])
  return {parcela:{id:'p'},detinatori,pvs}
}
describe('PR1 paritate cu DRY SQL', () => {
  it('tabelul independent contine toate cele 16 cazuri', () => expect(cazuri).toHaveLength(16))
  it.each(cazuri)('$nume => acoperita=$acoperita', caz => {
    const date=dateCaz(caz)
    expect(parcelaAcoperitaA(date)).toBe(caz.acoperita)
    expect(verificaDatePvB(date).includes('parcela acoperita prin PV A semnat')).toBe(caz.acoperita)
    if (caz.acoperita) expect(detinatoriFaraPvA(date)).toEqual([])
  })
  it('nu deduce rolul istoric lipsa din rolul actual', () => {
    const date=dateCaz(cazuri.find(c=>c.nume==='coproprietari_utilizator_semnat'))
    for (const pv of date.pvs) delete pv.calitate_semnatar
    expect(parcelaAcoperitaA(date)).toBe(false)
  })
  it('ignora PV de pe alta parcela, anulat, sters, nesemnat si tip B', () => {
    const date=dateCaz(cazuri.find(c=>c.nume==='coproprietari_utilizator_semnat'))
    for (const patch of [{parcela_id:'alta'},{tip:'B'},{stare:'anulat'},{stare:'generat'},{sters_la:'2026-11-05'}]) {
      expect(parcelaAcoperitaA({...date,pvs:date.pvs.map(p=>({...p,...patch}))})).toBe(false)
    }
  })
  it('referinta nu recomanda PV B pentru coproprietari acoperiti de utilizator', () => {
    expect(referintaPvA(dateCaz(cazuri[2]))).toBe('Parcela acoperita prin PV A semnat; PV B nu este necesar.')
  })
})
it('PV B separa utilizatorii/arendasii de proprietari, pastrand numele fictive', async () => {
  const detinatori=[{id:'o',nume:'FICTIV PROPRIETAR',calitate:'proprietar'},
    {id:'u',nume:'FICTIV UTILIZATOR',calitate:'utilizator'},{id:'a',nume:'FICTIV ARENDAS',calitate:'arendas'}]
  const text='Proprietari: FICTIV PROPRIETAR\nUtilizatori / arendasi: FICTIV UTILIZATOR; FICTIV ARENDAS'
  expect(numeDestinatariPvB(detinatori)).toBe(text)
  const r=await genereazaPvB({strict:false,parcela:{id:'p'},detinatori,
    templateArrayBuffer:readFileSync('public/redari/sabloane/pv_b.docx')})
  expect(r.campuri.nume).toBe(text)
  expect(r.campuri.bifa_neidentificat).toBe('☐')
})
it('PV A foloseste calitatea serverului cand rolul curent s-a schimbat', async () => {
  const r=await genereazaPvA({strict:false,pv:{stare:'semnat',calitate_semnatar:'arendas'},detinator:{calitate:'proprietar'},
    templateArrayBuffer:readFileSync('public/redari/sabloane/pv_a.docx')})
  expect(r.campuri.calitate_cota).toContain('arendaș')
})

it.each(['generat','trimis_spre_semnare'])('PV A %s: proprietar -> arendas inainte de semnare urmeaza rolul curent', async stare => {
  const date={strict:false,pv:{stare,calitate_semnatar:'proprietar'},detinator:{calitate:'proprietar'},
    templateArrayBuffer:readFileSync('public/redari/sabloane/pv_a.docx')}
  expect((await genereazaPvA(date)).campuri.calitate_cota).toBe('proprietar')
  date.detinator.calitate='arendas'
  expect((await genereazaPvA(date)).campuri.calitate_cota).toBe('arendaș')
})
it('PV A semnat nu deduce din rolul curent un snapshot lipsa', async () => {
  const r=await genereazaPvA({strict:false,pv:{stare:'semnat',calitate_semnatar:null},detinator:{calitate:'arendas'},
    templateArrayBuffer:readFileSync('public/redari/sabloane/pv_a.docx')})
  expect(r.campuri.calitate_cota).toBe('')
})

it('generarea transmite rolul DOCX curent ca preconditie, nu snapshot-ul draftului', async () => {
  const date={strict:false,pv:{tip:'A',stare:'generat',calitate_semnatar:'proprietar'},detinator:{calitate:'arendas'},
    templateArrayBuffer:readFileSync('public/redari/sabloane/pv_a.docx')}
  expect((await genereazaPvA(date)).campuri.calitate_cota).toBe('arendaș')
  expect(patchGenerarePv(date,'FICTIV/v2.docx')).toEqual({fisier_generat_path:'FICTIV/v2.docx',calitate_document:'arendas'})
  expect(date.pv.calitate_semnatar).toBe('proprietar')
  expect(patchGenerarePv({pv:{tip:'B'}},'FICTIV/b.docx')).toEqual({fisier_generat_path:'FICTIV/b.docx'})
  expect(()=>patchGenerarePv({pv:{tip:'A'},detinator:{}},'FICTIV/v.docx')).toThrow('Calitatea detinatorului lipseste')
})
it('CAS draft ignora snapshot-ul derivat si pastreaza versiunea DOCX si editarile', () => {
  const chei=['locul','calitate_semnatar','calitate_document','fisier_generat_path']
  for (const stare of ['generat','trimis_spre_semnare']) {
    expect(cheiCasPv({stare},chei)).toEqual(['locul','calitate_document','fisier_generat_path'])
    const initial={tip:'A',stare,locul:'FICTIV',calitate_semnatar:'proprietar',calitate_document:'proprietar'}
    expect(pvComparabil({...initial,calitate_semnatar:'arendas'})).toEqual(pvComparabil(initial))
    expect(pvComparabil({...initial,locul:'ALT FICTIV'})).not.toEqual(pvComparabil(initial))
    expect(pvComparabil({...initial,calitate_document:'arendas'})).not.toEqual(pvComparabil(initial))
  }
  for (const stare of ['semnat','anulat']) {
    expect(cheiCasPv({stare},chei)).toEqual(chei)
    expect(pvComparabil({tip:'A',stare,calitate_semnatar:'arendas'})).toHaveProperty('calitate_semnatar','arendas')
  }
})
