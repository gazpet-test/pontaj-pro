// Teste pentru motorul graficului automat (spec docs/ofertare/GRAFIC_AUTOMAT_SPEC.md §10.3).
// Valorile așteptate sunt calculate de mână (date, indexuri, marje), nu luate din codul testat.
// Datele de test sunt sintetice (ART1, SubX); nimic din documentele unei licitații.
import { describe, it, expect } from 'vitest'
import {
  pasteOrtodox, sarbatoriLegaleRO, creeazaCalendar, creeazaAxa, adaugaLuni, dataLimita,
  valideazaStructura, calculeazaCPM, calculeazaGrafic, tabelPERT, tabelDrumCritic, genereazaMSPDI,
} from './index.js'
import { exceptiiCalendar, CAMPURI_TEXT } from './mspdi.js'
// ID-urile câmpurilor MS Project scrise LITERAL în teste (Task Text1 = 188743731, Text2 = 188743734, Text3 = 188743737, Text4 = 188743740), nu luate din constanta exportatorului

// ── utilitare de test ──
const cpmDin = (activitati, legaturi) => {
  const st = valideazaStructura(activitati, legaturi)
  expect(st.probleme).toEqual([])
  return calculeazaCPM(st)
}
const act = (cod, d, extra = {}) => ({ cod, durata_zile_lucratoare: d, ...extra })
const jal = (cod, extra = {}) => ({ cod, jalon: true, durata_zile_lucratoare: 0, categorie: 'jalon', ...extra })
const L = (de, la, tip = 'FS', lag_zile = 0) => ({ de, la, tip, lag_zile })
const coduri = (rez, gravitate) => rez.probleme.filter(p => !gravitate || p.gravitate === gravitate).map(p => p.cod)

// XML bine format: fiecare etichetă deschisă se închide în ordine (verificare minimă, fără parser DOM în mediul de test)
function xmlBineFormat(xml) {
  const corp = xml.replace(/^<\?xml[^>]*\?>/, '')
  const stiva = []
  for (const m of corp.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (m[1]) { if (stiva.pop() !== m[2]) return false } else stiva.push(m[2])
  }
  return stiva.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(corp)
}

describe('calendar — sărbători legale RO', () => {
  it('Paștele ortodox 2024–2030 (datele publicate)', () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029, 2030].map(pasteOrtodox))
      .toEqual(['2024-05-05', '2025-04-20', '2026-04-12', '2027-05-02', '2028-04-16', '2029-04-08', '2030-04-28'])
  })
  it('Vinerea Mare, Paștele, Rusaliile (duminica + lunea) pe 2027–2030', () => {
    const asteptat = {
      2027: ['2027-04-30', '2027-05-02', '2027-05-03', '2027-06-20', '2027-06-21'],
      2028: ['2028-04-14', '2028-04-16', '2028-04-17', '2028-06-04', '2028-06-05'],
      2029: ['2029-04-06', '2029-04-08', '2029-04-09', '2029-05-27', '2029-05-28'],
      2030: ['2030-04-26', '2030-04-28', '2030-04-29', '2030-06-16', '2030-06-17'],
    }
    for (const [an, date] of Object.entries(asteptat)) {
      const s = new Map(sarbatoriLegaleRO(Number(an)).map(x => [x.data, x.nume]))
      expect(s.get(date[0])).toBe('Vinerea Mare')
      expect(s.get(date[1])).toBe('Paștele ortodox')
      expect(s.get(date[2])).toBe('Paștele ortodox (a doua zi)')
      expect(s.get(date[3])).toBe('Rusaliile')
      expect(s.get(date[4])).toBe('Rusaliile (a doua zi)')
    }
  })
  it('lista fixă a anului 2027: 17 zile, inclusiv 6–7 ianuarie și 24 ianuarie', () => {
    const s = sarbatoriLegaleRO(2027).map(x => x.data)
    expect(s).toEqual(['2027-01-01', '2027-01-02', '2027-01-06', '2027-01-07', '2027-01-24', '2027-04-30', '2027-05-01', '2027-05-02', '2027-05-03',
      '2027-06-01', '2027-06-20', '2027-06-21', '2027-08-15', '2027-11-30', '2027-12-01', '2027-12-25', '2027-12-26'])
  })
  it('2026: a doua zi de Rusalii cade pe 1 iunie — o singură zi, cu ambele nume', () => {
    const s = sarbatoriLegaleRO(2026)
    expect(s.length).toBe(16)
    expect(s.find(x => x.data === '2026-06-01').nume).toBe('Ziua Copilului / Rusaliile (a doua zi)')
  })
  it('în afara 1900–2099 refuză explicit', () => {
    expect(() => pasteOrtodox(1899)).toThrow(/1900–2099/)
    expect(() => pasteOrtodox(2100)).toThrow(/1900–2099/)
  })
  it('fereastra Jilava: 6 sărbători în zile lucrătoare între 02.11.2026 și 04.02.2027', () => {
    const cal = creeazaCalendar()
    const libere = []
    for (let d = '2026-11-02'; d <= '2027-02-04'; d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)) {
      const m = cal.motivLiber(d); if (m && m.startsWith('sărbătoare')) { const z = new Date(d).getUTCDay(); if (z !== 0 && z !== 6) libere.push(d) }
    }
    expect(libere).toEqual(['2026-11-30', '2026-12-01', '2026-12-25', '2027-01-01', '2027-01-06', '2027-01-07'])
  })
})

