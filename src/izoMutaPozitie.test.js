// TKT-2026-0388 — planul de mutare (același algoritm ca fn_executie_tevi_muta_pozitie, 20261215c) + compatibilitatea fără migrare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { planMutare, aplicaSchimburi, ordineDinRanduri, lipsaRpcMutare, stareMutareDinSonda, mesajEroareMutare } from './izoMutaPozitie.js'

// mutarea „de mână”: scoate piesa și o pune pe poziția cerută (sursă independentă de plan, L25)
const asteptat = (ids, id, poz) => { const l = ids.filter(x => x !== id); l.splice(poz - 1, 0, id); return l }

describe('planMutare', () => {
  const ids = [11, 12, 13, 14, 15]
  // aceleași cazuri ca scenariul SQL / testul local al migrării
  const CAZURI = [[15, 1], [11, 5], [13, 3], [12, 4], [14, 2], [11, 1], [15, 5]]
  for (const [id, poz] of CAZURI) {
    it(`mută ${id} la ${poz}`, () => {
      const p = planMutare(ids, id, poz)
      expect(p.ok).toBe(true)
      expect(p.ordine).toEqual(asteptat(ids, id, poz))
      expect(p.schimburi.length).toBe(Math.abs(ids.indexOf(id) + 1 - poz))
      // schimburile, aplicate pe rând (cum le face serverul prin ↑ / ↓), dau exact ordinea promisă
      expect(aplicaSchimburi(ids, p.schimburi)).toEqual(p.ordine)
      // fiecare schimb e între piesă și un vecin ALĂTURAT în ordinea de la acel pas (exact ce face butonul ↑ / ↓)
      let l = ids.slice()
      for (const [a, b] of p.schimburi) { expect(Math.abs(l.indexOf(a) - l.indexOf(b))).toBe(1); l = aplicaSchimburi(l, [[a, b]]) }
    })
  }
  it('la început: ultima piesă dintr-un pachet de 1 / 2 rânduri', () => {
    expect(planMutare([7], 7, 1)).toMatchObject({ ok: true, schimburi: [], ordine: [7] })
    expect(planMutare([7, 8], 8, 1)).toMatchObject({ ok: true, schimburi: [[8, 7]], ordine: [8, 7] })
  })
  it('refuzuri: poziție în afara 1..n, rând lipsă, duplicate, poziție nenumerică', () => {
    expect(planMutare(ids, 11, 0).ok).toBe(false)
    expect(planMutare(ids, 11, 6)).toMatchObject({ ok: false, motiv: 'poziția trebuie să fie între 1 și 5' })
    expect(planMutare(ids, 99, 1)).toMatchObject({ ok: false, motiv: 'rândul nu e în pachet' })
    expect(planMutare([1, 2, 2], 1, 1).ok).toBe(false)
    expect(planMutare(ids, 11, 1.5).ok).toBe(false)
    expect(planMutare(ids, 11, '1').ok).toBe(false)
    expect(planMutare(null, 11, 1).ok).toBe(false)
  })
  it('ordinea din ecran = ordinea serverului (poz_in_pachet, apoi id)', () => {
    expect(ordineDinRanduri([{ id: 3, poz_in_pachet: 2 }, { id: 1, poz_in_pachet: 2 }, { id: 2, poz_in_pachet: 1 }])).toEqual([2, 1, 3])
  })
})

