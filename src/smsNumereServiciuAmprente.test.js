// SMS — numere de serviciu (20261220a): verificări statice ale livrării.
// (1) L15 + L19: amprenta stării de acces folosește O SINGURĂ definiție — corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql, copiat
//     octet cu octet (fără CR) în scriptul coordonatorului (scripts/sms_numere_serviciu_amprente.sql) și în migrare; BASELINE într-un singur
//     bloc marcat, verificat ÎNAINTE și DUPĂ, cu EXACT cele două excepții declarate. (2) Revenirea reface corpurile 20261130b EXACT (copiate
//     din fișierul aplicat) și poartă amprentele corpurilor noi din migrare. (3) Migrarea nu scrie date, nu dă drepturi decât lui authenticated
//     pe funcțiile expuse, nu atinge employees / user_module_access. (4) Fără numere de telefon reale sau căi de server în livrare.
// Comportamentul (BD): scripts/pglite/test_sms_numere_serviciu_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/sms_numere_serviciu_amprente.sql')
const MIG = citeste('supabase/migrations/20261220a_sms_numere_serviciu.sql')
const REV = citeste('supabase/revenire/20261220a_sms_numere_serviciu_ROLLBACK.sql')
const B30 = citeste('supabase/migrations/20261130b_sms_acces_modul.sql')
const MIG21 = citeste('supabase/migrations/20261221a_meteo_xweather_zilnic.sql')
const SCRIPT21 = citeste('scripts/meteo_xweather_amprente.sql')
const X = '20261220a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const nr = (t, s) => t.split(s).length - 1
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const faraComentarii = t => t.replace(/--[^\n]*/g, '')
// textul unei funcții = de la antet până la „END $fn$;” (inclusiv); corpul = ce e între AS $fn$ și $fn$; (= prosrc)
const functie = (t, antet) => { const i = t.indexOf(antet); if (i < 0) return null; return t.slice(i, t.indexOf('END $fn$;', i) + 'END $fn$;'.length) }
const corp = (t, antet) => { const f = functie(t, antet); const a = f.indexOf('AS $fn$') + 'AS $fn$'.length; return f.slice(a, f.lastIndexOf('$fn$;')) }
// codul de nivel sus al migrării (fără corpurile funcțiilor și fără blocurile DO / pg_temp)
const nivelSus = t => faraComentarii(t).replace(/\$(fn|fo|amp|bl|vf|acl|pre|post|lock|l15_inainte|l15_dupa|revenire)\$[\s\S]*?\$\1\$/g, '$$…$$')