describe('calendar — axa de zile lucrătoare și abaterile', () => {
  it('start într-o sâmbătă → prima zi lucrătoare e lunea', () => {
    const axa = creeazaAxa(creeazaCalendar(), '2027-03-06')
    expect(axa.start).toBe('2027-03-08')
    expect(axa.zi(4)).toBe('2027-03-12')
    expect(axa.zi(5)).toBe('2027-03-15')
    expect(axa.index('2027-03-14')).toBe(4)
    expect(axa.index('2027-03-07')).toBe(-1)
  })
  it('sâmbătă lucrată, oprire impusă, conflict, lucru în sărbătoare — toate apar în abateri / probleme', () => {
    const cal = creeazaCalendar({ lucratoare_suplimentare: ['2027-03-13', '2027-12-01', '2027-03-20'], opriri: [{ de: '2027-03-17', pana: '2027-03-22', motiv: 'fereastră operator' }] })
    expect(cal.esteLucratoare('2027-03-13')).toBe(true)
    expect(cal.esteLucratoare('2027-03-17')).toBe(false)
    expect(cal.motivLiber('2027-03-18')).toBe('oprire: fereastră operator')
    expect(cal.esteLucratoare('2027-03-20')).toBe(false) // sâmbătă declarată lucrată, dar în oprire: oprirea bate
    expect(cal.probleme.map(p => p.cod).sort()).toEqual(['CALENDAR_CONFLICT', 'LUCRU_IN_SARBATOARE'])
    expect(cal.abateri.map(a => a.tip).sort()).toEqual(['lucratoare_suplimentara', 'lucratoare_suplimentara', 'lucratoare_suplimentara', 'oprire'])
  })
  it('termenul: luni (prudent și după Codul civil), zile calendaristice, zile lucrătoare, dată fixă', () => {
    const axa = creeazaAxa(creeazaCalendar(), '2026-11-02')
    expect(dataLimita({ tip: 'luni', valoare: 3 }, '2026-11-02', axa)).toBe('2027-02-01')
    expect(dataLimita({ tip: 'luni', valoare: 3, numara_ziua_start: false }, '2026-11-02', axa)).toBe('2027-02-02')
    expect(adaugaLuni('2027-01-31', 1)).toBe('2027-02-28')
    expect(dataLimita({ tip: 'zile_calendaristice', valoare: 30 }, '2026-11-02', axa)).toBe('2026-12-01')
    expect(dataLimita({ tip: 'zile_lucratoare', valoare: 20 }, '2026-11-02', axa)).toBe('2026-11-27')
    expect(dataLimita({ tip: 'data', valoare: '2027-01-15' }, '2026-11-02', axa)).toBe('2027-01-15')
    expect(() => dataLimita({ tip: 'saptamani', valoare: 2 }, '2026-11-02', axa)).toThrow()
  })
})

describe('CPM — FS / SS / FF / SF cu decalaj', () => {
  it('FS cu decalaj pozitiv și negativ (lead)', () => {
    const r = cpmDin([act('A', 3), act('B', 2), act('C', 4)], [L('A', 'B', 'FS', 1), L('A', 'C', 'FS', -2)]).rezultate
    expect([r.get('B').es, r.get('B').ef]).toEqual([4, 6])
    expect([r.get('C').es, r.get('C').ef]).toEqual([1, 5])
  })
  it('SS și FF', () => {
    const r = cpmDin([act('A', 5), act('B', 3), act('C', 3)], [L('A', 'B', 'SS', 2), L('A', 'C', 'FF', 2)]).rezultate
    expect([r.get('B').es, r.get('B').ef]).toEqual([2, 5])
    expect([r.get('C').es, r.get('C').ef]).toEqual([4, 7]) // EF_C ≥ EF_A + 2 = 7
  })
  it('SF și decalaj negativ care ar împinge înaintea startului → ES rămâne 0', () => {
    const r = cpmDin([act('A', 5), act('B', 3), act('C', 2)], [L('A', 'B', 'SF', 1), L('A', 'C', 'SS', -3)]).rezultate
    expect(r.get('B').es).toBe(0) // EF_B ≥ ES_A + 1 = 1 → ES_B ≥ −2 → 0
    expect(r.get('C').es).toBe(0)
  })
  it('trecerea înapoi: marja, LS/LF pe SS și FF', () => {
    const r = cpmDin([act('A', 4), act('B', 4), act('X', 2), act('Y', 5), jal('F')],
      [L('A', 'B', 'SS', 1), L('A', 'F'), L('B', 'F'), L('X', 'Y', 'FF', 1), L('Y', 'F')]).rezultate
    // T = max(EF_A 4, EF_B 5, EF_Y 5) = 5
    expect([r.get('B').ls, r.get('B').lf, r.get('B').marja]).toEqual([1, 5, 0])
    expect([r.get('A').ls, r.get('A').lf, r.get('A').marja]).toEqual([0, 4, 0]) // SS: LF_A ≤ LS_B − 1 + 4 = 4
    expect([r.get('Y').es, r.get('Y').ef]).toEqual([0, 5])
    expect([r.get('X').ls, r.get('X').lf, r.get('X').marja]).toEqual([2, 4, 2]) // FF: LF_X ≤ LF_Y − 1 = 4
  })
  it('două legături între aceeași pereche (SS+1 și FF+1), ca la 4.3.16 → 4.3.17 din testul Jilava', () => {
    const r = cpmDin([act('S', 2), act('I', 2)], [L('S', 'I', 'SS', 1), L('S', 'I', 'FF', 1)]).rezultate
    expect([r.get('I').es, r.get('I').ef]).toEqual([1, 3])
  })
  it('rezumatele primesc ES/EF/LS/LF și marja (min a copiilor)', () => {
    const r = cpmDin([{ cod: 'R', rezumat: true }, jal('S'), act('A', 5, { parinte: 'R' }), act('B', 2, { parinte: 'R' }), jal('F')],
      [L('S', 'A'), L('S', 'B'), L('A', 'F'), L('B', 'F')]).rezultate
    expect(r.get('B').marja).toBe(3)
    expect(r.get('R')).toMatchObject({ es: 0, ef: 5, ls: 0, lf: 5, marja: 0, critic: true, d: 5 })
  })
  it('rezumat necritic: LS/LF = min LS / max LF ale copiilor', () => {
    const r = cpmDin([{ cod: 'R', rezumat: true }, act('A', 6), act('B', 2, { parinte: 'R' }), act('C', 1, { parinte: 'R' }), jal('F')],
      [L('A', 'F'), L('B', 'C'), L('C', 'F')]).rezultate
    expect(r.get('R')).toMatchObject({ es: 0, ef: 3, ls: 3, lf: 6, marja: 3, critic: false })
  })
  it('ciclul e eroare explicită, cu ciclul afișat', () => {
    const st = valideazaStructura([act('A', 1), act('B', 1), act('C', 1), act('D', 1)], [L('D', 'A'), L('A', 'B'), L('B', 'C'), L('C', 'A')])
    const c = calculeazaCPM(st)
    expect(c.ok).toBe(false)
    expect(c.probleme[0].cod).toBe('CICLU')
    expect(c.ciclu).toEqual(['A', 'B', 'C', 'A'])
  })
  it('erori de structură fatale: cod dublu, capăt inexistent, legătură pe rezumat, tip necunoscut, durată fracționară', () => {
    const st = valideazaStructura(
      [{ cod: 'R', rezumat: true }, act('A', 1, { parinte: 'R' }), act('A', 2), act('B', 1.5), act('C', 1)],
      [L('A', 'Z'), L('R', 'C'), L('A', 'C', 'XX'), { de: 'A', la: 'C', tip: 'FS', lag_zile: 0.5 }])
    expect(st.probleme.map(p => p.cod).sort()).toEqual(['COD_DUBLU', 'DURATA_INVALIDA', 'LAG_INVALID', 'LEGATURA_CAPAT_INEXISTENT', 'LEGATURA_PE_REZUMAT', 'TIP_LEGATURA_INVALID'])
  })
  it('părinte inexistent, părinte care nu e rezumat, rezumat gol', () => {
    const st = valideazaStructura([{ cod: 'R', rezumat: true }, act('A', 1, { parinte: 'Q' }), act('B', 1, { parinte: 'A' })], [])
    expect(st.probleme.map(p => p.cod).sort()).toEqual(['PARINTE_INEXISTENT', 'PARINTE_NU_E_REZUMAT', 'REZUMAT_GOL'])
  })
})