describe('compatibilitate cu migrarea 20261215c', () => {
  const lipsa = { code: 'PGRST202', message: 'Could not find the function public.fn_executie_tevi_muta_pozitie(p_id, p_poz_noua) in the schema cache' }
  it('sonda: da / nu / eroare (eroare ≠ lipsă, L18)', () => {
    expect(stareMutareDinSonda({ data: { disponibil: true }, error: null })).toBe('da')
    expect(stareMutareDinSonda({ data: null, error: lipsa })).toBe('nu')
    expect(stareMutareDinSonda({ data: null, error: { code: '42883', message: 'function public.fn_executie_tevi_muta_pozitie(bigint, integer) does not exist' } })).toBe('nu')
    expect(stareMutareDinSonda({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.alta' } })).toBe('eroare')
    expect(stareMutareDinSonda({ data: null, error: { code: '', message: 'Failed to fetch' } })).toBe('eroare')
    expect(stareMutareDinSonda({ data: {}, error: null })).toBe('eroare')
    expect(lipsaRpcMutare(null)).toBe(false)
  })
  it('mesaje pentru om (fără id-uri)', () => {
    expect(mesajEroareMutare(lipsa)).toMatch(/după actualizarea bazei de date/)
    expect(mesajEroareMutare({ code: '42501', message: 'Execuție: nu ai drept de scriere pe acest proiect' })).toBe('Nu ai drept de scriere pe acest proiect.')
    expect(mesajEroareMutare({ code: '42501', message: 'E4a flux: scriere client refuzata pe executie_tevi' })).toMatch(/fluxul de montaj/)
    expect(mesajEroareMutare({ code: '40P01', message: 'deadlock detected' })).toMatch(/Nu s-a schimbat nimic/)
    expect(mesajEroareMutare({ code: '40001', message: 'x' })).toMatch(/Nu s-a schimbat nimic/)
    expect(mesajEroareMutare({ code: '55P03', message: 'Execuție: pachetul e modificat chiar acum de altcineva (reîncearcă)' })).toMatch(/chiar acum.*Nu s-a schimbat nimic/)
  })
  it('migrarea: același algoritm (vecinul de la fiecare pas din ordinea citită sub lock), INVOKER, după 20261209a', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261215c_izometrie_muta_pozitie.sql', import.meta.url), 'utf8').replace(/\r/g, '')
    expect(sql).toMatch(/FOR k IN REVERSE v_i - 1 \.\. p_poz_noua LOOP\n\s+PERFORM public\.fn_executie_swap_tevi_pozitie\(p_id, v_ids\[k\]\);/)
    expect(sql).toMatch(/FOR k IN v_i \+ 1 \.\. p_poz_noua LOOP\n\s+PERFORM public\.fn_executie_swap_tevi_pozitie\(p_id, v_ids\[k\]\);/)
    expect(sql).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp/)
    expect(sql).toMatch(/aplica intai 20261209a/)
  })
  it('r2: protocolul de lock — pachetul (consultativ, fără așteptare), apoi toate rândurile ORDER BY id NOWAIT, ÎNAINTEA citirii ordinii', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261215c_izometrie_muta_pozitie.sql', import.meta.url), 'utf8').replace(/\r/g, '')
    const corp = sql.slice(sql.indexOf('CREATE FUNCTION public.fn_executie_tevi_muta_pozitie('), sql.indexOf('END $f$;'))
    const iConsultativ = corp.indexOf("IF NOT pg_try_advisory_xact_lock(hashtextextended('executie_tevi_ordine_pachet:' || v_pachet::text, 0)) THEN")
    const iRanduri = corp.indexOf('WHERE t.pachet_id = v_pachet ORDER BY t.id FOR UPDATE NOWAIT) b;')
    const iOrdine = corp.indexOf('SELECT array_agg(t.id::bigint ORDER BY t.poz_in_pachet, t.id) INTO v_ids')
    const iSchimb = corp.indexOf('PERFORM public.fn_executie_swap_tevi_pozitie(')
    expect(iConsultativ).toBeGreaterThan(0)
    expect(iRanduri).toBeGreaterThan(iConsultativ)
    expect(iOrdine).toBeGreaterThan(iRanduri)
    expect(iSchimb).toBeGreaterThan(iOrdine)
    // nicio așteptare în protocol: niciun FOR UPDATE fără NOWAIT, niciun lock consultativ care așteaptă
    expect(corp.match(/FOR UPDATE(?! NOWAIT)/g)).toBeNull()
    expect(corp).not.toMatch(/pg_advisory_xact_lock\(/)
    // ocupat = 55P03, cu mesajul pentru om
    expect(corp.match(/USING ERRCODE = '55P03'/g)).toHaveLength(2)
    expect(corp).toMatch(/EXCEPTION WHEN lock_not_available THEN/)
  })
  it('r2: amprenta corpului (md5 fără CR) e aceeași în postcondiția migrării și în revenire', async () => {
    const { createHash } = await import('node:crypto')
    const sql = readFileSync(new URL('../supabase/migrations/20261215c_izometrie_muta_pozitie.sql', import.meta.url), 'utf8').replace(/\r/g, '')
    const rev = readFileSync(new URL('../supabase/revenire/20261215c_izometrie_muta_pozitie_ROLLBACK.sql', import.meta.url), 'utf8').replace(/\r/g, '')
    const cap = sql.indexOf('CREATE FUNCTION public.fn_executie_tevi_muta_pozitie(')
    const st = sql.indexOf('AS $f$', cap) + 'AS $f$'.length
    const h = createHash('md5').update(sql.slice(st, sql.indexOf('$f$', st)), 'utf8').digest('hex')
    expect(sql).toContain(`md5(replace(p.prosrc, chr(13), '')) = '${h}'`)
    expect(rev).toContain(`md5(replace(p.prosrc, chr(13), '')) = '${h}'`)
  })
})
