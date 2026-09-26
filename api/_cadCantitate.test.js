// R5 (Copilot 25.09.2026): măsurătoarea automată din desenul CAD intră 'extras', nu 'validat'.
// Fișierul începe cu „_" ca și modulul: Vercel nu face funcții din el.
import { describe, it, expect } from 'vitest'
import { randCantitateCad } from './_cadCantitate.js'

const c = { numar: 1, lungime_3d_m: 35620.59, lungime_2d_m: 35598.1 }
const arg = { licitatieId: 3, denumire: 'Traseu măsurat din desenul proiectantului (Retea 35620.dwg)', c, notaAnaliza: 'Strat RETEA.' }

describe('randCantitateCad — o măsurătoare nu se auto-aprobă', () => {
  it('rând nou => status extras (înainte: validat fără niciun om — lic. 3, rândul 9)', () => {
    const r = randCantitateCad(arg, null)
    expect(r.op).toBe('insert'); expect(r.rand.status).toBe('extras'); expect(r.rand.cantitate).toBe(35620.59)
    expect(r.rand.diferenta_nota).toMatch(/^Măsurat din desen: 35.620,59 m în spațiu/)
    expect(r.rand.diferenta_nota).not.toMatch(/undefined/)
  })
  // R5 runda 4 (verificator R3, MAJOR / ADV2): înainte, rândul VALIDAT primea tăcut o măsurătoare nouă în cantitate_plansa
  // (coloana folosită de grafic cu baza „planșe"), fără să-și schimbe statusul => cifră automată neverificată „aprobată".
  it('rând VALIDAT + măsurătoare nouă diferită (≥ 1 m) => „diferenta", cantitate (a omului) neatinsă, nota cere revalidarea', () => {
    const r = randCantitateCad(arg, { id: 9, cantitate: 35000, cantitate_plansa: 35000, status: 'validat' })
    expect(r.op).toBe('update'); expect(r.patch).not.toHaveProperty('cantitate')
    expect(r.patch.status).toBe('diferenta'); expect(r.patch.cantitate_plansa).toBe(35620.59)
    expect(r.patch.diferenta_nota).toMatch(/^Rândul era VALIDAT cu măsurătoarea anterioară 35\.000 m; noua măsurătoare diferă — validarea se reface\. Măsurat din desen/)
  })
  it('ADV2 (lic. 3, rândul 9 real, validat 35.620,59): re-măsurare 41.000 => „diferenta"; aceeași cifră (< 1 m) => validarea rămâne', () => {
    const r9 = { id: 9, cantitate: 35620.59, cantitate_plansa: 35620.59, status: 'validat' }
    const alt = randCantitateCad({ ...arg, c: { numar: 1, lungime_3d_m: 41000, lungime_2d_m: 40990 } }, r9)
    expect(alt.patch.status).toBe('diferenta'); expect(alt.patch.cantitate_plansa).toBe(41000)
    const same = randCantitateCad({ ...arg, c: { numar: 1, lungime_3d_m: 35621.2, lungime_2d_m: 35600 } }, r9)
    expect(same.patch).not.toHaveProperty('status'); expect(same.patch.diferenta_nota).not.toMatch(/VALIDAT/)
  })
  it('referința e cantitate_plansa, apoi cantitate (rând validat fără măsurătoare anterioară)', () => {
    const r = randCantitateCad(arg, { id: 9, cantitate: 35000, cantitate_plansa: null, status: 'validat' })
    expect(r.patch.status).toBe('diferenta'); expect(r.patch.diferenta_nota).toMatch(/cu cantitatea 35\.000 m/)
    const ok = randCantitateCad(arg, { id: 9, cantitate: 35620, cantitate_plansa: null, status: 'validat' })
    expect(ok.patch).not.toHaveProperty('status')
  })
  it('rând nevalidat: cifra se actualizează; statusul NU devine validat; cifră schimbată => „diferenta" (și contra cursei cu o validare)', () => {
    const r = randCantitateCad(arg, { id: 9, cantitate: 1, cantitate_plansa: 1, status: 'extras' })
    expect(r.patch.cantitate).toBe(35620.59); expect(r.patch.status).toBe('diferenta')
    expect(r.patch.diferenta_nota).toMatch(/^Măsurătoarea diferă de măsurătoarea anterioară 1 m\./)
    const la = randCantitateCad(arg, { id: 9, cantitate: 35620.59, cantitate_plansa: 35620.59, status: 'extras' })
    expect(la.patch).not.toHaveProperty('status'); expect(la.patch.cantitate).toBe(35620.59)
  })
  it('nicio ramură nu scrie status=validat', () => {
    for (const ex of [null, { id: 1, status: 'extras' }, { id: 1, status: 'diferenta' }, { id: 1, status: 'validat', cantitate: 35620.59 }]) {
      const r = randCantitateCad(arg, ex)
      expect((r.rand || r.patch).status).not.toBe('validat')
    }
  })
})

// R5 runda 5 (verificatorul condițiilor 1–2)
describe('randCantitateCad — runda 5', () => {
  it('MAJOR 1: rândul INVALIDAT (nevalidat, prefixul regulii) își păstrează prefixul când re-măsurarea îi rescrie nota', () => {
    const pre = 'Rândul era VALIDAT — aprobarea veche (cantitate 35.620,59 m) nu mai e valabilă: s-a schimbat unitatea de măsură („m” → „ml”). Valoarea și aprobarea veche rămân în istoric; validarea se reface.'
    const r = randCantitateCad(arg, { id: 9, um: 'ml', cantitate: 35620.59, cantitate_plansa: 35620.59, status: 'diferenta', diferenta_nota: pre + ' Măsurat exact…' })
    expect(r.patch.diferenta_nota.startsWith(pre + ' Măsurat din desen: 35.620,59 m')).toBe(true)
  })
  it('MAJOR 2: re-măsurări mici cumulate pe rândul VALIDAT — față de valoarea APROBATĂ (referința din istoric) => „diferenta”', () => {
    const aprobat = { id: 9, cantitate: 35620.59, cantitate_plansa: 35620.59, status: 'validat', um: 'm' }
    const acum = { ...aprobat, cantitate_plansa: 35621.4 }   // o re-măsurare anterioară, sub prag
    const c2 = { numar: 1, lungime_3d_m: 35622.1, lungime_2d_m: 35600 }   // +0,7 față de acum, +1,51 față de aprobat
    expect(randCantitateCad({ ...arg, c: c2 }, acum).patch).not.toHaveProperty('status')   // fără referință: gaura
    const r = randCantitateCad({ ...arg, c: c2 }, acum, aprobat)
    expect(r.patch.status).toBe('diferenta')
    expect(r.patch.diferenta_nota).toMatch(/^Rândul era VALIDAT — aprobarea veche \(cantitate 35\.620,59 m, cifra din planșă 35\.620,59 m\) nu mai e valabilă: s-a schimbat cifra din planșă \(35\.620,59 m → 35\.622,1 m\)/)
  })
})
