// REGULA porților Izometrie (docs/izometrie/PORTI_RECONCILIERE.md, de la 20261230a, TKT-2026-0393): o migrare care atinge un obiect amprentat
// de porți (executie_tevi / tronsoane / pachete / proiecte / bonuri, logistica_depozite, profiles, magazie_bucati*, izo_*, fn_izo_*, drepturile
// secvențelor, storage.objects / buckets, rolurile izo_*) rulează poarta cu rezultatul '{}' DUPĂ schimbare și reface cele 5 ștampile în aceeași
// tranzacție — sau declară explicit „-- IZO_PORTI: neatins — <motiv>” (intră în review).
// Plasă de siguranță TEXTUALĂ (fail-closed, fals-pozitive acceptate), nu dovadă: adevărul rămâne poarta pe clonă. Cele trei migrări care au
// înroșit porțile pe producție (20261209a, 20261211a, 20261218a) trebuie să fie prinse de detector (altfel detectorul nu e bun).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const DIR = new URL('../supabase/migrations/', import.meta.url)
const PRAG = '20261230a'   // migrările de dinainte au fost aplicate fără regulă; reconcilierea (20261230a) e prima sub ea
const citeste = (f) => readFileSync(new URL(f, DIR), 'utf8').replace(/\r/g, '')
// comentariile de linie scoase (marcajul de excepție se caută separat, în textul întreg)
const faraComentarii = (t) => t.replace(/--[^\n]*/g, '')

const T = '(?:public\\.)?"?(?:executie_tevi|executie_tronsoane|executie_pachete_lansare|executie_pachete_documente|executie_proiecte|' +
  'executie_bonuri_consum_linii|logistica_depozite|profiles|magazie_bucati\\w*|izo_\\w+)"?'