// ── un grafic mic, complet, care trece toate verificările în modul „depunere” ──
function graficBun() {
  return {
    mod: 'depunere',
    data_start: '2027-03-01',
    termen: { tip: 'luni', valoare: 1 },
    articole_validate: [{ cod: 'ART1' }, { cod: 'art2' }],
    parametri: { echipe: { sudori: 1 }, capacitate_subcontractanti: { SubX: { izolatori: 1 } }, utilaje: { macara: 1 }, subcontractanti: ['SubX'] },
    activitati: [
      { cod: 'R0', rezumat: true, denumire: 'Lucrare' },
      { cod: 'J1', parinte: 'R0', jalon: true, durata_zile_lucratoare: 0, denumire: 'Ordin de începere', executant: 'beneficiar', categorie: 'jalon' },
      { cod: 'A1', parinte: 'R0', denumire: 'Sudură', categorie: 'executie', articole_deviz: ['ART1'], executant: 'Gazpet', durata_zile_lucratoare: 3, sursa_durata: 'norma:SUD-01', tip_echipa: 'sudori', utilaje: ['macara'] },
      { cod: 'A2', parinte: 'R0', denumire: 'Izolare', categorie: 'executie', articole_deviz: ['ART2'], executant: 'SubX', durata_zile_lucratoare: 2, sursa_durata: 'raspuns:17', tip_echipa: 'izolatori' },
      { cod: 'J2', parinte: 'R0', jalon: true, durata_zile_lucratoare: 0, denumire: 'PV recepție', executant: 'beneficiar', categorie: 'jalon' },
    ],
    legaturi: [L('J1', 'A1'), L('A1', 'A2', 'FS', 0), L('A2', 'J2')],
  }
}
const cuActivitate = (g, cod, modif) => ({ ...g, activitati: g.activitati.map(a => (a.cod === cod ? { ...a, ...modif } : a)) })

