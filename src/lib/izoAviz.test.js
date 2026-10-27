import { describe, it, expect } from 'vitest'
import { filtreazaBucati, totaluri, cerereIesireAviz, caleAviz, htmlAviz, normNrAuto } from './izoAviz.js'

const b = (id, o = {}) => ({ id, serie: `247EK0860${id}`, sarja: `S${id}`, diametru_mm: 711, perete_mm: 8.8, lungime_mm: 12000, greutate_kg: 1850.5, ...o })
const lista = [b(1), b(2, { perete_mm: 7.1, sarja: 'A77' }), b(3, { diametru_mm: 610, greutate_kg: null, lungime_mm: 6500 })]
const id = () => '00000000-0000-4000-8000-000000000001'
const baza = { depozit: '9', tronson: '17', bucati: [1, 2], data: '2026-10-28', sofer: { employeeId: '45', confirmat: true }, vehicul: { id: '12' } }

describe('căutare și totaluri', () => {
  it('filtrează pe serie, șarjă, DN și perete; fără diacritice / majuscule', () => {
    expect(filtreazaBucati(lista, '08602').map(x => x.id)).toEqual([2])
    expect(filtreazaBucati(lista, 'a77').map(x => x.id)).toEqual([2])
    expect(filtreazaBucati(lista, 'DN 610').map(x => x.id)).toEqual([3])
    expect(filtreazaBucati(lista, '7,1').map(x => x.id)).toEqual([2])
    expect(filtreazaBucati(lista, '247ek 8.8').map(x => x.id)).toEqual([1, 3])
    expect(filtreazaBucati(lista, '  ')).toHaveLength(3)
  })
  it('totaluri pe selecție, inclusiv bucăți fără masă', () => {
    expect(totaluri(lista, [1, 3])).toEqual({ n: 2, m: 18.5, kg: 1850.5, kgLipsa: 1 })
    expect(totaluri(lista, [])).toMatchObject({ n: 0, m: 0, kg: 0 })
  })
})

describe('cererea fn_izo_iesire_cu_aviz', () => {
  it('șofer angajat + mașină din flotă + destinatar intern', () => {
    expect(cerereIesireAviz(baza, id)).toEqual({ nume: 'fn_izo_iesire_cu_aviz', args: {
      p_cheie: id(), p_depozit: 9, p_tronson: 17, p_bucati: [1, 2], p_data: '2026-10-28', p_sofer_employee: 45, p_sofer_extern: null,
      p_sofer_confirmat: true, p_vehicul: 12, p_nr_auto: null, p_destinatar: { tip: 'intern' } } })
  })
  it('șofer extern: nume, fără confirmare; număr auto tastat normalizat; destinatar extern complet', () => {
    const r = cerereIesireAviz({ ...baza, sofer: { extern: '  Ion Pop ', confirmat: true }, vehicul: { nrAuto: ' ph  12  abc ' },
      destinatar: { tip: 'extern', denumire: 'Firma SRL', cui: 'RO123', adresa: 'Str. X 1, Ploiești' } }, id).args
    expect(r).toMatchObject({ p_sofer_employee: null, p_sofer_extern: 'Ion Pop', p_sofer_confirmat: false, p_vehicul: null, p_nr_auto: 'PH 12 ABC',
      p_destinatar: { tip: 'extern', denumire: 'Firma SRL', cui: 'RO123', adresa: 'Str. X 1, Ploiești' } })
  })
  it('refuzuri locale', () => {
    expect(() => cerereIesireAviz({ ...baza, tronson: '' }, id)).toThrow(/tronsonul/)
    expect(() => cerereIesireAviz({ ...baza, bucati: [] }, id)).toThrow(/1 și 200/)
    expect(() => cerereIesireAviz({ ...baza, bucati: [1, 1] }, id)).toThrow(/distincte/)
    expect(() => cerereIesireAviz({ ...baza, bucati: Array.from({ length: 201 }, (_, i) => i + 1) }, id)).toThrow(/200/)
    expect(() => cerereIesireAviz({ ...baza, sofer: {} }, id)).toThrow(/șoferul/)
    expect(() => cerereIesireAviz({ ...baza, sofer: { extern: 'Io' } }, id)).toThrow(/extern/)
    expect(() => cerereIesireAviz({ ...baza, vehicul: { nrAuto: 'B' } }, id)).toThrow(/înmatriculare/)
    expect(() => cerereIesireAviz({ ...baza, destinatar: { tip: 'extern', denumire: 'X SRL' } }, id)).toThrow(/Destinatar extern/)
    expect(() => cerereIesireAviz({ ...baza, data: '' }, id)).toThrow(/data/)
  })
  it('normNrAuto', () => expect(normNrAuto(' b 101  xyz')).toBe('B 101 XYZ'))
})