const ATINGE = [
  ['ON <obiect izo> (trigger / politică / index / drepturi)', new RegExp(`\\bON\\s+(?:TABLE\\s+)?${T}(?![\\w.])`, 'i')],
  ['ALTER TABLE <obiect izo>', new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${T}(?![\\w.])`, 'i')],
  ['drepturi pe secvențe', /\bON\s+(?:ALL\s+)?SEQUENCES?\b/i],
  ['drepturi pe tot schema public', /\bON\s+ALL\s+(?:TABLES|FUNCTIONS|ROUTINES|SEQUENCES)\s+IN\s+SCHEMA\s+public\b/i],
  ['funcții fn_izo_*', /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|ALTER\s+FUNCTION|DROP\s+FUNCTION)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?fn_izo_/i],
  ['drepturi pe funcții fn_izo_*', /\bON\s+FUNCTION\s+(?:public\.)?"?fn_izo_/i],
  ['storage.objects / storage.buckets', /\b(?:ON|ALTER\s+TABLE)\s+(?:TABLE\s+)?storage\.(?:objects|buckets)\b/i],
  ['roluri izo_*', /\b(?:CREATE|ALTER|DROP)\s+ROLE\s+"?izo_|\bGRANT\s+"?izo_\w+"?\s+TO\b/i],
]
const STAMPILE = ['fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii', 'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii']

export function verifica(text) {
  const t = faraComentarii(text)
  const atinge = ATINGE.filter(([, re]) => re.test(t)).map(([ce]) => ce)
  if (!atinge.length) return { atinge, ok: true }
  if (/^--[ \t]*IZO_PORTI:[ \t]*neatins[ \t]+—[ \t]*\S.{9,}$/m.test(text)) return { atinge, ok: true, exceptie: true }
  const lipsa = []
  if (!/public\.fn_izo_porti_lipsa\(\)[\s\S]{0,80}?'\{\}'/.test(t)) lipsa.push("poarta după schimbare (public.fn_izo_porti_lipsa() … '{}')")
  for (const f of STAMPILE) if (!new RegExp(`COMMENT\\s+ON\\s+FUNCTION\\s+public\\.${f}\\(\\)\\s+IS`, 'i').test(t)) lipsa.push(`ștampila ${f}()`)
  return { atinge, ok: lipsa.length === 0, lipsa }
}

describe('regula porților Izometrie (de la 20261230a)', () => {
  const toate = readdirSync(DIR).filter((f) => /^\d{8}[a-z]?_.*\.sql$/.test(f)).sort()
  it('detectorul prinde cele trei migrări care au înroșit porțile (fără ștampile)', () => {
    for (const f of ['20261209a_executie_acces_proiect.sql', '20261211a_executie_fibra_optica.sql', '20261218a_securitate_anon_drepturi.sql']) {
      const r = verifica(citeste(f))
      expect(r.atinge.length, f).toBeGreaterThan(0)
      expect(r.ok, f).toBe(false)
    }
  })
  it('20261120a (ultima care a refăcut ștampilele) și 20261230a trec', () => {
    for (const f of ['20261120a_izometrie_aviz_iesire.sql', '20261230a_izometrie_porti_reconciliere.sql']) {
      const r = verifica(citeste(f))
      expect(r.atinge.length, f).toBeGreaterThan(0)
      expect(r, f).toMatchObject({ ok: true })
    }
  })
  it('cazuri minime: atinge / nu atinge, ștampilele, excepția declarată', () => {
    const tot = `IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'x'; END IF;\n` +
      STAMPILE.map((f) => `EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', 'p=' || public.${f}());`).join('\n')
    expect(verifica('CREATE TABLE public.alt (id int);\nGRANT SELECT ON public.alt TO authenticated;').atinge).toEqual([])
    expect(verifica('CREATE TRIGGER t BEFORE UPDATE ON public.executie_tevi FOR EACH ROW EXECUTE FUNCTION f();').ok).toBe(false)
    expect(verifica('CREATE TRIGGER t BEFORE UPDATE ON public.executie_tevi FOR EACH ROW EXECUTE FUNCTION f();\n' + tot).ok).toBe(true)
    expect(verifica('REVOKE ALL ON SEQUENCE public.alta_seq FROM anon;').ok).toBe(false)
    expect(verifica('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;').ok).toBe(false)
    expect(verifica('ALTER TABLE profiles ADD COLUMN x int;').ok).toBe(false)
    expect(verifica('CREATE POLICY p ON storage.objects FOR SELECT USING (true);').ok).toBe(false)
    expect(verifica('CREATE OR REPLACE FUNCTION public.fn_izo_x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;').ok).toBe(false)
    // o singură ștampilă lipsă = refuz
    expect(verifica('CREATE INDEX i ON public.izo_fronturi (id);\n' + tot.replace('fn_izo_porti_e3b_definitii() IS', 'fn_x() IS')).lipsa).toEqual(['ștampila fn_izo_porti_e3b_definitii()'])
    // ștampilele doar într-un comentariu nu contează
    expect(verifica('CREATE INDEX i ON public.izo_fronturi (id);\n' + tot.split('\n').map((l) => '-- ' + l).join('\n')).ok).toBe(false)
    // excepția declarată, cu motiv
    expect(verifica('ALTER TABLE public.profiles ADD COLUMN x int;\n-- IZO_PORTI: neatins — coloana nouă nu intră în nicio definiție izo (verificat)').ok).toBe(true)
    expect(verifica('ALTER TABLE public.profiles ADD COLUMN x int;\n-- IZO_PORTI: neatins — scurt').ok).toBe(false)
    // nume asemănătoare, dar altele
    expect(verifica('CREATE INDEX i ON public.profiles_vechi (id);\nCREATE TRIGGER t BEFORE UPDATE ON public.executie_tevi_arhiva FOR EACH ROW EXECUTE FUNCTION f();').atinge).toEqual([])
  })
  it(`fiecare migrare de la ${PRAG} încolo care atinge obiecte amprentate respectă regula`, () => {
    const noi = toate.filter((f) => f >= PRAG)
    expect(noi).toContain('20261230a_izometrie_porti_reconciliere.sql')
    const gresite = noi.map((f) => [f, verifica(citeste(f))]).filter(([, r]) => !r.ok).map(([f, r]) => `${f}: atinge ${r.atinge.join(', ')}; lipsește ${r.lipsa.join(', ')}`)
    expect(gresite).toEqual([])
  })
})