describe('calculeazaGrafic — verificările structurale (§6.3)', () => {
  it('graficul bun: fără erori, GO posibil, date și termen corecte', () => {
    const r = calculeazaGrafic(graficBun())
    expect(r.probleme).toEqual([])
    expect(r.poate_fi_go).toBe(true)
    expect(r.durata_zile_lucratoare).toBe(5)
    expect(r.data_final).toBe('2027-03-05')
    expect(r.jalon_final).toBe('J2')
    expect(r.termen).toEqual({ data_limita: '2027-03-31', data_final: '2027-03-05', rezerva_zile_lucratoare: 18, incadrat: true }) // 31.03 = a 23-a zi lucrătoare (index 22); finalul are index 4
    const p = new Map(r.pozitii.map(x => [x.cod, x]))
    expect(p.get('A2')).toMatchObject({ start: '2027-03-04', final: '2027-03-05', marja: 0, critic: true })
    expect(p.get('J2')).toMatchObject({ start: '2027-03-05', final: '2027-03-05' }) // jalon: sfârșitul zilei ES−1
    expect(p.get('J1')).toMatchObject({ start: '2027-03-01' })
    expect(p.get('R0')).toMatchObject({ start: '2027-03-01', final: '2027-03-05', durata: 5, nivel: 0 })
    expect(r.drum_critic.lista).toEqual(['J1', 'A1', 'A2', 'J2'])
  })
  it('PRESUPUS: eroare în lucru și depunere, avertisment în schiță — schița nu e niciodată GO', () => {
    const g = cuActivitate(graficBun(), 'A1', { sursa_durata: 'PRESUPUS' })
    expect(coduri(calculeazaGrafic(g), 'eroare')).toEqual(['DURATA_PRESUPUSA'])
    expect(coduri(calculeazaGrafic({ ...g, mod: 'lucru' }), 'eroare')).toEqual(['DURATA_PRESUPUSA'])
    const s = calculeazaGrafic({ ...g, mod: 'schita' })
    expect(coduri(s, 'eroare')).toEqual([])
    expect(coduri(s, 'avertisment')).toEqual(['DURATA_PRESUPUSA'])
    expect(s.trece_verificarile).toBe(true)
    expect(s.poate_fi_go).toBe(false)
    expect(calculeazaGrafic({ ...graficBun(), mod: 'schita' }).poate_fi_go).toBe(false)
  })
  it('sursa duratei trebuie să fie norma:/document:/raspuns:/parametru:', () => {
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { sursa_durata: 'estimat' })), 'eroare')).toEqual(['SURSA_DURATA_INVALIDA'])
  })
  it('executant presupus: eroare doar la depunere', () => {
    const g = cuActivitate(graficBun(), 'A1', { executant: 'PRESUPUS — de confirmat' })
    expect(coduri(calculeazaGrafic(g), 'eroare')).toContain('EXECUTANT_PRESUPUS')
    expect(coduri(calculeazaGrafic({ ...g, mod: 'lucru' }), 'eroare')).not.toContain('EXECUTANT_PRESUPUS')
  })
  it('deviz: articole grupate, articol necunoscut, articol fără activitate, execuție fără articol, articol pe rezumat', () => {
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { articole_deviz: ['ART1', 'ART2'] })), 'eroare')).toEqual(['ARTICOLE_GRUPATE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { articole_deviz: ['ART9'] })), 'eroare').sort()).toEqual(['ARTICOL_FARA_ACTIVITATE', 'ARTICOL_NECUNOSCUT'])
    expect(coduri(calculeazaGrafic({ ...graficBun(), articole_validate: [{ cod: 'ART1' }, { cod: 'ART2' }, { cod: 'ART3' }] }), 'eroare')).toEqual(['ARTICOL_FARA_ACTIVITATE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A2', { articole_deviz: [] })), 'eroare').sort()).toEqual(['ARTICOL_FARA_ACTIVITATE', 'EXECUTIE_FARA_ARTICOL'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'R0', { articole_deviz: ['ART1'] })), 'eroare')).toEqual(['ARTICOL_PE_REZUMAT'])
  })
  it('un articol împărțit în două activități e permis', () => {
    const g = graficBun()
    g.activitati.splice(3, 0, { cod: 'A1b', parinte: 'R0', denumire: 'Sudură etapa 2', categorie: 'executie', articole_deviz: ['ART1'], executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'norma:SUD-01', tip_echipa: 'sudori' })
    g.legaturi = [L('J1', 'A1'), L('A1', 'A1b'), L('A1b', 'A2'), L('A2', 'J2')]
    expect(calculeazaGrafic(g).probleme).toEqual([])
  })
  it('fără cantități validate: „validați cantitățile”', () => {
    expect(coduri(calculeazaGrafic({ ...graficBun(), articole_validate: [] }), 'eroare')).toContain('CANTITATI_NEVALIDATE')
  })
  it('activitate fără succesor / fără jalon final', () => {
    const g = graficBun()
    expect(coduri(calculeazaGrafic({ ...g, legaturi: [L('J1', 'A1'), L('A1', 'A2')] }), 'eroare')).toEqual(['FARA_SUCCESOR'])
    const fara = { ...g, activitati: g.activitati.filter(a => a.cod !== 'J2'), legaturi: [L('J1', 'A1'), L('A1', 'A2')] }
    expect(coduri(calculeazaGrafic(fara), 'eroare').sort()).toEqual(['FARA_SUCCESOR', 'JALON_FINAL_LIPSA'])
  })
  it('durată 0 doar la jaloane; jalon cu durată; categorie lipsă sau necunoscută', () => {
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { durata_zile_lucratoare: 0 })), 'eroare')).toContain('DURATA_ZERO')
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'J2', { durata_zile_lucratoare: 1 })), 'eroare')).toContain('JALON_CU_DURATA')
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { categorie: undefined })), 'eroare')).toContain('CATEGORIE_LIPSA')
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { categorie: 'diverse' })), 'eroare')).toContain('CATEGORIE_INVALIDA')
  })
  it('capacitate: două activități Gazpet „sudori” în paralel cu o singură echipă = depășire, cu ziua și activitățile', () => {
    const g = cuActivitate(graficBun(), 'A2', { executant: 'Gazpet', tip_echipa: 'sudori' })
    g.legaturi = [L('J1', 'A1'), L('J1', 'A2'), L('A1', 'J2'), L('A2', 'J2')]
    const r = calculeazaGrafic(g)
    const p = r.probleme.find(x => x.cod === 'CAPACITATE_DEPASITA')
    expect(p).toMatchObject({ gravitate: 'eroare', zi: '2027-03-01', activitati: ['A1', 'A2'] })
    expect(calculeazaGrafic({ ...g, parametri: { ...g.parametri, echipe: { sudori: 2 } } }).probleme).toEqual([])
  })
  it('capacitate neconfirmată: eroare la depunere, avertisment în lucru; la fel utilajele', () => {
    const g = { ...graficBun(), parametri: { subcontractanti: ['SubX'] } }
    expect(coduri(calculeazaGrafic(g), 'eroare').sort()).toEqual(['CAPACITATE_NECONFIRMATA', 'CAPACITATE_NECONFIRMATA', 'UTILAJ_NECONFIRMAT'])
    const l = calculeazaGrafic({ ...g, mod: 'lucru' })
    expect(coduri(l, 'eroare')).toEqual([])
    expect(coduri(l, 'avertisment').sort()).toEqual(['CAPACITATE_NECONFIRMATA', 'CAPACITATE_NECONFIRMATA', 'UTILAJ_NECONFIRMAT'])
  })
  it('utilaj depășit (macara cerută de două activități simultane, 1 disponibilă)', () => {
    let g = cuActivitate(graficBun(), 'A2', { utilaje: [{ tip: 'macara', numar: 1 }] })
    g.legaturi = [L('J1', 'A1'), L('J1', 'A2'), L('A1', 'J2'), L('A2', 'J2')]
    expect(coduri(calculeazaGrafic(g), 'eroare')).toEqual(['UTILAJ_DEPASIT'])
  })
  it('termen depășit, cu zilele de depășire; termen lipsă', () => {
    const r = calculeazaGrafic({ ...graficBun(), termen: { tip: 'zile_lucratoare', valoare: 4 } })
    expect(r.probleme.find(p => p.cod === 'TERMEN_DEPASIT')).toMatchObject({ data_limita: '2027-03-04', data_final: '2027-03-05', depasire_zile_lucratoare: 1 })
    expect(r.poate_fi_go).toBe(false)
    expect(coduri(calculeazaGrafic({ ...graficBun(), termen: null }), 'eroare')).toEqual(['TERMEN_LIPSA'])
  })
  it('calendarul fără sărbători e refuzat la depunere', () => {
    const g = { ...graficBun(), parametri: { ...graficBun().parametri, calendar: { fara_sarbatori_legale: true } } }
    expect(coduri(calculeazaGrafic(g), 'eroare')).toEqual(['CALENDAR_FARA_SARBATORI'])
  })
  it('erorile fatale opresc calculul (nimic calculat, nimic GO)', () => {
    const r = calculeazaGrafic({ ...graficBun(), legaturi: [...graficBun().legaturi, L('A2', 'A1')] })
    expect(r.calculat).toBe(false)
    expect(coduri(r)).toEqual(['CICLU'])
    expect(r.poate_fi_go).toBe(false)
    expect(() => genereazaMSPDI(r)).toThrow()
  })
  it('sărbătorile mută datele: 5 zile de la 27.11.2026 trec peste 30.11 și 01.12', () => {
    const g = { ...graficBun(), data_start: '2026-11-27' }
    const r = calculeazaGrafic(g)
    // 27.11 (vi), 02.12, 03.12, 04.12, 07.12 → finalul 07.12.2026
    expect(r.data_final).toBe('2026-12-07')
  })
  it('rezumat care începe cu un jalon: începe în ziua jalonului (17:00), ca în MS Project', () => {
    const r = calculeazaGrafic({ mod: 'schita', data_start: '2027-03-01', activitati: [
      act('A', 2, { categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), { cod: 'R', rezumat: true },
      jal('J', { parinte: 'R', executant: 'beneficiar' }), act('B', 1, { parinte: 'R', categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), jal('F', { executant: 'beneficiar' })],
      legaturi: [L('A', 'J'), L('J', 'B'), L('B', 'F')] })
    const p = new Map(r.pozitii.map(x => [x.cod, x]))
    expect(p.get('J')).toMatchObject({ es: 2, start: '2027-03-02', start_moment: '2027-03-02T17:00:00' })
    expect(p.get('R')).toMatchObject({ es: 2, ef: 3, durata: 1, start: '2027-03-02', final: '2027-03-03', start_moment: '2027-03-02T17:00:00', final_moment: '2027-03-03T17:00:00' })
    const x = genereazaMSPDI(r).split('\n').find(l => l.includes('<WBS>R</WBS>'))
    expect(x).toContain('<Start>2027-03-02T17:00:00</Start><Finish>2027-03-03T17:00:00</Finish>')
  })
  it('tabelul PERT are câte un rând pentru fiecare poziție, inclusiv rezumatul; drumul critic are predecesorii conducători', () => {
    const r = calculeazaGrafic(graficBun())
    const t = tabelPERT(r)
    expect(t.map(x => x.cod)).toEqual(['R0', 'J1', 'A1', 'A2', 'J2'])
    expect(t[0]).toMatchObject({ rezumat: true, ES: '2027-03-01', EF: '2027-03-05', LS: '2027-03-01', LF: '2027-03-05', marja: 0 })
    expect(tabelDrumCritic(r).find(x => x.cod === 'A2').predecesori_critici).toEqual([{ de: 'A1', tip: 'FS', lag: 0 }])
  })
})

