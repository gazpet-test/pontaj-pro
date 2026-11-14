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
  it('linia de baseline, sursa (pornire / inchidere) și atenționările = cele din scriptul 20261221a (r3: același tipar; r5: doar eticheta EXECUTE = semnal)', () => {
    const coada = t => t.slice(t.indexOf('SELECT c.eticheta, c.amprenta,\n'), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT).length).toBeGreaterThan(500)
    const vechi = "'EXECUTE in corp (migrarea refuza)'", nou = "'EXECUTE in corp (semnal: de examinat, migrarea NU refuza)'"
    expect(nr(coada(SCRIPT21), vechi)).toBe(1)
    expect(coada(SCRIPT)).toBe(coada(SCRIPT21).replace(vechi, nou))
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
  // r5 (review r4, P2 / L20, varianta B): refuzul pe cuvântul EXECUTE prindea și comentariile → scos din migrare; SQL-ul dinamic = SEMNAL
  // în script (cu schema); limbajul neanalizabil rămâne REFUZ (aceeași regulă de limbaj ca 20261221a, fără ramura EXECUTE)
  it('r5: limbaj neanalizabil în lanț = REFUZ în migrare și în script; SQL dinamic = DOAR semnal în script (cu schema), niciun refuz pe cuvânt în migrare', () => {
    const regulaVeche = "(l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')\n          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\\mexecute\\M'))"
    expect(nr(MIG21, regulaVeche)).toBe(1)
    expect(nr(MIG, regulaVeche)).toBe(0)
    expect(nr(SCRIPT, regulaVeche)).toBe(0)
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    // nicio căutare de cuvinte în corpuri în verificare (nici în comentariile ei de cod: doar în text explicativ)
    expect(faraComentarii(f)).not.toMatch(/execute/i)
    expect(faraComentarii(f)).not.toMatch(/prosrc/)
    expect(f).toContain(`WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_${X} c WHERE c.eticheta LIKE 'functie %')\n     AND l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c');\n  IF v_limbaj IS NOT NULL THEN\n    RAISE EXCEPTION '${X}: lantul de acces are o functie intr-un limbaj neanalizabil (amprenta statica imposibila): %', v_limbaj;`)
    const s2 = SCRIPT.slice(SCRIPT.indexOf("\\echo '=== 2."), SCRIPT.indexOf("\\echo '=== 3."))
    // refuzul de limbaj: aceeași condiție ca migrarea, pe lanțul calculat
    expect(s2).toContain("   WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f)\n     AND l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')\n),")
    // semnalul SQL dinamic: doar sql / plpgsql, cu schema și semnătura
    const sem = s2.slice(s2.indexOf('sem_dinamic(functie) AS ('), s2.indexOf('sem_limbaj(functie) AS ('))
    expect(sem).toContain("p.pronamespace::regnamespace::text || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'")
    expect(sem).toContain("AND l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\\mexecute\\M'")
    for (const c of ['refuz_limbaj_neanalizabil', 'limbaj_neanalizabil_care', 'semnal_sql_dinamic_in_lant', 'sql_dinamic_care']) expect(s2).toContain(`AS ${c}`)
    expect(s2).not.toContain('functii_cu_sql_dinamic_in_lant')
    expect(SCRIPT).toContain("'EXECUTE in corp (semnal: de examinat, migrarea NU refuza)'")
    expect(SCRIPT).not.toContain("'EXECUTE in corp (migrarea refuza)'")
  })
  it('r5: antetul migrării și scriptul nu mai spun „EXECUTE dinamic = REFUZ” / „N > 0 = migrarea va refuza”; spun regula nouă și limita DEFINER', () => {
    const antet = MIG.slice(0, MIG.indexOf('DO $pre$'))
    expect(antet).not.toMatch(/migrarea va refuza/i)
    expect(antet).not.toMatch(/EXECUTE dinamic[^\n]*= REFUZ/)
    expect(antet).toContain('SQL-ul DINAMIC')
    expect(antet).toContain('NU mai e refuz')
    expect(antet).toContain('NU dovedește rezolvarea sigură a numelor')
    expect(antet).toContain('Aplicarea fără amprenta GLOBALĂ NU e acceptată.')
    for (const t of [MIG, SCRIPT]) expect(t).not.toContain('EXECUTE dinamic / limbaj neanalizabil în lanț = refuz')
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    expect(f).toContain('PLASĂ MINIMĂ, NU dovada')
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
  it('verificarea: FOLOSITE în baseline, apoi închiderea = baseline (FULL JOIN), DEFINER fără search_path, apoi limbajul neanalizabil; fără regula veche pe cuvinte', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    const iFol = f.indexOf('baseline L15 fara functiile folosite de corpurile noi')
    const iComp = f.indexOf('difera de baseline-ul L15 revizuit')
    const iDef = f.indexOf('nu are search_path propriu')
    const iExec = f.indexOf('intr-un limbaj neanalizabil (amprenta statica imposibila)')
    expect(iFol).toBeGreaterThan(0)
    expect(iComp).toBeGreaterThan(iFol)
    expect(iDef).toBeGreaterThan(iComp)
    expect(iExec).toBeGreaterThan(iDef)
    expect(f).not.toContain('baseline L15 incomplet')
    expect(f).toMatch(/FROM amp_rez_20261220a x\n[\s\S]*?FULL JOIN \(SELECT y\.eticheta, y\.amprenta FROM pg_temp\.amp_baseline_20261220a\(\) y/)
  })
  // r4 (review r3, P2 / L20): refuzul lexical „funcțiile noi cheamă doar FOLOSITE” respingea o migrare corectă (o funcție omonimă
  // neapelată din altă schemă) — scos; rămân md5-ul corpurilor noi, FOLOSITE în baseline și poarta 0e pe funcțiile expuse
  it('r4: postcondiția NU mai are refuzul lexical FOLOSITE; corpurile noi rămân fixate prin md5, poarta 0e rămâne', () => {
    const p = MIG.slice(MIG.indexOf('DO $post$'), MIG.indexOf('END $post$;'))
    expect(p).not.toContain('functiile noi cheama in afara listei FOLOSITE')
    expect(p).not.toContain('regexp_matches(')
    expect(p).not.toContain('sms_folosite_')
    expect(p).toContain('contine o constructie interzisa de poarta 0e')
    expect(p).toContain("RAISE EXCEPTION '20261220a post: corpurile noi difera de cele revizuite';")
    expect(p).toContain("RAISE EXCEPTION '20261220a post: functiile noi difera de amprenta revizuita: %', v_dif;")
    // lista FOLOSITE se folosește doar în verificare (trebuie să fie în baseline)
    expect(nr(MIG, `pg_temp.sms_folosite_${X}()`)).toBe(3)   // creare + verificare + DROP final
  })
  it('r4 / r5: refuzurile păstrate în verificare = DEFINER fără search_path + limbaj neanalizabil; nimic lexical pe nume sau cuvinte', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    // necompletat, etichete duble, funcțiile schimbate, FOLOSITE în baseline, diferența față de baseline, DEFINER, limbaj neanalizabil
    expect([...f.matchAll(/RAISE EXCEPTION/g)]).toHaveLength(7)
    expect(f).toContain("c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%'")
    expect(f).not.toContain('regexp_matches(')
  })
  it('scriptul, secțiunea 2 (r4): lista NUME-NOI = exact numele „nume(” din corpurile noi; FOLOSITE = lista din migrare', () => {
    const nume = new Set()
    for (const a of ANTETE_NOI) for (const m of corp(MIG, a).matchAll(/([\p{L}_][\p{L}\p{N}_$]*)"?\s*\(/gu)) nume.add(m[1].toLowerCase())
    const bloc = SCRIPT.slice(SCRIPT.indexOf(`-- >>> NUME-NOI ${X}`), SCRIPT.indexOf(`-- <<< NUME-NOI ${X}`))
    const din = [...faraComentarii(bloc).matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"))
    expect(new Set(din).size).toBe(din.length)
    expect([...din].sort()).toEqual([...nume].sort())
    const s2 = SCRIPT.slice(SCRIPT.indexOf("\\echo '=== 2."), SCRIPT.indexOf("\\echo '=== 3."))
    expect(s2).toContain(`-- >>> NUME-NOI ${X}`)
    const fl = s2.slice(s2.indexOf('folosite(oid) AS (VALUES'), s2.indexOf('gasite(f) AS ('))
    const fol = [...fl.matchAll(/to_regprocedure\('([^']+)'\)::oid/g)].map(m => m[1].replace(/^public\./, '').replace(/ /g, '').replace('public.sms_loturi', 'sms_loturi'))
    expect([...fol].sort()).toEqual([...folosite()].sort())
    expect(nr(SCRIPT, "\\echo '=== ")).toBe(3)
  })
  it('scriptul, secțiunea 2 (r4 / r5): UN rând de SEMNALE — refuzurile (DEFINER, limbaj) și semnalele (SQL dinamic, nume cu schemă, vederi, limbaje)', () => {
    const s2 = SCRIPT.slice(SCRIPT.indexOf("\\echo '=== 2."), SCRIPT.indexOf("\\echo '=== 3."))
    for (const c of ['functii_in_lant', 'refuz_definer_fara_search_path', 'refuz_limbaj_neanalizabil', 'semnal_sql_dinamic_in_lant', 'semnal_nume_noi_in_afara_listei',
                     'semnal_vederi_citite_de_lant', 'semnal_alt_limbaj_decat_sql_plpgsql', 'folosite_lipsa']) expect(s2).toContain(`AS ${c}`)
    // numele găsite se afișează CU SCHEMA și semnătura (nu regprocedure, care ascunde schema din search_path)
    expect(s2).toContain("p.pronamespace::regnamespace::text || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'")
    // vederile: după nume în corpurile lanțului + pg_depend (BEGIN ATOMIC)
    expect(s2).toContain("c.relkind IN ('v', 'm')")
    expect(SCRIPT.indexOf('\\x on')).toBeLessThan(SCRIPT.indexOf("\\echo '=== 2."))
    expect(SCRIPT.indexOf('\\x off')).toBeGreaterThan(SCRIPT.indexOf('AS folosite_lipsa'))
    // interogarea secțiunii se termină la primul „;” de la capăt de rând (proba PGlite o extrage așa)
    const q = s2.slice(s2.indexOf('\n') + 1)
    expect(q.indexOf(';\n')).toBe(q.indexOf('AS folosite_lipsa;') + 'AS folosite_lipsa'.length)
  })
})

// r4 (review r3, P1): închiderea nu traversează vederile; blocul rămâne identic cu 20261221a, garanția = runnerul cu amprenta GLOBALĂ
describe('20261220a r4 — livrare doar prin runnerul L15 v2 (amprenta globală)', () => {
  it('antetul spune: DOAR prin runnerul cu amprenta globală, manifestul .l15.tsv îl adaugă coordonatorul, limita vederilor = S44', () => {
    const antet = MIG.slice(0, MIG.indexOf('DO $pre$'))
    expect(antet.split('\n')[1]).toContain('DOAR prin runnerul cu amprenta GLOBALĂ L15 v2')
    expect(antet).toContain('20261220a_sms_numere_serviciu.l15.tsv')
    expect(antet).toContain('NU urmărește funcțiile chemate prin')
    expect(antet).toContain('S44')
    // blocul închiderii NU traversează vederile (identic cu 20261221a, testul L19 de mai sus)
    expect(blocuri(MIG, IA, IB)[0]).not.toMatch(/relkind|pg_rewrite/)
  })
  // PR-ul de baseline (coordonatorul, după ce runnerul L15 v2 a ajuns pe main): manifestul stă lângă migrare și e legat de ea prin sha256
  it('manifestul .l15.tsv e în repo, generat cu EXACT migrarea din repo, cu obiectele declarate ale migrării', () => {
    const MAN = citeste('supabase/migrations/20261220a_sms_numere_serviciu.l15.tsv')
    const antet = MAN.split('\n').filter(l => l.startsWith('#'))
    expect(antet[0]).toContain('manifestul diferentelor pentru 20261220a_sms_numere_serviciu (AMPRENTA_GLOBALA v2)')
    // o migrare schimbată după generarea manifestului (inclusiv blocul BASELINE) = test picat: manifestul se regenerează pe clonă
    expect(antet[1]).toContain('migrarea sha256 ' + createHash('sha256').update(MIG, 'utf8').digest('hex'))
    const randuri = MAN.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'))
    expect(antet[antet.length - 1]).toContain(`; ${randuri.length} obiecte`)
    for (const r of randuri) {
      expect(r).toHaveLength(4)
      expect(r[1].startsWith(r[0] + ' ')).toBe(true)
      expect(['creat', 'schimbat', 'sters']).toContain(r[2])
      expect(r[3]).toMatch(r[2] === 'sters' ? /^-$/ : /^[0-9a-f]{32}$/)
      // doar obiecte SMS din `public`: tabelul nou (cu tipurile, secvența, indecșii, constrângerile, triggerul lui), funcțiile SMS și
      // constrângerea CHECK lărgită de pe sms_mesaje — nimic din alt modul, nicio schemă a platformei
      expect(r[1]).toMatch(/\bpublic\.(sms_|fn_sms_|ux_sms_)/)
    }
    const op = Object.fromEntries(randuri.map(r => [r[1], r[2]]))
    expect(Object.keys(op)).toHaveLength(randuri.length)
    // ce NU e creare: exact funcția înlocuită (4 parametri ștearsă, 5 creată), lista fixată și constrângerea CHECK a destinatarului
    expect(randuri.filter(r => r[2] !== 'creat').map(r => r[2] + ' ' + r[1]).sort()).toEqual([
      'schimbat constrangere tabel public.sms_mesaje.sms_mesaje_destinatar_tip_check',
      'schimbat functie public.fn_sms_lot_destinatari(uuid)',
      'sters functie public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)',
    ])
    expect(op['functie public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])']).toBe('creat')
    expect(op['relatie public.sms_numere_serviciu']).toBe('creat')
    // nicio politică și niciun drept implicit: tabelul nou se citește / scrie doar prin funcțiile DEFINER
    expect(randuri.filter(r => ['politica', 'acl_implicit', 'schema', 'rol', 'extensie'].includes(r[0]))).toEqual([])
  })
})

// r5 (review r4, P2): documentul livrării — o singură fotografie la citire, pașii coordonatorului, trimiteri (nu copii) la L15 v2
describe('20261220a r5 — documentul livrării (docs/sms/LIVRARE_20261220a_NUMERE_SERVICIU.md)', () => {
  const DOC = citeste('docs/sms/LIVRARE_20261220a_NUMERE_SERVICIU.md')
  const pasi = DOC.slice(DOC.indexOf('## 4. Pașii coordonatorului'), DOC.indexOf('## 5.'))
  it('migrarea și scriptul trimit la document; documentul trimite la docs/LIVRARE_L15_V2.md pentru comenzi', () => {
    expect(MIG.slice(0, MIG.indexOf('DO $pre$'))).toContain('docs/sms/LIVRARE_20261220a_NUMERE_SERVICIU.md')
    expect(SCRIPT).toContain('docs/sms/LIVRARE_20261220a_NUMERE_SERVICIU.md')
    expect(nr(DOC, 'docs/LIVRARE_L15_V2.md')).toBeGreaterThanOrEqual(3)
    expect(DOC).toContain('Aplicarea fără amprenta globală NU e acceptată.')
    expect(DOC).toMatch(/Runnerul L15 v2 e pe\s+`main`/)
    // baseline-ul completat (PR-ul de baseline): documentul îl consemnează, cu acceptarea pe nume a fiecărui semnal
    expect(DOC).toContain('## 6. Baseline-ul: citirea pe producție')
    expect(DOC).toContain('**SEMNALE acceptate: EXECUTE dinamic 0 · vederi 0 · alt limbaj 4')
    for (const s of ['nume_care', 'vederi_care', 'sql_dinamic_care', 'limbaj_care']) expect(DOC.slice(DOC.indexOf('### 6.2'))).toContain(`\`${s}\``)
  })
  // 14.11.2026 — derogarea punctuală (secțiunea 7): pe producție amprenta globală nu încape în plafonul migrării, deci verificarea globală
  // se face în afara tranzacției. Documentul trebuie s-o spună EXPLICIT (antetul migrării, fixat prin sha256, spune în continuare contrariul),
  // doar pentru artefactul din acest PR, cu riscurile, condițiile și uneltele ei — nu ca relaxare a regulii.
  it('derogarea „calea A”: explicită, doar pentru migrarea și manifestul din acest PR, cu riscuri, condiții, repetiție și unelte fixate', () => {
    const inceput = DOC.slice(0, DOC.indexOf('## 1.'))
    expect(inceput).toContain('**Excepție — o singură dată, doar pentru acest artefact: derogarea din secțiunea 7')
    expect(inceput).toContain('Nu e o relaxare generală a L15 v2.')
    const i7 = DOC.indexOf('\n## 7. Derogarea punctuală de la L15 v2')
    expect(i7).toBeGreaterThan(DOC.indexOf('## 6. Baseline-ul'))
    const d7 = DOC.slice(i7)
    expect(d7).toContain('derogă **explicit** de la această interdicție, **doar pentru acest artefact**')
    expect(d7).toContain('**Nu e o relaxare generală a L15 v2**')
    // artefactul = EXACT migrarea și manifestul din repo (primele 8 și ultimele 4 cifre ale sha256-ului fiecăruia)
    const scurt = t => { const h = createHash('sha256').update(t, 'utf8').digest('hex'); return `\`${h.slice(0, 8)}…${h.slice(-4)}\`` }
    expect(d7).toContain('migrarea cu sha256 ' + scurt(MIG))
    expect(d7).toContain('manifestul cu\nsha256 ' + scurt(citeste('supabase/migrations/20261220a_sms_numere_serviciu.l15.tsv')))
    const titluri = ['### 7.1 De ce: ce s-a măsurat pe producție', '### 7.2 Ce se face în loc', '### 7.3 Ce se pierde față de L15 v2 (riscuri acceptate)',
      '### 7.4 Repetiția pe clonă', '### 7.5 Uneltele coordonatorului', '### 7.6 Jurnalul livrării', '### 7.7 Acordul și verdictul', '### 7.8 În afara acestei derogări']
    let j = -1
    for (const t of titluri) { const k = d7.indexOf('\n' + t); expect(k, t).toBeGreaterThan(j); j = k }
    // ce rămâne obligatoriu: verificările migrării în tranzacție, mulțimea exactă (nu numărul), „aplicat, neverificat” fără reluare,
    // fereastra fără activitate SMS, o probă cu ROLLBACK pe calea simplă, acordul explicit al owner-ului
    for (const t of ['cele 53 de rânduri de baseline „înainte” și „după”', '**exact mulțimea** din manifest', 'Numărul singur (32) nu ajunge',
      '**„aplicat, neverificat”**: migrarea NU se reia', 'fără trimiteri de SMS din ecranul vechi', '**O probă cu ROLLBACK pe producție, pe calea simplă**',
      'garda finală cel mult 1.500 ms', '**octet cu octet** cea clasificată', 'doar cu „da”-ul lui explicit, pe manual']) expect(d7, t).toContain(t)
    // riscurile acceptate, toate patru
    for (const t of ['**Refuzul atomic.**', '**Atribuirea sub concurență.**', '**Schimbarea temporară.**', '**Revenirea repară doar ce prevede ea.**']) expect(d7, t).toContain(t)
    // uneltele: cinci amprente sha256 întregi ale uneltelor inspectate + două ale celor suplimentare (lansatorul, controlul); nicio cale de server
    const d75 = d7.slice(d7.indexOf('### 7.5'), d7.indexOf('### 7.6'))
    expect((d75.match(/`[0-9a-f]{64}`/g) || []).length).toBe(7)
    expect(new Set(d75.match(/`[0-9a-f]{64}`/g)).size).toBe(7)
    expect(DOC).not.toMatch(/[A-Za-z]:[\\/](Users|ProgramData)[\\/]/)
    // după inspecția uneltelor finale: commitul livrat e numit (40 de cifre) și deosebit de capul PR-ului; jurnalul repetiției e identificat
    // prin sha256; numărătoarea mutanților e cea reală (un martor + 19 mutanți); limitele uneltelor și felul în care se acoperă sunt scrise;
    // seria veche de trei probe e înlocuită explicit, nu lăsată alături
    expect(d7).toMatch(/\*\*Commitul livrat\*\* — cel repetat pe clonă — este\s+`[0-9a-f]{40}`/)
    expect(d7).toMatch(/`repetitie_a_r3\.log`, sha256 `[0-9a-f]{64}`/)
    expect(d7).toContain('un martor nealterat, acceptat, și 19 mutanți, toți refuzați cu codul așteptat')
    for (const t of ['**Configurația obligatorie.**', '**Verificatorul nu e un validator strict pentru orice fișier.**',
      '**Codul 0 al wrapperului nu certifică singur observatorul și controlul funcțiilor expuse.**',
      'livrarea se încheie doar cu diferența exact manifestul **și** controlul\n  funcțiilor expuse curat']) expect(d75 + d7.slice(d7.indexOf('### 7.7')), t).toContain(t)
    const d64 = DOC.slice(DOC.indexOf('### 6.4'), i7)
    expect(d64).toContain('seria de **trei probe consecutive** — e\nînlocuit de secțiunea 7')
    expect(d64).toContain('se face **o singură** probă cu ROLLBACK, pe calea simplă')
    // pașii 5 și 6 din secțiunea 4 trimit la derogare (fără să dispară)
    expect(nr(pasi, '*(Pentru acest artefact: înlocuit de secțiunea 7')).toBe(2)
  })
  it('pașii 1–8 în ordine: citirea într-o SINGURĂ fotografie (script + GLOBAL + rădăcini), acceptarea nominală, manifestul, clona, ROLLBACK, aplicarea, REST, merge', () => {
    const titluri = ['**Citirea pe producție, într-o SINGURĂ fotografie.**', '**PR-ul de baseline: acceptarea NOMINALĂ a semnalelor.**', '**Manifestul**',
      '**Pe clonă, cu runnerul nou:**', '**Proba cu ROLLBACK pe țintă**', '**Aplicarea pe producție prin runner**', "După COMMIT: `NOTIFY pgrst, 'reload schema';`", '**Merge**']
    let j = -1
    titluri.forEach((t, i) => {
      const k = pasi.indexOf(`\n${i + 1}. ${t}`)
      expect(k, t).toBeGreaterThan(j)
      j = k
    })
    expect(pasi).toContain('--amprente-migrare scripts/sms_numere_serviciu_amprente.sql')
    expect(pasi).toContain('`--radacina …`')
    expect(pasi).toContain('**Nu** se rulează scriptul de\n   amprente separat')
    expect(pasi).toContain('20261220a_sms_numere_serviciu.l15.tsv')
    expect(pasi).toContain('refuz la «înainte»')
    expect(pasi).toContain('HTTP 400 și\n   SQLSTATE 22023')
    expect(pasi).toContain('{total, numere}')
    for (const s of ['nume_care', 'vederi_care', 'sql_dinamic_care', 'limbaj_care']) expect(pasi).toContain(`\`${s}\``)
    // comenzile runnerului NU se copiază aici (se pot schimba în PR-ul lui)
    expect(DOC).not.toMatch(/livrare_l15_manifest\.sh|l15_compara_liste\.sh|--amprenta-globala|--diferente-globale|--aprobare/)
  })
  it('rădăcinile porților = pornirea închiderii din script (fără varianta cu 5 parametri, care nu există la citire), fiecare cu schema', () => {
    const inch = faraComentarii(blocuri(SCRIPT, IA, IB)[0])
    const pornire = inch.slice(inch.indexOf('amp_pornire(oid) AS ('), inch.indexOf('amp_lant(oid) AS ('))
    const din = [...pornire.matchAll(/to_regprocedure\('([^']+)'\)::oid/g)].map(m => m[1].replace(/ /g, ''))
      .filter(s => s !== 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])')
    const sect = DOC.slice(DOC.indexOf('## 2. Rădăcinile'), DOC.indexOf('## 3.'))
    const lista = sect.slice(0, sect.indexOf('plus funcțiile din politicile'))
    const rad = [...lista.matchAll(/`((?:public|auth)\.[a-z_]+\([^`]*\))`/g)].map(m => m[1])
    expect([...rad].sort()).toEqual([...din].sort())
    for (const f of ['public.fn_sms_e_owner()', 'public.fn_sms_loturi_reguli()', 'public.fn_sms_mesaje_reguli()']) expect(sect).toContain(`\`${f}\``)
  })
  it('regula r5 și limitele: SQL dinamic = semnal (supra-aproximare), S39 / S44 refuzate de runner, regula DEFINER nu e dovedită de migrare', () => {
    expect(DOC).toContain('Migrarea NU mai refuză pe cuvântul `EXECUTE`')
    expect(DOC).toContain('**supra-aproximare**')
    expect(DOC).toContain('e deci **a\nrunnerului**, nu a migrării')
    expect(DOC).toContain('**nu** un test PGlite al acestui PR')
    expect(DOC).toContain('**„are `search_path` propriu” NU dovedește\ncă numele se rezolvă sigur.**')
    expect(DOC).toContain('`pg_temp` prezent explicit și **ULTIMUL**')
    expect(DOC).not.toMatch(/[A-Z]:\\|\\\\gazpet|paw-data|Users[\\/]/i)
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
  const T = ['--ip', '192.0.2.10', '--port', '5432']   // adresă de documentație (RFC 5737), nu o gazdă reală
  it('refuză ÎNAINTE de conexiune: fără „--” / --sistem / --ip / --port (2), mutant necunoscut (2), gazdă Supabase (22)', () => {
    expect(ruleaza('--sistem', '1').status).toBe(2)
    expect(ruleaza('--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', '--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', '--ip', '192.0.2.10', '--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', '--port', '5432', '--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', '--ip', 'clona.exemplu', '--port', '5432', '--', '-h', 'clona').status).toBe(2)
    expect(ruleaza('--sistem', '1', ...T, '--mutant', 'altul', '--', '-h', 'clona').status).toBe(2)
    const r = ruleaza('--sistem', '1', ...T, '--', '-h', 'db.exemplu.supabase.co')
    expect(r.status).toBe(22)
    expect(r.stderr).toContain('proba rulează doar pe clonă')
  })
  it('garda țintei: capătul EFECTIV văzut de server (inet_server_addr / inet_server_port), apoi system_identifier + PG17, în PRIMA interogare; starea de plecare: aplicată, tabel gol', () => {
    const iMain = S.indexOf('async function main()')
    const iPrimaQ = S.indexOf('await unu(', iMain)
    const iCapat = S.indexOf('if (ip !== IP || port !== PORT)', iMain)
    const iSis = S.indexOf('if (sis !== SISTEM)', iMain), iVer = S.indexOf('cere PostgreSQL 17', iMain)
    const iPrimaScriere = S.indexOf('const prep = await caOwner', iMain)
    expect(S.slice(iPrimaQ, iCapat)).toContain("coalesce(host(inet_server_addr()), 'socket'), coalesce(inet_server_port(), current_setting('port')::integer)")
    expect(iCapat).toBeGreaterThan(iPrimaQ)
    expect(iSis).toBeGreaterThan(iCapat)
    expect(iVer).toBeGreaterThan(iSis)
    expect(iPrimaScriere).toBeGreaterThan(iVer)
    expect(S.slice(iMain, iPrimaScriere)).toContain("if (stTab !== '0 0 O')")
  })
  it('r4: curățenia șterge DOAR rândurile proprii (id + denumire), sub ACCESS EXCLUSIVE; secvența doar dacă rândurile = plecarea; final rând cu rând', () => {
    expect(S).not.toMatch(/LIKE 'Proba concurenta %'/)
    const c = S.slice(S.indexOf('export function sqlCuratenie'), S.indexOf('const ESTE_MAIN'))
    const iLock = c.indexOf('LOCK TABLE public.sms_numere_serviciu IN ACCESS EXCLUSIVE MODE;')
    const iDel = c.indexOf('DELETE FROM public.sms_numere_serviciu s USING unnest(')
    const iSeq = c.indexOf('setval(')
    expect(iLock).toBeGreaterThan(0)
    expect(iDel).toBeGreaterThan(iLock)
    expect(c).toContain('WHERE s.id = p.id AND s.denumire = p.denumire')
    expect(iSeq).toBeGreaterThan(iDel)
    expect(c.slice(c.lastIndexOf('SELECT CASE WHEN', iSeq), iSeq)).toContain('${SQL_RANDURI} = ${lit(randuriPlecare)}')
    expect(S).toContain("for (const k of ['fn', 'tab', 'seq', 'randuri'])")
    expect(S).toContain("md5(row(s.*)::text)")
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
    for (const t of [MIG, REV, SCRIPT, citeste('scripts/sms_numere_serviciu_concurenta.mjs'), citeste('supabase/migrations/20261220a_sms_numere_serviciu.l15.tsv')]) {
      expect(t).not.toMatch(/[A-Z]:\\|\\\\gazpet|paw-data|Users[\\/]/i)
      // amprentele (md5 = 32, sha256 = 64 de cifre hexazecimale: blocul BASELINE, amprentele corpurilor, manifestul) nu sunt telefoane: un
      // șir de cifre din interiorul unui hash (ex. …2707405969…) nu se judecă drept număr; restul textului se verifică întreg
      const faraAmprente = t.replace(/\b(?:[0-9a-f]{64}|[0-9a-f]{32})\b/g, '<amprenta>')
      for (const m of faraAmprente.match(/(\+?40|0)7\d{2}[ .]?\d{3}[ .]?\d{3}/g) || []) expect(m.replace(/\D/g, '')).toMatch(/^(40)?0?700/)
    }
    // contraproba regulii de mai sus: un telefon real rămâne prins și lângă o amprentă; o amprentă singură nu e prinsă
    const proba = t => (t.replace(/\b(?:[0-9a-f]{64}|[0-9a-f]{32})\b/g, '<amprenta>').match(/(\+?40|0)7\d{2}[ .]?\d{3}[ .]?\d{3}/g) || [])
      .filter(m => !/^(40)?0?700/.test(m.replace(/\D/g, '')))
    expect(proba("('tabel x | acl', '95ee58415cf4aa3a2707405969598173')")).toEqual([])
    expect(proba("('tabel x | acl', '95ee58415cf4aa3a2707405969598173') -- 0722 123 456")).toEqual(['0722 123 456'])
    expect(proba('telefon 0722123456')).toEqual(['0722123456'])
  })
})
