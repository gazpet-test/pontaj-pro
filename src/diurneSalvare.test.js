// Salvarea ATOMICĂ a plăților de diurnă (PR #547): payload cu defalcare pe luni, argumentele RPC-ului,
// BT din plata SALVATĂ (nu recalcul), orchestrarea salveazaPlataDiurne peste un rpc mock (idempotență, P0002).
// Fără BD: testul serverului e supabase/tests/diurna_salveaza_plata.test.sql (psql local, BEGIN … ROLLBACK).
import { describe, it, expect, vi } from 'vitest'
import { alocaDinSnapshot, amprentaSnapshot } from './diurneAlocare.js'
import { construiestePayloadPlata, construiesteApelRpc, construiesteRanduriBT, salveazaPlataDiurne, VERSIUNE_FORMULA_DIURNE, HDR_BT } from './diurneFlux.js'

const AMPRENTA = 'a'.repeat(64)
const KEY = '11111111-1111-4111-8111-111111111111'
// Snapshot minimal: tranșa 26.09–02.10.2026 (două luni), tarif 50, fără zile legale.
// e1: bife 28.09, 29.09, 30.09 (sept) + 01.10 (oct); e2: nicio bifă; e3: bifă 01.10
const rec = (id, employee_id, date, diurna = true, norma = null) => ({ id, employee_id, date, diurna, norma })
const snap = {
  df: '2026-09-26', dt: '2026-10-02', monthStart: '2026-09-01', monthEnd: '2026-10-31', monthStartTransa: '2026-09-01',
  diurnaAmt: 50, ibanFirma: 'RO00FIRMA', legalSet: new Set(), calData: [],
  emps: [{ id: 1, name: 'POP ION', iban: 'RO49BTRL000' }, { id: 2, name: 'FARA BIFE', iban: 'RO49INGB000' }, { id: 3, name: 'IONESCU ANA', iban: null }],
  recs: [rec(1, 1, '2026-09-28'), rec(2, 1, '2026-09-29'), rec(3, 1, '2026-09-30'), rec(4, 1, '2026-10-01'), rec(5, 2, '2026-09-28', false, 'CO'), rec(6, 3, '2026-10-01')],
}
const alocare = alocaDinSnapshot(snap)