describe('export MSPDI', () => {
  const r = calculeazaGrafic({ ...graficBun(), parametri: { ...graficBun().parametri, calendar: { opriri: [{ de: '2027-03-08', pana: '2027-03-12', motiv: 'fereastră operator' }], lucratoare_suplimentare: ['2027-03-06'] } } })
  const xml = genereazaMSPDI(r, { titlu: 'Test & probă', fisier: 'test', parametri: graficBun().parametri })
  it('XML bine format, fără calendarul „7 zile”', () => {
    expect(xmlBineFormat(xml)).toBe(true)
    expect(xml).not.toMatch(/7 zile/)
    expect(xml).toContain('<Title>Test &amp; probă</Title>')
  })
  it('săptămâna luni–vineri: sâmbăta (7) și duminica (1) nelucrătoare', () => {
    expect(xml).toContain('<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>')
    expect(xml).toContain('<WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>')
    expect(xml).toMatch(/<WeekDay><DayType>2<\/DayType><DayWorking>1<\/DayWorking><WorkingTimes>/)
  })
  it('excepțiile: sărbătorile, oprirea ca interval, sâmbăta lucrată', () => {
    expect(xml).toContain('<FromDate>2027-12-01T00:00:00</FromDate><ToDate>2027-12-01T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>sărbătoare legală: Ziua Națională</Name><Type>1</Type><DayWorking>0</DayWorking>')
    expect(xml).toContain('<FromDate>2027-03-08T00:00:00</FromDate><ToDate>2027-03-12T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>oprire: fereastră operator</Name>')
    expect(xml).toMatch(/<FromDate>2027-03-06T00:00:00<\/FromDate>.*?<DayWorking>1<\/DayWorking><WorkingTimes>/)
    // 24.01.2027 e duminică: nu e excepție (deja liberă)
    expect(xml).not.toContain('<FromDate>2027-01-24T00:00:00</FromDate>')
  })
  it('exceptiiCalendar unește zilele consecutive cu același motiv și le separă pe cele cu motive diferite', () => {
    const e = exceptiiCalendar(creeazaCalendar(), '2026-11-28', '2026-12-02')
    expect(e).toEqual([
      { de: '2026-11-30', pana: '2026-11-30', lucratoare: false, nume: 'sărbătoare legală: Sf. Apostol Andrei' },
      { de: '2026-12-01', pana: '2026-12-01', lucratoare: false, nume: 'sărbătoare legală: Ziua Națională' },
    ])
  })
  it('tipurile de legătură MSPDI (FF=0, FS=1, SF=2, SS=3) și decalajul în zecimi de minut', () => {
    const g = graficBun()
    g.activitati.push({ cod: 'A3', parinte: 'R0', denumire: 'Probă', categorie: 'verificare_receptie', executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'document:12#p4' })
    g.activitati.push({ cod: 'A4', parinte: 'R0', denumire: 'Probă 2', categorie: 'verificare_receptie', executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'document:12#p4' })
    g.legaturi = [L('J1', 'A1'), L('A1', 'A2', 'SS', 1), L('A1', 'A3', 'FF', -1), L('A1', 'A4', 'SF', 2), L('A2', 'J2'), L('A3', 'J2'), L('A4', 'J2')]
    const x = genereazaMSPDI(calculeazaGrafic(g))
    const uidA1 = 3 // R0=1, J1=2, A1=3
    expect(x).toContain(`<PredecessorUID>${uidA1}</PredecessorUID><Type>3</Type><CrossProject>0</CrossProject><LinkLag>4800</LinkLag>`)
    expect(x).toContain(`<PredecessorUID>${uidA1}</PredecessorUID><Type>0</Type><CrossProject>0</CrossProject><LinkLag>-4800</LinkLag>`)
    expect(x).toContain(`<PredecessorUID>${uidA1}</PredecessorUID><Type>2</Type><CrossProject>0</CrossProject><LinkLag>9600</LinkLag>`)
    expect(x).toContain('<PredecessorUID>2</PredecessorUID><Type>1</Type>')
  })
  it('decalajul negativ care ar trage activitatea înaintea OI: ES = 0 și „începe nu mai devreme de” OI în fișier', () => {
    const g = graficBun()
    g.activitati.push({ cod: 'A3', parinte: 'R0', denumire: 'Probă', categorie: 'verificare_receptie', executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'document:12#p4' })
    g.legaturi = [...g.legaturi, L('A1', 'A3', 'SS', -2), L('A3', 'J2')]
    const r = calculeazaGrafic(g)
    const a3 = r.pozitii.find(p => p.cod === 'A3')
    expect([a3.es, a3.limitat_la_start]).toEqual([0, true])
    expect(r.pozitii.find(p => p.cod === 'A2').limitat_la_start).toBe(false)
    const x = genereazaMSPDI(r).split('\n')
    expect(x.find(l => l.includes('<WBS>A3</WBS>'))).toContain('<ConstraintType>4</ConstraintType><ConstraintDate>2027-03-01T08:00:00</ConstraintDate>')
    expect(x.find(l => l.includes('<WBS>A2</WBS>'))).toContain('<ConstraintType>0</ConstraintType>')
  })
  it('rezumatul are Summary=1 după structură, activitățile 0; jalonul final la 17:00 în ziua ES−1', () => {
    const t = xml.split('\n').filter(l => l.startsWith('<Task>'))
    expect(t[0]).toMatch(/<WBS>R0<\/WBS>.*<Summary>1<\/Summary>/)
    expect(t[0]).toMatch(/<OutlineLevel>1<\/OutlineLevel>/)
    expect(t[2]).toMatch(/<WBS>A1<\/WBS>.*<OutlineNumber>1\.2<\/OutlineNumber><OutlineLevel>2<\/OutlineLevel>.*<Summary>0<\/Summary>/)
    expect(t[4]).toMatch(/<WBS>J2<\/WBS>.*<Start>2027-03-05T17:00:00<\/Start><Finish>2027-03-05T17:00:00<\/Finish>.*<Milestone>1<\/Milestone>/)
    expect(t[1]).toMatch(/<WBS>J1<\/WBS>.*<Start>2027-03-01T08:00:00<\/Start>/)
  })
  it('executantul ca resursă, subcontractantul în câmpul text „Subcontractant”, articolul în „Articol deviz”', () => {
    expect(xml).toContain(`<FieldID>188743731</FieldID><FieldName>Text1</FieldName><Alias>Subcontractant</Alias>`)
    expect(xml).toMatch(/<Resource><UID>\d+<\/UID><ID>\d+<\/ID><Name>SubX<\/Name><Type>1<\/Type><IsNull>0<\/IsNull><Group>Subcontractant<\/Group>/)
    expect(xml).toMatch(/<Resource><UID>\d+<\/UID><ID>\d+<\/ID><Name>Gazpet<\/Name><Type>1<\/Type><IsNull>0<\/IsNull><Group>Gazpet<\/Group>/)
    const a2 = xml.split('\n').find(l => l.includes('<WBS>A2</WBS>'))
    expect(a2).toContain(`<ExtendedAttribute><FieldID>188743731</FieldID><Value>SubX</Value></ExtendedAttribute>`)
    expect(a2).toContain(`<ExtendedAttribute><FieldID>188743737</FieldID><Value>ART2</Value></ExtendedAttribute>`)
    const a1 = xml.split('\n').find(l => l.includes('<WBS>A1</WBS>'))
    expect(a1).not.toContain(`<FieldID>188743731</FieldID><Value>`) // Gazpet nu e subcontractant
    expect((xml.match(/<Assignment>/g) || []).length).toBe(2) // doar activitățile cu durată
    expect(xml).toMatch(/<Calendar><UID>101<\/UID><Name>Gazpet<\/Name><IsBaseCalendar>0<\/IsBaseCalendar><IsBaselineCalendar>0<\/IsBaselineCalendar><BaseCalendarUID>1<\/BaseCalendarUID>/)
  })
})

