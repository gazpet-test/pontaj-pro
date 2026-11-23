// TKT-0353 r5: verificări STATICE (rulează în CI, fără bază) pe migrarea 20261231a și legătura ei cu ecranul.
// Proba pe PostgreSQL (PGlite: aplicare ca runnerul, comportament ca authenticated, mutanți, revenire → reaplicare) e
// scripts/pglite/test_magazie_intrare_referinta_local.mjs; concurența cu două sesiuni: supabase/tests/20261231a_magazie_intrare_referinta_concurenta.sh.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const citeste = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r/g, '')
const MIG = citeste('supabase/migrations/20261231a_magazie_intrare_referinta.sql')
const REV = citeste('supabase/revenire/20261231a_magazie_intrare_referinta_ROLLBACK.sql')
const LOGICA = citeste('src/magazieIntrareStoc.js')
const OBIECTE = citeste('supabase/tests/20261231a_magazie_intrare_referinta.l15.obiecte.tsv')
const bloc = t => { const i = t.indexOf('AMPRENTA_20261231a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20261231a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constante = t => [...t.matchAll(/IS DISTINCT FROM '([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20261231a_TEXT/g)].map(x => x[1])

describe('20261231a: migrarea, revenirea și ecranul spun același lucru', () => {
  it('antetul: NEAPLICAT, versiunea, plafonul 5000 + amprenta globală; revenirea cu plafonul 2000', () => {
    expect(MIG.startsWith('-- Version 20261231120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala')).toBe(true)
    expect(MIG).toContain("IF v_plafon IS DISTINCT FROM '5000/session'")
    expect(REV.startsWith('-- Revenire 20261231a_magazie_intrare_referinta. NEAPLICAT.')).toBe(true)
    expect(REV).toContain("IF v_plafon IS DISTINCT FROM '2000/session'")
  })
  it('blocul AMPRENTA identic în migrare și revenire, cu aceeași constantă (o dată în fiecare)', () => {
    expect(bloc(MIG)).toBeTruthy()
    expect(bloc(REV)).toBe(bloc(MIG))
    const [a, b] = [constante(MIG), constante(REV)]
    expect(a).toHaveLength(1)
    expect(b).toEqual(a)
  })
  it('unicitatea: UNIQUE simplu (neparțial, NULLS DISTINCT) pe coloana pe care ecranul o numește în ON CONFLICT', () => {
    expect(MIG).toContain('ALTER TABLE public.magazie_echipamente ADD COLUMN referinta_intentie uuid;')
    expect(MIG).toContain('ALTER TABLE public.magazie_echipamente ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);')
    expect(MIG).not.toMatch(/NULLS NOT DISTINCT \(/)
    expect(MIG).not.toMatch(/CREATE UNIQUE INDEX[^;]*referinta_intentie[^;]*WHERE/)
    expect(LOGICA).toContain("{ onConflict: 'referinta_intentie', ignoreDuplicates: true }")
    expect(LOGICA).toContain(".in('referinta_intentie', chei.slice(i, i + 100))")
    expect(LOGICA).toContain('observatii: linie, referinta_intentie: cheie },')
  })
  it('triggerul: referința se scrie doar la INSERT (BEFORE UPDATE OF, orice diferență = 23514)', () => {
    expect(MIG).toContain('CREATE TRIGGER trg_magazie_referinta_intentie BEFORE UPDATE OF referinta_intentie ON public.magazie_echipamente\n  FOR EACH ROW EXECUTE FUNCTION public.fn_magazie_referinta_intentie_imuabila();')
    expect(MIG).toContain('IF NEW.referinta_intentie IS DISTINCT FROM OLD.referinta_intentie THEN')
    expect(MIG).toContain("USING ERRCODE = '23514'")
  })
  it('revenirea: lock înaintea verificărilor, refuz dacă există rânduri cu referință, apoi DROP la tot ce a creat migrarea', () => {
    const iLock = REV.indexOf('LOCK TABLE public.magazie_echipamente IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iNumar = REV.indexOf('WHERE e.referinta_intentie IS NOT NULL')
    expect(iLock).toBeGreaterThan(0)
    expect(iNumar).toBeGreaterThan(iLock)
    expect(REV.indexOf("AMPRENTA_20261231a_INCEPUT")).toBeGreaterThan(iLock)
    for (const d of ['DROP TRIGGER trg_magazie_referinta_intentie ON public.magazie_echipamente;', 'DROP FUNCTION public.fn_magazie_referinta_intentie_imuabila();',
      'ALTER TABLE public.magazie_echipamente DROP CONSTRAINT magazie_echipamente_referinta_intentie_key;', 'ALTER TABLE public.magazie_echipamente DROP COLUMN referinta_intentie;']) {
      expect(REV).toContain(d)
    }
  })
  it('lista revizuită L15 a obiectelor: exact cele 5 obiecte create', () => {
    expect(OBIECTE.split('\n').filter(l => l && !l.startsWith('#'))).toEqual([
      'coloana\tcoloana public.magazie_echipamente.referinta_intentie\tcreat',
      'constrangere\tconstrangere tabel public.magazie_echipamente.magazie_echipamente_referinta_intentie_key\tcreat',
      'functie\tfunctie public.fn_magazie_referinta_intentie_imuabila()\tcreat',
      'relatie\trelatie public.magazie_echipamente_referinta_intentie_key\tcreat',
      'trigger\ttrigger public.magazie_echipamente.trg_magazie_referinta_intentie\tcreat',
    ])
  })
})