describe('construiestePayloadPlata — defalcare_luni consistentă cu alocarea', () => {
  it('fiecare detaliu poartă zile_diurna/zile_salariu/suma_salariu și defalcarea pe luni din segmente', () => {
    const { plata, detalii } = construiestePayloadPlata({ snap, alocare, paymentDate: '2026-10-05', createdBy: 'u' })
    expect(detalii.map(d => d.employee_id)).toEqual([1, 3])          // e2 (fără bife) nu apare
    const d1 = detalii[0], a1 = alocare.get(1)
    expect(d1).toMatchObject({ days: a1.zileDiurna, amount: a1.sumaDiurna, zile_diurna: a1.zileDiurna, zile_salariu: a1.zileSalariu, suma_salariu: a1.sumaSalariu })
    expect(d1.defalcare_luni).toEqual([
      { luna: '2026-09', zile_diurna: 3, suma_diurna: 150, zile_salariu: 0, suma_salariu: 0 },
      { luna: '2026-10', zile_diurna: 1, suma_diurna: 50, zile_salariu: 0, suma_salariu: 0 },
    ])
    for (const d of detalii) {
      const a = alocare.get(d.employee_id)
      expect(d.defalcare_luni.map(l => l.luna)).toEqual(a.segmente.map(s => s.luna))
      expect(d.defalcare_luni.reduce((s, l) => s + l.zile_diurna, 0)).toBe(d.zile_diurna)
      expect(d.defalcare_luni.reduce((s, l) => s + l.suma_diurna, 0)).toBe(d.amount)
      expect(d.defalcare_luni.reduce((s, l) => s + l.zile_salariu, 0)).toBe(d.zile_salariu)
      expect(d.defalcare_luni.reduce((s, l) => s + l.suma_salariu, 0)).toBe(d.suma_salariu)
      expect(d.zile_diurna + d.zile_salariu).toBe(a.N)
    }
    expect(plata).toMatchObject({ period_from: '2026-09-26', period_to: '2026-10-02', total_employees: 2, total_days: 5, total_amount: 250 })
  })
  it('surplusul peste plafon intră în zile_salariu/suma_salariu și în defalcare, nu în amount', () => {
    // luna cu o singură zi lucrătoare fără CO: plafon C=1 → din 3 bife, 1 diurnă + 2 salariu
    const legal = new Set(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29'])
    const s2 = { ...snap, dt: '2026-09-30', monthEnd: '2026-09-30', legalSet: legal, emps: [snap.emps[0]], recs: snap.recs.filter(r => r.employee_id === 1 && r.date <= '2026-09-30') }
    const a2 = alocaDinSnapshot(s2)
    const { detalii } = construiestePayloadPlata({ snap: s2, alocare: a2, paymentDate: 'x' })
    expect(detalii[0]).toMatchObject({ days: 1, amount: 50, zile_salariu: 2, suma_salariu: 100 })
    expect(detalii[0].defalcare_luni).toEqual([{ luna: '2026-09', zile_diurna: 1, suma_diurna: 50, zile_salariu: 2, suma_salariu: 100 }])
  })
})

describe('construiesteApelRpc — argumentele exacte ale supabase.rpc(\'diurna_salveaza_plata\')', () => {
  it('forma argumentelor: perioadă, detalii, cheie, amprentă, scop (angajați + luni), tarif ca TEXT, baza_calcul', () => {
    const args = construiesteApelRpc({ snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA, notes: 'n' })
    expect(Object.keys(args).sort()).toEqual(['p_amprenta', 'p_baza_calcul', 'p_detalii', 'p_employee_ids', 'p_idempotency_key', 'p_month_end', 'p_month_start', 'p_notes', 'p_period_from', 'p_period_to', 'p_tarif_text'])
    expect(args).toMatchObject({ p_period_from: '2026-09-26', p_period_to: '2026-10-02', p_notes: 'n', p_idempotency_key: KEY, p_amprenta: AMPRENTA, p_employee_ids: [1, 2, 3], p_month_start: '2026-09-01', p_month_end: '2026-10-31', p_tarif_text: '50' })
    expect(typeof args.p_tarif_text).toBe('string')
    expect(args.p_detalii).toEqual(construiestePayloadPlata({ snap, alocare, paymentDate: null }).detalii)
    expect(args.p_baza_calcul).toEqual({ amprenta: AMPRENTA, tarif: '50', month_start: '2026-09-01', month_end: '2026-10-31', employee_ids_count: 3, versiune_formula: VERSIUNE_FORMULA_DIURNE })
  })
  it('fără cheie sau cu amprentă invalidă → throw (nu se apelează serverul pe ghicite)', () => {
    expect(() => construiesteApelRpc({ snap, alocare, idempotencyKey: null, amprenta: AMPRENTA })).toThrow(/idempotență/)
    expect(() => construiesteApelRpc({ snap, alocare, idempotencyKey: KEY, amprenta: 'abc' })).toThrow(/Amprenta/)
    expect(() => construiesteApelRpc({ snap, alocare, idempotencyKey: KEY, amprenta: undefined })).toThrow(/Amprenta/)
  })
})

describe('construiesteRanduriBT — din plata SALVATĂ (rânduri citite din BD), nu din recalcul', () => {
  const plata = { id: 9, period_from: '2026-09-26', period_to: '2026-10-02' }
  const detalii = [
    { payment_id: 9, employee_id: 1, employee_name: 'POP ION', days: 4, amount: 200 },
    { payment_id: 9, employee_id: 2, employee_name: 'FARA BIFE', days: 0, amount: 0 },      // tot la salariu → nu apare
    { payment_id: 9, employee_id: 3, employee_name: 'IONESCU ANA', days: 1, amount: 37.5 },
  ]
  const emps = snap.emps
  it('sumele = amount-ul salvat (chiar dacă recalculul de azi ar da altceva); amount 0 exclus; IBAN lipsă listat', () => {
    const bt = construiesteRanduriBT({ plata, detalii, emps, ibanFirma: 'RO00FIRMA', dataValuta: '05/10/2026' })
    expect(bt.rows.length).toBe(2)
    expect(bt.rows.map(r => r[6])).toEqual([200, 37.5])
    expect(bt.total).toBe(237.5)
    expect(bt.rows[0]).toEqual([1, 'RO00FIRMA', 'RO49BTRL000', 'POP ION', 'BTRLRO22XXX', '', 200, 'diurna', 'diurna', '05/10/2026', 'F'])
    expect(bt.rows[1][2]).toBe(''); expect(bt.faraIBAN).toEqual(['IONESCU ANA'])
    expect(bt.rows[0].length).toBe(HDR_BT.length)
    // alocarea de azi pentru e1 dă 200 și pentru e3 50 — BT NU folosește alocarea, ci detaliul salvat (37.5)
    expect(alocare.get(3).sumaDiurna).toBe(50)
  })
  it('IBAN firmă lipsă → throw, fără fallback; detalii lipsă / sumă nenumerică / nicio sumă > 0 → throw', () => {
    expect(() => construiesteRanduriBT({ plata, detalii, emps, ibanFirma: null, dataValuta: 'x' })).toThrow(/IBAN-ul firmei/)
    expect(() => construiesteRanduriBT({ plata, detalii, emps, ibanFirma: '  ', dataValuta: 'x' })).toThrow(/IBAN-ul firmei/)
    expect(() => construiesteRanduriBT({ plata, detalii: null, emps, ibanFirma: 'X', dataValuta: 'x' })).toThrow(/detaliile lipsă/)
    expect(() => construiesteRanduriBT({ plata, detalii: [{ employee_id: 1, amount: 'abc' }], emps, ibanFirma: 'X', dataValuta: 'x' })).toThrow(/nenumerică/)
    expect(() => construiesteRanduriBT({ plata, detalii: [detalii[1]], emps, ibanFirma: 'X', dataValuta: 'x' })).toThrow(/Nu există diurne confirmate/)
  })
})

describe('salveazaPlataDiurne — orchestrarea handler-ului peste supabase.rpc (mock)', () => {
  const rpcMock = () => {
    const saved = new Map()
    const rpc = vi.fn(async (fn, args) => {
      expect(fn).toBe('diurna_salveaza_plata')
      if (args.p_amprenta !== AMPRENTA) return { data: null, error: { code: 'P0002', message: 'diurna: datele s-au schimbat de la previzualizare (pontaj/CO/tarif/calendar) — reîncarcă și confirmă din nou' } }
      if (saved.has(args.p_idempotency_key)) return { data: { payment_id: saved.get(args.p_idempotency_key), inserted: false }, error: null }
      const id = 100 + saved.size; saved.set(args.p_idempotency_key, id)
      return { data: { payment_id: id, inserted: true, total_employees: args.p_detalii.length, total_days: 5, total_amount: 250 }, error: null }
    })
    return { rpc, saved }
  }
  it('succes: un singur apel rpc, argumentele din construiesteApelRpc (+ data plății), întoarce {payment_id, inserted:true}', async () => {
    const { rpc } = rpcMock()
    const r = await salveazaPlataDiurne({ supabase: { rpc }, snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA, paymentDate: '2026-10-05' })
    expect(r).toMatchObject({ payment_id: 100, inserted: true, total_employees: 2 })
    expect(rpc).toHaveBeenCalledTimes(1)
    const [, args] = rpc.mock.calls[0]
    expect(args).toMatchObject({ ...construiesteApelRpc({ snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA }), p_payment_date: '2026-10-05' })
  })
  it('retry cu aceeași cheie → inserted:false, același payment_id, nicio a doua plată', async () => {
    const { rpc, saved } = rpcMock()
    const r1 = await salveazaPlataDiurne({ supabase: { rpc }, snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA })
    const r2 = await salveazaPlataDiurne({ supabase: { rpc }, snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA })
    expect(r1).toMatchObject({ payment_id: 100, inserted: true }); expect(r2).toEqual(expect.objectContaining({ payment_id: 100, inserted: false }))
    expect(saved.size).toBe(1); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('P0002 (datele s-au schimbat) → eroarea se propagă cu codul ei, fără al doilea apel, fără insert-uri separate', async () => {
    const { rpc, saved } = rpcMock()
    const from = vi.fn()
    await expect(salveazaPlataDiurne({ supabase: { rpc, from }, snap, alocare, idempotencyKey: KEY, amprenta: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'P0002', message: expect.stringMatching(/datele s-au schimbat/) })
    expect(rpc).toHaveBeenCalledTimes(1); expect(saved.size).toBe(0); expect(from).not.toHaveBeenCalled()
  })
  it('argumente invalide (fără cheie) → nu se apelează rpc deloc; răspuns fără payment_id → throw', async () => {
    const { rpc } = rpcMock()
    await expect(salveazaPlataDiurne({ supabase: { rpc }, snap, alocare, idempotencyKey: null, amprenta: AMPRENTA })).rejects.toThrow(/idempotență/)
    expect(rpc).not.toHaveBeenCalled()
    const rpcGol = vi.fn(async () => ({ data: null, error: null }))
    await expect(salveazaPlataDiurne({ supabase: { rpc: rpcGol }, snap, alocare, idempotencyKey: KEY, amprenta: AMPRENTA })).rejects.toThrow(/id-ul plății/)
  })
})

describe('amprenta canonică — clientul (amprentaSnapshot) produce exact forma pe care o recalculează serverul (diurna_amprenta_canonica)', () => {
  it('linii employee_id|YYYY-MM-DD|1/0|norma ordonate (employee_id, date, id), apoi #tarif (text), #legal (asc), #emps (numeric asc)', () => {
    const s = { ...snap, legalSet: new Set(['2026-10-05', '2026-09-30']), emps: [{ id: 10 }, { id: 2 }, { id: 1 }], recs: [rec(4, 1, '2026-10-01'), rec(1, 1, '2026-09-28'), rec(6, 3, '2026-10-01'), rec(5, 2, '2026-09-28', false, 'CO'), rec(7, 3, '2026-10-01')] }
    expect(amprentaSnapshot(s)).toBe(
      '1|2026-09-28|1|\n1|2026-10-01|1|\n2|2026-09-28|0|CO\n3|2026-10-01|1|\n3|2026-10-01|1|' +
      '\n#tarif=50\n#legal=2026-09-30,2026-10-05\n#emps=1,2,10')
    // fără rânduri: prima parte e '' (serverul: COALESCE(string_agg(...), ''))
    expect(amprentaSnapshot({ ...s, recs: [], legalSet: new Set(), emps: [] })).toBe('\n#tarif=50\n#legal=\n#emps=')
    // argumentele RPC transmit tariful ca text identic cu ce intră în amprentă
    const args = construiesteApelRpc({ snap: s, alocare: alocaDinSnapshot(s), idempotencyKey: KEY, amprenta: AMPRENTA })
    expect(args.p_tarif_text).toBe(String(s.diurnaAmt)); expect(args.p_employee_ids).toEqual([10, 2, 1])
  })
})