describe('runda r1 Jakarinos — căile de ocolire închise', () => {
  it('PRESUPUS pe un jalon blochează și el GO (orice PRESUPUS, §5.3 / §10.5)', () => {
    const r = calculeazaGrafic(cuActivitate(graficBun(), 'J2', { sursa_durata: 'PRESUPUS' }))
    expect(coduri(r, 'eroare')).toEqual(['DURATA_PRESUPUSA'])
    expect(r.poate_fi_go).toBe(false)
    // jalonul fără nicio sursă rămâne permis (n-are durată de justificat)
    expect(calculeazaGrafic(cuActivitate(graficBun(), 'J2', { sursa_durata: undefined })).probleme).toEqual([])
  })
  it('categoria „jalon” ⇔ jalon: o activitate cu durată nu scapă de echipă / articol prin categorie', () => {
    const g = { ...cuActivitate(graficBun(), 'A1', { categorie: 'jalon', tip_echipa: undefined }), parametri: { ...graficBun().parametri, echipe: {} } }
    expect(coduri(calculeazaGrafic(g), 'eroare')).toContain('CATEGORIE_JALON_NECONCORDANTA')
    expect(calculeazaGrafic(g).poate_fi_go).toBe(false)
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'J2', { categorie: 'organizare' })), 'eroare')).toEqual(['CATEGORIE_JALON_NECONCORDANTA'])
  })
  it('forme greșite ale listelor = eroare, nu „nu cere nimic”', () => {
    const fara = { ...graficBun().parametri }; delete fara.utilaje
    const g = { ...cuActivitate(graficBun(), 'A1', { utilaje: 'macara' }), parametri: fara }
    expect(coduri(calculeazaGrafic(g), 'eroare')).toEqual(['UTILAJE_INVALIDE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { utilaje: [{ numar: 1 }] })), 'eroare')).toEqual(['UTILAJE_INVALIDE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { utilaje: [{ tip: 'macara', numar: 1.5 }] })), 'eroare')).toEqual(['UTILAJE_INVALIDE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { articole_deviz: 'ART1' })), 'eroare')).toContain('ARTICOLE_INVALIDE')
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { tip_echipa: 7 })), 'eroare')).toContain('TIP_ECHIPA_INVALID')
  })
  it('legătura de punct de control cere motiv cu sursă (control:true sau capăt „verificare_receptie”)', () => {
    const cuVer = (motiv, extra = {}) => {
      const g = graficBun()
      g.activitati.push({ cod: 'V1', parinte: 'R0', denumire: 'Verificare izolație (PCC 4.9)', categorie: 'verificare_receptie', executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'document:12#p4' })
      g.legaturi = [L('J1', 'A1'), L('A1', 'A2'), { ...L('A2', 'V1'), motiv }, L('V1', 'J2')]
      return { ...g, ...extra }
    }
    const r = calculeazaGrafic(cuVer(null))
    // A2 → V1 fără motiv și V1 → J2 fără motiv
    expect(coduri(r, 'eroare')).toEqual(['LEGATURA_CONTROL_FARA_MOTIV', 'LEGATURA_CONTROL_FARA_MOTIV'])
    const g2 = cuVer('izolația se verifică după izolare — document:31#p12')
    g2.legaturi = g2.legaturi.map(l => (l.la === 'J2' ? { ...l, motiv: 'regula:receptie-dupa-verificari' } : l))
    expect(calculeazaGrafic(g2).probleme).toEqual([])
    expect(coduri(calculeazaGrafic({ ...cuVer(null), mod: 'schita' }), 'eroare')).toEqual([])
    // marcajul explicit al generatorului
    const g3 = graficBun(); g3.legaturi = [L('J1', 'A1'), { ...L('A1', 'A2'), control: true, motiv: 'fără sursă' }, L('A2', 'J2')]
    expect(coduri(calculeazaGrafic(g3), 'eroare')).toEqual(['LEGATURA_CONTROL_FARA_MOTIV'])
  })
  it('drumul critic: legătura dintre două activități critice care NU conduce nu intră; ramificațiile sunt listate', () => {
    // A → B → C (lanț critic 5 zile) + A → C direct: C.es = 4, EF_A = 2 → legătura A→C are 2 zile rezervă
    const c = cpmDin([act('A', 2), act('B', 2), act('C', 1)], [L('A', 'B'), L('B', 'C'), L('A', 'C')])
    expect(c.drumCritic.lista).toEqual(['A', 'B', 'C'])
    expect(c.drumCritic.legaturi).toEqual([{ de: 'A', la: 'B', tip: 'FS', lag: 0 }, { de: 'B', la: 'C', tip: 'FS', lag: 0 }])
    expect(c.drumCritic.ramificatii).toEqual([])
    const d = cpmDin([act('A', 2), act('B', 3), act('C', 3), jal('F')], [L('A', 'B'), L('A', 'C'), L('B', 'F'), L('C', 'F')])
    expect(d.drumCritic.ramificatii).toEqual([{ de: 'A', spre: ['B', 'C'] }])
  })
  it('rezumat care începe cu un jalon: și LS calendaristic coincide cu ES când marja e 0', () => {
    const r = calculeazaGrafic({ mod: 'schita', data_start: '2027-03-01', activitati: [
      act('A', 2, { categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), { cod: 'R', rezumat: true },
      jal('J', { parinte: 'R', executant: 'beneficiar' }), act('B', 1, { parinte: 'R', categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), jal('F', { executant: 'beneficiar' })],
      legaturi: [L('A', 'J'), L('J', 'B'), L('B', 'F')] })
    const t = tabelPERT(r).find(x => x.cod === 'R')
    expect(t).toMatchObject({ ES: '2027-03-02', LS: '2027-03-02', EF: '2027-03-03', LF: '2027-03-03', marja: 0 })
  })
  it('rădăcinile nu primesc „nu mai devreme de” (doar activitățile limitate de un decalaj negativ)', () => {
    const r = calculeazaGrafic(graficBun())
    expect(r.pozitii.find(p => p.cod === 'J1').limitat_la_start).toBe(false)
    expect(genereazaMSPDI(r)).not.toContain('<ConstraintType>4</ConstraintType>')
  })
  it('exportul unui grafic care se termină în 2099 nu iese din domeniul calendarului', () => {
    const r = calculeazaGrafic({ ...graficBun(), data_start: '2099-12-01', mod: 'schita' })
    expect(r.calculat).toBe(true)
    expect(() => genereazaMSPDI(r)).not.toThrow()
  })
  it('subcontractanții pentru export vin din rezultatul calculat (fără să mai fie retrimiși)', () => {
    const xml = genereazaMSPDI(calculeazaGrafic(graficBun()))
    expect(xml.split('\n').find(l => l.includes('<WBS>A2</WBS>'))).toContain('<ExtendedAttribute><FieldID>188743731</FieldID><Value>SubX</Value></ExtendedAttribute>')
  })
  it('ID-urile câmpurilor Text1–Text4 sunt cele din MS Project', () => {
    expect(CAMPURI_TEXT.map(c => [c.nume, c.id])).toEqual([['Text1', 188743731], ['Text2', 188743734], ['Text3', 188743737], ['Text4', 188743740]])
  })
})