describe('20261220a — AMPRENTA_L15: o singură definiție (sursa = scriptul coordonatorului = migrarea)', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic există, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('linia de baseline, sursa (pornire / inchidere) și atenționările = cele din scriptul 20261221a (r3: același tipar)', () => {
    const coada = t => t.slice(t.indexOf('SELECT c.eticheta, c.amprenta,\n'), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT).length).toBeGreaterThan(500)
    expect(coada(SCRIPT)).toBe(coada(SCRIPT21))
  })
  it('aceleași tabele în script (ambele interogări) și în migrare; pornirea = crearea (4 și 5 parametri), lista fixată, lista angajaților', () => {
    const tab = "amp_tabele(oid) AS (VALUES ('public.sms_loturi'::regclass::oid), ('public.sms_mesaje'::regclass::oid)),"
    expect(SCRIPT.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab, tab])
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    const inch = blocuri(MIG, IA, IB)[0]
    for (const f of ["'public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean)'", "'public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[])'",
                     "'public.fn_sms_lot_destinatari(uuid)'", "'public.fn_sms_angajati_lista()'"]) expect(inch).toContain(`to_regprocedure(${f})`)
  })
  // r3 (review P1): închiderea tranzitivă se CALCULEAZĂ în migrare (nu se ia din BASELINE) — tiparul 20261221a
  it('închiderea: un bloc în migrare, două în script (secțiunile 1 și 2), toate identice, înaintea corpului v1', () => {
    const inch = blocuri(MIG, IA, IB)
    expect(inch).toHaveLength(1)
    expect(blocuri(SCRIPT, IA, IB)).toEqual([inch[0], inch[0]])
    expect(MIG.indexOf(IB)).toBeLessThan(MIG.indexOf(A))
    expect(SCRIPT.indexOf(IB)).toBeLessThan(SCRIPT.indexOf(A))
    expect(MIG).not.toMatch(/amp_functii_explicite\(oid\) AS \(SELECT to_regprocedure\(substr\(b\.eticheta/)
    expect(MIG).toContain('WITH RECURSIVE\namp_tabele(oid)')
  })
  it('L19: lanțul (amp_lant + amp_functii_explicite) = EXACT blocul din 20261221a, octet cu octet', () => {
    const lant = t => { const b = t.slice(t.indexOf('-- >>> INCHIDERE_L15'), t.indexOf('-- <<< INCHIDERE_L15')); return b.slice(b.indexOf('amp_lant(oid) AS (\n')) }
    expect(lant(MIG).length).toBeGreaterThan(1000)
    expect(lant(MIG)).toBe(lant(MIG21))
    expect(lant(MIG)).toBe(lant(SCRIPT21))
  })
  it('EXECUTE dinamic / limbaj neanalizabil în lanț = REFUZ în migrare (aceeași regulă ca 20261221a) și numărat în script (secțiunea 2)', () => {
    const regula = "(l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')\n          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\\mexecute\\M'))"
    expect(nr(MIG21, regula)).toBe(1)
    expect(nr(MIG, regula)).toBe(1)
    expect(nr(SCRIPT, regula)).toBe(1)
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    expect(f).toContain(`  IF v_exec IS NOT NULL THEN\n    RAISE EXCEPTION '${X}: lantul de acces are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;`)
    expect(f).toContain(`WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_${X} c WHERE c.eticheta LIKE 'functie %')`)
    const s2 = SCRIPT.slice(SCRIPT.indexOf("\\echo '=== 2."), SCRIPT.indexOf("\\echo '=== 3."))
    expect(s2).toContain('WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f)')
    expect(s2).toContain('AS functii_cu_sql_dinamic_in_lant')
    expect(SCRIPT).toContain("'EXECUTE in corp (migrarea refuza)'")
  })
  it('scriptul coordonatorului e DOAR citire: o tranzacție READ ONLY, încheiată cu ROLLBACK, fără scrieri', () => {
    expect(SCRIPT).toContain('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    // fără comentarii și fără șirurile '…' (lista NUME-NOI conține cuvinte ca 'commit' din comentariile corpurilor, ca date, nu instrucțiuni)
    expect(faraComentarii(SCRIPT).replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|GRANT|REVOKE|CREATE|ALTER|DROP|COMMIT)\b/i)
  })
  it('BASELINE într-un singur loc marcat: necompletat (DE_COMPLETAT = refuz) sau linii valide din script, în ordinea afișată', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    expect(nr(MIG, `CREATE FUNCTION pg_temp.amp_baseline_${X}()`)).toBe(1)
    expect(MIG).toContain('amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),')
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    if (linii.length === 1 && linii[0] === "('DE_COMPLETAT', 'DE_COMPLETAT')") return
    linii.forEach((l, i) => expect(l).toMatch(i === 0 ? /^\('(tabel|functie) [^']+', '[0-9a-f]{32}'\)$/ : /^, \('(tabel|functie) [^']+', '[0-9a-f]{32}'\)$/))
    const et = linii.map(l => l.match(/\('([^']+)'/)[1])
    expect(new Set(et).size).toBe(et.length)
    expect([...et].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))).toEqual(et)
    for (const e of ['functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)']) expect(et).toContain(e)
  })
  it('verificarea rulează ÎNAINTE (înaintea lock-urilor și a schimbării) și DUPĂ (după postcondiții), apoi funcțiile pg_temp se șterg', () => {
    const iInainte = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('inainte')`)
    const iAcl = MIG.indexOf(`CREATE TEMP TABLE sms_acl_inainte_${X}`)
    const iLock = MIG.indexOf('DO $lock$')
    const iSchimbare = MIG.indexOf('CREATE TABLE public.sms_numere_serviciu')
    const iDrop = MIG.indexOf('DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean);')
    const iPost = MIG.indexOf('DO $post$')
    const iDupa = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('dupa')`)
    const iFinal = MIG.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${X}(text), pg_temp.amp_calc_${X}(), pg_temp.amp_baseline_${X}(), pg_temp.sms_acl_${X}(oid), pg_temp.sms_folosite_${X}();`)
    expect(iInainte).toBeGreaterThan(MIG.indexOf('DO $pre$'))
    expect(iAcl).toBeGreaterThan(iInainte)
    expect(iLock).toBeGreaterThan(iAcl)
    expect(iSchimbare).toBeGreaterThan(iLock)
    expect(iDrop).toBeGreaterThan(iSchimbare)
    expect(iPost).toBeGreaterThan(iDrop)
    expect(iDupa).toBeGreaterThan(iPost)
    expect(iFinal).toBeGreaterThan(iDupa)
    expect(MIG.slice(iFinal).trim().split('\n')).toHaveLength(1)
  })
  it('excepțiile „după” sunt EXACT cele trei declarate (crearea cu 4 parametri, ștearsă; cea cu 5, nouă; lista fixată, corp nou)', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    const exc = [...f.matchAll(/WHERE NOT \(p_moment = 'dupa' AND ([xy])\.eticheta IN \(([^)]*\)[^)]*\)[^)]*\)[^)]*\))\)\)/g)]
    expect(exc.map(m => m[1])).toEqual(['x', 'y'])
    for (const m of exc) {
      expect([...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])).toEqual(['functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)',
        'functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])', 'functie fn_sms_lot_destinatari(uuid)'])
    }
    expect(nr(f, "p_moment = 'dupa'")).toBe(2)
  })
})

describe('20261220a — migrarea', () => {
  const sus = nivelSus(MIG)
  it('nu scrie date și nu atinge alte module (employees, user_module_access, app_modules, profiles)', () => {
    expect(sus).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i)
    expect(faraComentarii(MIG)).not.toMatch(/\b(user_module_access|app_modules|profiles)\b/)
    expect(faraComentarii(MIG)).not.toMatch(/(ALTER|UPDATE|INSERT INTO|DELETE FROM)\s+(TABLE\s+)?public\.employees/i)
    expect(MIG).toContain("IF EXISTS (SELECT 1 FROM public.sms_numere_serviciu) OR EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.destinatar_tip = 'serviciu') THEN")
  })
  it('drepturile: REVOKE explicit pe tabel + secvență; GRANT doar authenticated, doar pe cele 5 funcții expuse; nimic pentru anon', () => {
    expect(sus).toContain('REVOKE ALL ON TABLE public.sms_numere_serviciu FROM PUBLIC, anon, authenticated, service_role;')
    expect(sus).toContain('REVOKE ALL ON SEQUENCE public.sms_numere_serviciu_id_seq FROM PUBLIC, anon, authenticated, service_role;')
    const granturi = sus.match(/GRANT [\s\S]*?;/g)
    expect(granturi).toHaveLength(1)
    expect(granturi[0]).toMatch(/TO authenticated;$/)
    expect(granturi[0]).not.toMatch(/fn_sms_numere_serviciu_reguli|anon|service_role|PUBLIC/)
    expect(nr(granturi[0], 'public.fn_sms_')).toBe(5)
    expect(sus).not.toMatch(/CREATE POLICY|ALTER DEFAULT PRIVILEGES|FORCE ROW LEVEL SECURITY/)
    expect(sus).toContain('ALTER TABLE public.sms_numere_serviciu ENABLE ROW LEVEL SECURITY;')
  })
  it('L09: crearea lotului = DROP varianta cu 4 parametri + CREATE cea cu 5 (al cincilea cu DEFAULT NULL), fără CREATE OR REPLACE pe ea', () => {
    expect(nr(sus, 'DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean);')).toBe(1)
    expect(MIG).toContain('                                                 p_doar_preview boolean DEFAULT true, p_numere_serviciu integer[] DEFAULT NULL)')
    expect(MIG).not.toMatch(/CREATE OR REPLACE FUNCTION public\.fn_sms_lot_intern_creeaza/)
    expect(nr(MIG, 'CREATE OR REPLACE FUNCTION public.')).toBe(1)   // doar fn_sms_lot_destinatari
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid)')
  })
  it('$pre$ cere corpurile 20261130b exacte: amprentele din gardă = md5 al corpurilor din fișierul 20261130b', () => {
    const a = md5(corp(B30, 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza('))
    const b = md5(corp(B30, 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari('))
    expect([a, b]).toEqual(['ee0e39daf80d5abd45412e4782d5d07b', '3fb67709c3a020cfbdb783d51e288111'])
    const pre = MIG.slice(MIG.indexOf('DO $pre$'), MIG.indexOf('END $pre$;'))
    expect(pre).toContain(`= '${a}')`)
    expect(pre).toContain(`= '${b}')`)
  })
  it('corpul nou al creării = corpul 20261130b + DOAR blocurile numerelor de serviciu (restul liniilor neschimbate, în ordine)', () => {
    const vechi = corp(B30, 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(').split('\n')
    const nou = corp(MIG, 'CREATE FUNCTION public.fn_sms_lot_intern_creeaza(').split('\n')
    // fiecare linie veche apare în corpul nou, în aceeași ordine — cu excepția celor înlocuite (explicit, cu motivul)
    const inlocuite = new Map([
      ['    SELECT e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel', 'tipul destinatarului pe fiecare candidat'],
      ['    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c', 'idem'],
      ['    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id', 'angajatul are prioritate la același telefon'],
      ["         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)", 'plus tipurile'],
      ['    INTO v_cand, v_fara, v_opt, v_tel, v_ids;', 'plus tipurile'],
      ["    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0)),", 'filtrul cu numerele'],
      ["    SELECT v_lot, u.t, 'angajat', u.i FROM unnest(v_tel, v_ids) AS u(t, i);", 'tipul din listă'],
      ["    'coada_libera', CASE WHEN v_niv = 'test' THEN greatest(0, public.fn_sms_test_coada_max() - public.fn_sms_test_coada(auth.uid())) END);", 'plus numărătorile'],
      ['  -- un singur instantaneu: candidatii (angajati activi din filtre), excluderile si lista finala (un SMS per telefon)', 'comentariu'],
      ['        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_niv text;', 'neschimbată (urmată de declarațiile noi)'],
      ['  -- 20261130b: contul de test, maximum 5 destinatari (si in previzualizare)', 'comentariu'],
    ])
    let j = 0
    for (const l of vechi) {
      if (inlocuite.has(l) && !nou.includes(l)) continue
      const k = nou.indexOf(l, j)
      expect(k, 'linia veche lipsește / e mutată: ' + l).toBeGreaterThanOrEqual(j)
      j = k + 1
    }
  })
  it('postcondițiile poartă amprentele corpurilor noi (md5 al textului din migrare)', () => {
    const a = md5(corp(MIG, 'CREATE FUNCTION public.fn_sms_lot_intern_creeaza('))
    const b = md5(corp(MIG, 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari('))
    for (const t of [MIG, REV]) {
      expect(t).toMatch(new RegExp(`-- AMPRENTA-START crearea lotului\\n\\s*'${a}'\\n\\s*-- AMPRENTA-END crearea lotului`))
      expect(t).toMatch(new RegExp(`-- AMPRENTA-START lista fixata\\n\\s*'${b}'\\n\\s*-- AMPRENTA-END lista fixata`))
    }
  })
  it('funcțiile expuse nu conțin construcțiile oprite de poarta 0e (set_config, request.jwt, execute, session authorization)', () => {
    for (const antet of ['CREATE FUNCTION public.fn_sms_numere_serviciu_lista(', 'CREATE FUNCTION public.fn_sms_numere_serviciu_admin(', 'CREATE FUNCTION public.fn_sms_numar_serviciu_salveaza(',
                         'CREATE FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(', 'CREATE FUNCTION public.fn_sms_lot_intern_creeaza(', 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(']) {
      expect(corp(MIG, antet).toLowerCase()).not.toMatch(/set_config|request\s*\.\s*jwt|\bexecute\b|session[_\s]+authorization|\bu&/)
    }
  })
  it('administrarea cere owner-ul în BD; lista cere nivelul SMS (aceeași poartă ca lista angajaților)', () => {
    for (const antet of ['CREATE FUNCTION public.fn_sms_numere_serviciu_admin(', 'CREATE FUNCTION public.fn_sms_numar_serviciu_salveaza(', 'CREATE FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(']) {
      expect(corp(MIG, antet)).toMatch(/^\s*\n(DECLARE[^\n]*\n)?BEGIN\n  PERFORM public\.fn_sms_cere_owner\(\);/)
    }
    expect(corp(MIG, 'CREATE FUNCTION public.fn_sms_numere_serviciu_lista(')).toMatch(/^\s*\n(DECLARE[^\n]*\n)?BEGIN\n  PERFORM public\.fn_sms_cere_nivel\(\);/)
    expect(corp(B30, 'CREATE OR REPLACE FUNCTION public.fn_sms_angajati_lista(')).toMatch(/^\s*\nBEGIN\n  PERFORM public\.fn_sms_cere_nivel\(\);/)
  })
})

// r2 (P1): funcțiile pe care se sprijină corpurile NOI (porțile owner / nivel și restul) sunt în amprentă — lista FOLOSITE din migrare =
// EXACT apelurile din corpuri = pornirea scriptului coordonatorului (o funcție nouă chemată mâine fără să intre în listă = test picat)
const ANTETE_NOI = ['CREATE FUNCTION public.fn_sms_numere_serviciu_reguli(', 'CREATE FUNCTION public.fn_sms_numere_serviciu_lista(',
  'CREATE FUNCTION public.fn_sms_numere_serviciu_admin(', 'CREATE FUNCTION public.fn_sms_numar_serviciu_salveaza(',
  'CREATE FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(', 'CREATE FUNCTION public.fn_sms_lot_intern_creeaza(',
  'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(']
const NOI5 = ['fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numar_serviciu_salveaza', 'fn_sms_numere_serviciu_admin', 'fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_reguli']
const folosite = () => {
  const bloc = MIG.slice(MIG.indexOf(`-- >>> FOLOSITE ${X}`), MIG.indexOf(`-- <<< FOLOSITE ${X}`))
  return [...bloc.matchAll(/'functie ([^']+)'/g)].map(m => m[1])
}
const numeFn = s => s.replace(/^(public|auth)\./, '').replace(/\(.*$/, '')
describe('20261220a r2 — amprenta acoperă porțile și restul funcțiilor chemate de corpurile noi', () => {
  it('lista FOLOSITE (un singur bloc) = exact funcțiile din public / auth chemate în corpurile noi (fără cele create aici)', () => {
    expect(nr(MIG, `-- >>> FOLOSITE ${X}`)).toBe(1)
    const chemate = new Set()
    for (const a of ANTETE_NOI) {
      for (const m of faraComentarii(corp(MIG, a)).matchAll(/\b(public|auth)\.([a-z_][a-z0-9_]*)\(/g)) chemate.add(m[2])
    }
    for (const n of [...NOI5, 'fn_sms_lot_intern_creeaza', 'fn_sms_lot_destinatari']) chemate.delete(n)
    const lista = folosite()
    expect(new Set(lista).size).toBe(lista.length)
    expect(lista.map(numeFn).sort()).toEqual([...chemate].sort())
    for (const p of ['fn_sms_cere_owner', 'fn_sms_cere_nivel', 'uid']) expect(lista.map(numeFn)).toContain(p)
  })
  it('pornirea închiderii (migrare = script) = lista FOLOSITE + crearea (4 / 5), lista fixată, lista angajaților (aceleași semnături)', () => {
    const inch = faraComentarii(blocuri(MIG, IA, IB)[0])
    const pornire = inch.slice(inch.indexOf('amp_pornire(oid) AS ('), inch.indexOf('amp_lant(oid) AS ('))
    const din = [...pornire.matchAll(/to_regprocedure\('([^']+)'\)::oid/g)].map(m => m[1].replace(/^public\./, '').replace(/ /g, '').replace('public.sms_loturi', 'sms_loturi'))
    expect(new Set(din).size).toBe(din.length)
    const baza = ['fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])', 'fn_sms_lot_destinatari(uuid)', 'fn_sms_angajati_lista()']
    expect([...din].sort()).toEqual([...baza, ...folosite()].sort())
  })
  it('verificarea: FOLOSITE în baseline, apoi închiderea = baseline (FULL JOIN), DEFINER fără search_path, apoi EXECUTE dinamic; fără regula veche pe cuvinte', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    const iFol = f.indexOf('baseline L15 fara functiile folosite de corpurile noi')
    const iComp = f.indexOf('difera de baseline-ul L15 revizuit')
    const iDef = f.indexOf('nu are search_path propriu')
    const iExec = f.indexOf('EXECUTE dinamic / limbaj neanalizabil')
    expect(iFol).toBeGreaterThan(0)
    expect(iComp).toBeGreaterThan(iFol)
    expect(iDef).toBeGreaterThan(iComp)
    expect(iExec).toBeGreaterThan(iDef)
    expect(f).not.toContain('baseline L15 incomplet')
    expect(f).toMatch(/FROM amp_rez_20261220a x\n[\s\S]*?FULL JOIN \(SELECT y\.eticheta, y\.amprenta FROM pg_temp\.amp_baseline_20261220a\(\) y/)
  })
  it('postcondiția: funcțiile noi cheamă doar lista FOLOSITE (aceeași regulă de nume ca închiderea) și nimic dinamic', () => {
    const p = MIG.slice(MIG.indexOf('DO $post$'), MIG.indexOf('END $post$;'))
    expect(p).toContain(`regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\\(', 'g') w`)
    expect(p).toContain(`AND p2.oid NOT IN (SELECT to_regprocedure(substr(f.e, 9))::oid FROM pg_temp.sms_folosite_${X}() f(e)`)
    expect(p).toContain("RAISE EXCEPTION '20261220a post: functiile noi cheama in afara listei FOLOSITE amprentate: %', coalesce(v_dif, 'EXECUTE dinamic');")
  })
  it('scriptul, secțiunea 3: lista NUME-NOI = exact numele „nume(” din corpurile noi (regula postcondiției), deci arată refuzul dinainte', () => {
    const nume = new Set()
    for (const a of ANTETE_NOI) for (const m of corp(MIG, a).matchAll(/([\p{L}_][\p{L}\p{N}_$]*)"?\s*\(/gu)) nume.add(m[1].toLowerCase())
    const bloc = SCRIPT.slice(SCRIPT.indexOf(`-- >>> NUME-NOI ${X}`), SCRIPT.indexOf(`-- <<< NUME-NOI ${X}`))
    const din = [...faraComentarii(bloc).matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"))
    expect(new Set(din).size).toBe(din.length)
    expect([...din].sort()).toEqual([...nume].sort())
    const s3 = SCRIPT.slice(SCRIPT.indexOf("\\echo '=== 3."), SCRIPT.indexOf("\\echo '=== 4."))
    const fol = [...s3.matchAll(/to_regprocedure\('([^']+)'\)::oid/g)].map(m => m[1].replace(/^public\./, '').replace(/ /g, '').replace('public.sms_loturi', 'sms_loturi'))
    expect([...fol].sort()).toEqual([...folosite()].sort())
  })
})

// r2 (P2, L14): amprenta completă a celor cinci funcții noi, aceeași în postcondiția migrării și în verificarea revenirii
describe('20261220a r2 — AMPRENTE-NOI: migrare = revenire = corpurile din migrare', () => {
  const bloc = t => {
    const i = t.indexOf(`-- >>> AMPRENTE-NOI ${X}`)
    return t.slice(t.indexOf('\n', i) + 1, t.indexOf(`-- <<< AMPRENTE-NOI ${X}`)).split('\n').map(l => l.trim()).filter(Boolean).join('\n')
  }
  it('un singur bloc în fiecare fișier, identic (fără spațiile de la început)', () => {
    expect(nr(MIG, `-- >>> AMPRENTE-NOI ${X}`)).toBe(1)
    expect(nr(REV, `-- >>> AMPRENTE-NOI ${X}`)).toBe(1)
    expect(bloc(REV)).toBe(bloc(MIG))
  })
  it('cele cinci funcții, fiecare cu corp_md5 = md5 al corpului din migrare, DEFINER, search_path fix, o singură variantă', () => {
    const b = bloc(MIG)
    for (const n of NOI5) {
      const linie = b.split('\n').find(l => l.startsWith(`('public.${n}(`))
      expect(linie, n).toBeTruthy()
      expect(linie).toContain(`corp_md5=${md5(corp(MIG, `CREATE FUNCTION public.${n}(`))}'`)
      expect(linie).toContain('definer=true')
      expect(linie).toContain('config=search_path=public, pg_temp,')
      expect(linie).toContain('variante=1')
      expect(linie).not.toMatch(/anon|service_role|PUBLIC/)
    }
    expect(b.split('\n').filter(l => /^\('public\./.test(l))).toHaveLength(5)
  })
  it('în revenire, verificarea e înaintea oricărei schimbări (DROP)', () => {
    const iBloc = REV.indexOf(`-- >>> AMPRENTE-NOI ${X}`)
    const iRefuz = REV.indexOf('functiile noi difera de amprenta de la aplicare')
    expect(iBloc).toBeGreaterThan(0)
    expect(iRefuz).toBeGreaterThan(iBloc)
    expect(REV.indexOf('DROP TABLE public.sms_numere_serviciu;')).toBeGreaterThan(iRefuz)
    expect(REV.indexOf('DROP FUNCTION')).toBeGreaterThan(iRefuz)
  })
})

describe('20261220a — revenirea', () => {
  it('reface corpurile 20261130b EXACT (textul funcției copiat din fișierul aplicat) și drepturile variantei vechi', () => {
    for (const antet of ['CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(', 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(']) {
      expect(functie(REV, antet)).toBe(functie(B30, antet))
      expect(nr(REV, antet)).toBe(1)
    }
    expect(REV).toContain('GRANT EXECUTE ON FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean) TO authenticated;')
    expect(REV).toContain("IS DISTINCT FROM 'ee0e39daf80d5abd45412e4782d5d07b'")
    expect(REV).toContain("IS DISTINCT FROM '3fb67709c3a020cfbdb783d51e288111'")
  })
  it('refuză cu mesaje / numere salvate, verificate DUPĂ lock-uri (L14), și spune ce se face în loc', () => {
    const iLock = REV.indexOf('LOCK TABLE public.sms_mesaje IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iMesaje = REV.indexOf("SELECT count(*) INTO v_n FROM public.sms_mesaje m WHERE m.destinatar_tip = 'serviciu';")
    const iNumere = REV.indexOf('SELECT count(*) INTO v_n FROM public.sms_numere_serviciu;')
    const iDrop = REV.indexOf('DROP TABLE public.sms_numere_serviciu;')
    expect(iLock).toBeGreaterThan(0)
    expect(iMesaje).toBeGreaterThan(iLock)
    expect(iNumere).toBeGreaterThan(iMesaje)
    expect(iDrop).toBeGreaterThan(iNumere)
    expect(REV).toContain('ÎN LOC de revenire se face OPRIREA')
    expect(faraComentarii(REV)).not.toMatch(/\b(DELETE FROM|TRUNCATE|UPDATE public\.)/)
  })
  it('un singur bloc de verificare și o singură postcondiție (fișierul nu e dublat)', () => {
    expect(nr(REV, 'DO $revenire$')).toBe(1)
    expect(nr(REV, 'DO $post$')).toBe(1)
    expect(nr(MIG, 'DO $post$')).toBe(1)
    expect(nr(MIG, 'DO $pre$')).toBe(1)
  })
})

// r3: proba cu două sesiuni pentru coordonator (clonă PG17) — gărzile înaintea oricărei conexiuni + forma apelurilor
describe('20261220a r3 — proba cu două sesiuni (scripts/sms_numere_serviciu_concurenta.mjs)', () => {
  const CALE = fileURLToPath(new URL('../scripts/sms_numere_serviciu_concurenta.mjs', import.meta.url))
  const S = citeste('scripts/sms_numere_serviciu_concurenta.mjs')
  const ruleaza = (...a) => spawnSync(process.execPath, [CALE, ...a], { encoding: 'utf8', env: { ...process.env, PSQL: 'psql-inexistent-proba', PGHOST: '' } })
  it('refuză ÎNAINTE de conexiune: fără „--” / --sistem (2), mutant necunoscut (2), gazdă Supabase (22)', () => {
    expect(ruleaza('--sistem', '1').status).toBe(2)
    expect(ruleaza('--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', '--mutant', 'altul', '--', '-h', 'clona').status).toBe(2)
    const r = ruleaza('--sistem', '1', '--', '-h', 'db.exemplu.supabase.co')
    expect(r.status).toBe(22)
    expect(r.stderr).toContain('proba rulează doar pe clonă')
  })
  it('garda țintei (system_identifier + PG17) e prima interogare; starea de plecare cerută: aplicată, tabel gol', () => {
    const iMain = S.indexOf('async function main()')
    const iSis = S.indexOf('if (sis !== SISTEM)', iMain), iVer = S.indexOf('cere PostgreSQL 17', iMain)
    const iPrimaScriere = S.indexOf('const prep = await caOwner', iMain)
    expect(iSis).toBeGreaterThan(iMain)
    expect(iVer).toBeGreaterThan(iSis)
    expect(iPrimaScriere).toBeGreaterThan(iVer)
    expect(S.slice(iMain, iPrimaScriere)).toContain("if (stTab !== '0 0 O')")
  })
  it('apelurile ca PostgREST (JWT claim.sub + claims, SET LOCAL ROLE authenticated), prin RPC-ul calificat; mutantul doar pe server, reversibil', () => {
    expect(S).toContain("SELECT set_config('request.jwt.claim.sub', ${lit(uid)}, true), set_config('request.jwt.claims'")
    expect(S).toContain('SET LOCAL ROLE authenticated;')
    expect(S).toContain('SELECT public.fn_sms_numar_serviciu_salveaza(NULL, ')
    expect(S).not.toMatch(/INSERT INTO public\.sms_numere_serviciu/)
    expect(S).toContain('inlocuiesteCorp(APEL_LOCK, MARCAJ)')
    expect(S).toContain('inlocuiesteCorp(MARCAJ, APEL_LOCK)')
    // apelul lock-ului din probă = cel din migrare (altfel mutantul n-ar găsi ce să scoată)
    expect(MIG).toContain(`    PERFORM pg_advisory_xact_lock(hashtextextended('sms_numere_serviciu:adaugare', 0));`)
    expect(S).toContain(`const APEL_LOCK = "PERFORM pg_advisory_xact_lock(hashtextextended('sms_numere_serviciu:adaugare', 0));"`)
    expect(S).toContain('/maximum 100 de numere de serviciu active/')
    expect(MIG).toContain("RAISE EXCEPTION 'sms: maximum 100 de numere de serviciu active (dezactiveaza unul inainte)' USING ERRCODE = '22023';")
  })
})

describe('20261220a — fără date sensibile în livrare (repo public)', () => {
  it('nicio cale de server, niciun telefon în afara celor fictive 0700…', () => {
    for (const t of [MIG, REV, SCRIPT, citeste('scripts/sms_numere_serviciu_concurenta.mjs')]) {
      expect(t).not.toMatch(/[A-Z]:\\|\\\\gazpet|paw-data|Users[\\/]/i)
      for (const m of t.match(/(\+?40|0)7\d{2}[ .]?\d{3}[ .]?\d{3}/g) || []) expect(m.replace(/\D/g, '')).toMatch(/^(40)?0?700/)
    }
  })
})