describe('PDF-ul avizului din instantaneu', () => {
  const aviz = { id: 5, proiect_id: 3, serie: 'CJPJ', numar: 47, nr_complet: 'CJPJ 0047', data_aviz: '2026-10-28', stare: 'emis', nr_auto: 'PH 12 ABC',
    motiv: 'Transfer intern — materiale puse la dispoziție de beneficiar', total_bucati: 1, total_m: 12, total_kg: 1850.5, destinatar_tip: 'intern',
    // forma exactă scrisă de fn_izo_iesire_cu_aviz (harness 27.10)
    antet: { firma: { firma_nume: 'GAZPET INSTAL SRL', firma_cui: 'RO 22029920', firma_reg_com: 'J29/0001650/2007', firma_adresa: 'Ploiești' }, proiect: { nume: 'Lot 2 <Topleț>' },
      depozit: { id: 9, name: 'DM Jupânești' }, tronson: { cod: 'T17', km_start_m: 81600, km_end_m: 84250 }, sofer_nume: 'POPESCU ION', emitent_nume: 'CIOC JANETA' },
    continut: [{ bucata_id: 1, tip_cod: 'teava', serie: '247EK08601', sarja: 'S1', diametru_mm: 711, perete_mm: 8.8, lungime_mm: 12000, greutate_kg: 1850.5 },
      { bucata_id: 2, tip_cod: 'curba', serie: '362', sarja: '2520914', diametru_mm: 610, perete_mm: 8, unghi_curba: 20, lungime_mm: null, greutate_kg: 321.5 }] }
  it('conține câmpurile obligatorii, escapează textul și marchează rubricile olografe', () => {
    const h = htmlAviz(aviz)
    for (const s of ['AVIZ DE ÎNSOȚIRE A MĂRFII', 'CJPJ', '0047', '28.10.2026', 'GAZPET INSTAL SRL', 'RO 22029920', 'J29/0001650/2007', 'DM Jupânești', 'T17 · km 81+600–84+250',
      '247EK08601', 'Curbă DN 610 × 8,0 mm · 20°', 'PH 12 ABC', 'POPESCU ION', 'CIOC JANETA', 'Primitor', 'Transfer intern'])
      expect(h).toContain(s)
    expect(h).toContain('Lot 2 &lt;Topleț&gt;')
    expect(h).not.toContain('<Topleț>')
    expect(h.match(/se semnează olograf/g)).toHaveLength(2)
    expect(htmlAviz(aviz, { semnGestionar: 'data:image/png;base64,AAA' }).match(/se semnează olograf/g)).toHaveLength(1)
  })
  it('avizul anulat are banda ANULAT cu motivul; destinatarul extern apare în locul firmei', () => {
    expect(htmlAviz({ ...aviz, stare: 'anulat', anulat_motiv: 'greșit tronsonul' })).toMatch(/ANULAT · greșit tronsonul/)
    expect(htmlAviz({ ...aviz, destinatar_tip: 'extern', destinatar_denumire: 'Sub SRL', destinatar_cui: 'RO9', destinatar_adresa: 'Buzău' })).toMatch(/Destinatar:<\/b> Sub SRL/)
  })
  it('calea PDF e deterministă', () => expect(caleAviz(aviz)).toBe('3/CJPJ-47.pdf'))
})