describe('runda r2 Jakarinos', () => {
  it('utilaj în formă de obiect fără număr (sau cu null) = eroare, nu „1” tacit', () => {
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { utilaje: [{ tip: 'macara' }] })), 'eroare')).toEqual(['UTILAJE_INVALIDE'])
    expect(coduri(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { utilaje: [{ tip: 'macara', numar: null }] })), 'eroare')).toEqual(['UTILAJE_INVALIDE'])
    expect(calculeazaGrafic(cuActivitate(graficBun(), 'A1', { utilaje: [{ tip: 'macara', numar: 1 }] })).probleme).toEqual([])
  })
  it('legătura control:true cu motiv valid trece; citarea cu spațiu după prefix e acceptată', () => {
    const cu = (motiv) => { const g = graficBun(); g.legaturi = [L('J1', 'A1'), { ...L('A1', 'A2'), control: true, motiv }, L('A2', 'J2')]; return calculeazaGrafic(g) }
    for (const m of ['document:31#p12', 'PCC 4.9 (document: 31#p12)', 'raspuns: 17', 'regula : receptie-dupa-verificari']) expect(cu(m).probleme, m).toEqual([])
    for (const m of ['PCC 4.9', 'documentul 31', 'vezi caietul de sarcini', '']) expect(coduri(cu(m), 'eroare'), m).toEqual(['LEGATURA_CONTROL_FARA_MOTIV'])
  })
  it('rezumat cu marjă pozitivă: LS și LF calendaristice sunt cele târzii ale copiilor, nu cele timpurii', () => {
    const r = calculeazaGrafic({ mod: 'schita', data_start: '2027-03-01', activitati: [
      act('A', 6, { categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), { cod: 'R', rezumat: true },
      act('B', 2, { parinte: 'R', categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }),
      act('C', 1, { parinte: 'R', categorie: 'organizare', executant: 'Gazpet', sursa_durata: 'parametru:x' }), jal('F', { executant: 'beneficiar' })],
      legaturi: [L('A', 'F'), L('B', 'C'), L('C', 'F')] })
    // R: es 0, ef 3, ls 3, lf 6 (indexuri) → ES 01.03, EF 03.03, LS 04.03 (ls B = 3), LF 08.03 (lf C = 6 → ziua 5)
    expect(tabelPERT(r).find(x => x.cod === 'R')).toMatchObject({ ES: '2027-03-01', EF: '2027-03-03', LS: '2027-03-04', LF: '2027-03-08', marja: 3, critic: false })
  })
  it('termenul la capătul calendarului (decembrie 2099) se verifică fără eroare', () => {
    const r = calculeazaGrafic({ ...graficBun(), data_start: '2099-12-21', termen: { tip: 'data', valoare: '2099-12-31' } })
    expect(coduri(r)).not.toContain('TERMEN_INVALID')
    // 21–24.12 + 28.12 (25–26 Crăciunul, 26–27 weekend) → finalul 28.12.2099, în termen
    expect(r.termen).toMatchObject({ data_limita: '2099-12-31', data_final: '2099-12-28', incadrat: true })
    expect(() => creeazaAxa(creeazaCalendar(), '2099-12-30').zi(5)).toThrow(/dincolo de 2099-12-31/)
  })
})

