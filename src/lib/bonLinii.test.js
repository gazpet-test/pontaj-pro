import { describe, it, expect } from 'vitest'
import { liniiPentruRpc, antetPentruRpc, mesajEroareBon } from './bonLinii.js'

// Comportamentul tranzacțional (CAS, retry fără dubluri, salvări concurente, registru atomic) e testat în SQL:
// supabase/tests/bon_salveaza.test.sql + scripts/test_izometrie_e2a.sh pas 4i. Aici doar argumentele și mesajele.
const toNum = v => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
const tipuri = { 3: { nume: 'Curbă', um_implicit: 'buc' } }

describe('argumentele pentru fn_bon_salveaza', () => {
  it('liniile: denumirea din tip dacă lipsește, cost doar pe gazpet, fără bon_id / valoare', () => {
    const l = [{ tip_material_id: 3, denumire: ' ', cantitate: '2', cost_unitar: '10', serie: ' S1 ' }]
    expect(liniiPentruRpc(l, 'gazpet', tipuri, toNum)[0]).toEqual({ magazie_bucata_id: null, tip_material_id: 3, denumire: 'Curbă', serie: 'S1',
      sarja: null, dimensiune: null, cantitate: 2, um: 'buc', lungime_m: null, cost_unitar: 10 })
    expect(liniiPentruRpc(l, 'beneficiar', tipuri, toNum)[0].cost_unitar).toBe(null)
  })
  it('antetul: cheia operației (fără număr — îl alocă serverul), observații goale → null', () => {
    expect(antetPentruRpc({ proiect_id: '3', cheie_operatie: 'k-1', situatie_plata_id: '', provenienta: 'gazpet', data_bon: '2026-10-21', observatii: '  ' }))
      .toEqual({ proiect_id: 3, cheie_operatie: 'k-1', situatie_plata_id: null, provenienta: 'gazpet', data_bon: '2026-10-21', observatii: null })
  })
  it('mesajele de eroare', () => {
    expect(mesajEroareBon({ code: 'PGRST202', message: 'Could not find the function' })).toMatch(/nu e încă instalată/)
    expect(mesajEroareBon({ code: '40001', message: 'bon: bonul 7 a fost modificat între timp' })).toMatch(/modificat de altcineva/)
    expect(mesajEroareBon({ code: '42501', message: 'izo: bucata 9 … nu intră pe bon de consum' })).toMatch(/registru/)
    expect(mesajEroareBon({ message: 'altceva' })).toBe('altceva')
  })
})

describe('mesajEroareBon r11', () => {
  it('bonul preluat / anulat între timp → mesaj clar', () => {
    expect(mesajEroareBon({ code: '55000', message: 'bon: bonul BC-2026-1-0001 e „preluat” — se editează doar bonurile generate' })).toMatch(/nu mai e „generat”/)
    expect(mesajEroareBon({ code: 'P0001', message: 'bon: bonul 5 e „anulat” — se preiau doar bonurile generate' })).toMatch(/nu mai e „generat”/)
  })
})
