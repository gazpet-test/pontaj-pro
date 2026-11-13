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

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/sms_numere_serviciu_amprente.sql')
const MIG = citeste('supabase/migrations/20261220a_sms_numere_serviciu.sql')
const REV = citeste('supabase/revenire/20261220a_sms_numere_serviciu_ROLLBACK.sql')
const B30 = citeste('supabase/migrations/20261130b_sms_acces_modul.sql')
const X = '20261220a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
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
const nivelSus = t => faraComentarii(t).replace(/\$(fn|amp|bl|vf|acl|pre|post|lock|l15_inainte|l15_dupa|revenire)\$[\s\S]*?\$\1\$/g, '$$…$$')

describe('20261220a — AMPRENTA_L15: o singură definiție (sursa = scriptul coordonatorului = migrarea)', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic există, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('restul secțiunii scriptului (lanțul de callee, linia de baseline, atenționările) = cel din sursă', () => {
    const coada = t => t.slice(t.indexOf('amp_start(oid, sursa) AS ('), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT)).toBe(coada(SURSA))
  })
  it('aceleași tabele în script și în migrare; pornirea = cele trei funcții (crearea cu 4 parametri, lista fixată, lista angajaților)', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.sms_loturi'::regclass::oid), ('public.sms_mesaje'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    for (const f of ["'public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean)'", "'public.fn_sms_lot_destinatari(uuid)'", "'public.fn_sms_angajati_lista()'"]) expect(intrare).toContain(f)
  })
  it('scriptul coordonatorului e DOAR citire: o tranzacție READ ONLY, încheiată cu ROLLBACK, fără scrieri', () => {
    expect(SCRIPT).toContain('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(faraComentarii(SCRIPT)).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|GRANT|REVOKE|CREATE|ALTER|DROP|COMMIT)\b/i)
  })
  it('BASELINE într-un singur loc marcat: necompletat (DE_COMPLETAT = refuz) sau linii valide din script, în ordinea afișată', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    expect(nr(MIG, `CREATE FUNCTION pg_temp.amp_baseline_${X}()`)).toBe(1)
    expect(MIG).toContain(`amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_${X}() b WHERE b.eticheta LIKE 'functie %'),`)
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
    const iFinal = MIG.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${X}(text), pg_temp.amp_calc_${X}(), pg_temp.amp_baseline_${X}(), pg_temp.sms_acl_${X}(oid);`)
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
  it('excepțiile „după” sunt EXACT cele două declarate (crearea cu 4 parametri, ștearsă; lista fixată, corp nou)', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    const exc = "x.eticheta IN ('functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)')"
    expect(f).toContain(`WHERE NOT (p_moment = 'dupa' AND ${exc}))`)
    expect(f).toContain(`WHERE NOT (p_moment = 'dupa' AND ${exc.replace('x.', 'y.')}))`)
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
    expect(corp(MIG, 'CREATE FUNCTION public.fn_sms_numere_serviciu_lista(')).toMatch(/^\s*\nBEGIN\n  PERFORM public\.fn_sms_cere_nivel\(\);/)
    expect(corp(B30, 'CREATE OR REPLACE FUNCTION public.fn_sms_angajati_lista(')).toMatch(/^\s*\nBEGIN\n  PERFORM public\.fn_sms_cere_nivel\(\);/)
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

describe('20261220a — fără date sensibile în livrare (repo public)', () => {
  it('nicio cale de server, niciun telefon în afara celor fictive 0700…', () => {
    for (const t of [MIG, REV, SCRIPT]) {
      expect(t).not.toMatch(/[A-Z]:\\|\\\\gazpet|paw-data|Users[\\/]/i)
      for (const m of t.match(/(\+?40|0)7\d{2}[ .]?\d{3}[ .]?\d{3}/g) || []) expect(m.replace(/\D/g, '')).toMatch(/^(40)?0?700/)
    }
  })
})