describe('runda r3 Jakarinos (condiția GO)', () => {
  it('termen după 31.12.2099: eroare TERMEN_INVALID, nu rezervă trunchiată', () => {
    const g = { ...graficBun(), data_start: '2099-12-31', termen: { tip: 'data', valoare: '2100-01-05' },
      activitati: [{ cod: 'A1', denumire: 'Sudură', categorie: 'executie', articole_deviz: ['ART1'], executant: 'Gazpet', durata_zile_lucratoare: 1, sursa_durata: 'norma:SUD-01', tip_echipa: 'sudori' },
        { cod: 'A2', denumire: 'Izolare', categorie: 'executie', articole_deviz: ['ART2'], executant: 'SubX', durata_zile_lucratoare: 0, sursa_durata: 'raspuns:17', tip_echipa: 'izolatori' }],
      legaturi: [] }
    expect(() => dataLimita({ tip: 'data', valoare: '2100-01-05' }, '2099-12-31', creeazaAxa(creeazaCalendar(), '2099-12-31'))).not.toThrow() // data în sine e validă
    const r = calculeazaGrafic(g)
    expect(r.probleme.find(p => p.cod === 'TERMEN_INVALID')?.mesaj).toMatch(/dincolo de capătul calendarului/)
    expect(r.poate_fi_go).toBe(false)
    expect(r.termen).toBe(null)
    // termenul chiar pe 31.12.2099 rămâne calculabil
    expect(coduri(calculeazaGrafic({ ...g, termen: { tip: 'data', valoare: '2099-12-31' } }))).not.toContain('TERMEN_INVALID')
  })
})
