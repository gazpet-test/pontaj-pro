// Liniile raportului zilnic și distribuția pe proiectul șantierului citit sub lock (20261217a): verificări statice ale livrării.
// (1) L15 + L19: amprenta stării de acces folosește O SINGURĂ definiție — corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql, copiat
//     octet cu octet (fără CR) în scriptul coordonatorului (scripts/raport_linii_proiect_amprente.sql) și în migrare; BASELINE într-un singur
//     bloc marcat, verificat ÎNAINTE și DUPĂ. (2) Revenirea poartă amprenta EXACTĂ a corpului fiecărei funcții din migrare. (3) r4: gărzile
//     nu așteaptă niciodată (SKIP LOCKED, același protocol în ambele, L19), mesajele spun omului ce are de făcut. (4) Scripturile pentru
//     coordonator: amprentele / datele doar citire, costul într-o tranzacție anulată; scriptul de concurență e bash valid, cu mutanții pe
//     textul real al migrării. Comportamentul: scripts/pglite/test_raport_linii_proiect_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/raport_linii_proiect_amprente.sql')
const MIG = citeste('supabase/migrations/20261217a_executie_raport_linii_proiect.sql')
const REV = citeste('supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql')
const DATE_SQL = citeste('scripts/raport_linii_proiect_verifica_date.sql')
const HARNESS = citeste('scripts/test_executie_raport_linii_proiect.sql')
const COST = citeste('scripts/raport_linii_proiect_cost.sql')
const CONC = citeste('scripts/raport_linii_proiect_concurenta.sh')
const X = '20261217a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const GARZI = ['fn_raport_lucrari_proiect_garda', 'fn_raport_distributie_proiect_garda']
// etichetele NOI ale amprentei (r4, distribuția): singurele care pot rămâne DE_COMPLETAT până le lipește coordonatorul din producție
const NOI = ['functie fn_raport_distributie_unitate_check()', 'tabel raport_distributie_linii | acl', 'tabel raport_distributie_linii | acl coloane',
  'tabel raport_distributie_linii | politici', 'tabel raport_distributie_linii | rls', 'tabel raport_distributie_linii | secvente',
  'tabel raport_distributie_linii | triggere']
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1
const faraComentarii = t => t.replace(/--[^\n]*/g, '')
const corpFunctie = (t, fn) => {
  const i = t.indexOf(`CREATE FUNCTION public.${fn}()`)
  const a = t.indexOf('AS $f$', i) + 'AS $f$'.length
  return t.slice(a, t.indexOf('$f$;', a))
}
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

describe('20261217a — AMPRENTA_L15: o singură definiție (sursa = scriptul coordonatorului = migrarea)', () => {
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
  it('aceleași tabele în script și în migrare (r4: + raport_distributie_linii); pornirea = RPC-ul de salvare', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.raport_lucrari'::regclass::oid), ('public.raport_distributie_linii'::regclass::oid), ('public.rapoarte_zilnice'::regclass::oid), ('public.sites'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(intrare).toContain("to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')")
  })
  it('BASELINE într-un singur loc marcat; cele 47 de valori lipite rămân, DOAR etichetele noi pot fi DE_COMPLETAT (= refuz)', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(nr(MIG, `CREATE FUNCTION pg_temp.amp_baseline_${X}()`)).toBe(1)
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    expect(MIG).toContain(`amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_${X}() b WHERE b.eticheta LIKE 'functie %'),`)
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    linii.forEach((l, i) => expect(l).toMatch(i === 0 ? /^\('(tabel|functie) [^']+', '([0-9a-f]{32}|DE_COMPLETAT)'\)$/ : /^, \('(tabel|functie) [^']+', '([0-9a-f]{32}|DE_COMPLETAT)'\)$/))
    const perechi = linii.map(l => l.match(/\('([^']+)', '([^']+)'\)/).slice(1))
    const et = perechi.map(p => p[0])
    expect(new Set(et).size).toBe(et.length)
    // ordinea afișată de script (COLLATE "C"), ca lipirea să fie verificabilă rând cu rând
    expect([...et].sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))))).toEqual(et)
    const deCompletat = perechi.filter(p => p[1] === 'DE_COMPLETAT').map(p => p[0])
    deCompletat.forEach(e => expect(NOI).toContain(e))
    // valorile de producție lipite pe 12.11.2026 (cele 47) sunt toate acolo, cu amprentă
    expect(perechi.filter(p => !NOI.includes(p[0])).every(p => /^[0-9a-f]{32}$/.test(p[1]))).toBe(true)
    expect(perechi.filter(p => !NOI.includes(p[0]))).toHaveLength(47)
    // amprenta celor 47 de rânduri lipite în r3 (cbe75868; eticheta|valoare, în ordine) — o schimbare a lor e o schimbare de baseline, nu o completare
    expect(md5(perechi.filter(p => !NOI.includes(p[0])).map(p => p.join('|')).join('\n'))).toBe('e35ae7f488d708a10638234d61b8496a')
  })
  it('verificarea rulează ÎNAINTE (înaintea lock-urilor și a schimbării) și DUPĂ (după postcondiții), apoi funcțiile pg_temp se șterg', () => {
    const iInainte = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('inainte')`)
    const iLock = MIG.indexOf('DO $lock$')
    const iSchimbare = MIG.indexOf('CREATE FUNCTION public.fn_raport_lucrari_proiect_garda()')
    const iSchimbare2 = MIG.indexOf('CREATE FUNCTION public.fn_raport_distributie_proiect_garda()')
    const iPost = MIG.indexOf('DO $post$')
    const iDupa = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('dupa')`)
    const iDrop = MIG.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${X}(text), pg_temp.amp_calc_${X}(), pg_temp.amp_baseline_${X}();`)
    expect(iInainte).toBeGreaterThan(MIG.indexOf('DO $pre$'))
    expect(iLock).toBeGreaterThan(iInainte)
    expect(iSchimbare).toBeGreaterThan(iLock)
    expect(iSchimbare2).toBeGreaterThan(iSchimbare)
    expect(iPost).toBeGreaterThan(iSchimbare2)
    expect(iDupa).toBeGreaterThan(iPost)
    expect(iDrop).toBeGreaterThan(iDupa)
    expect(MIG.slice(iDrop).trim().split('\n')).toHaveLength(1)
  })
  it('excepțiile „după” sunt EXACT cele declarate: triggerul nou al fiecărui tabel + funcția lui', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    expect(f).toContain("('tabel raport_lucrari | triggere', 'trg\\_raport\\_lucrari\\_zz\\_proiect | %',")
    expect(f).toContain("'trg\\_raport\\_lucrari\\_zz\\_proiect | fn\\_raport\\_lucrari\\_proiect\\_garda() | stare=O | %'),")
    expect(f).toContain("('tabel raport_distributie_linii | triggere', 'trg\\_raport\\_distributie\\_zz\\_proiect | %',")
    expect(f).toContain("'trg\\_raport\\_distributie\\_zz\\_proiect | fn\\_raport\\_distributie\\_proiect\\_garda() | stare=O | %')),")
    expect(f).toContain("WHEN p_moment = 'dupa' AND n.eticheta IS NOT NULL THEN")
    expect(f).toContain("WHERE NOT (p_moment = 'dupa' AND c.eticheta IN ('functie fn_raport_lucrari_proiect_garda()', 'functie fn_raport_distributie_proiect_garda()'))")
    expect(nr(f, "p_moment = 'dupa'")).toBe(2)
  })
})

describe('20261217a — migrarea și revenirea', () => {
  it('migrarea NU atinge RPC-ul, funcțiile existente, datele, drepturile sau politicile (doar două funcții de trigger + două trigger-e)', () => {
    const cod = faraComentarii(MIG)
    expect(cod).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.fn_raport_zilnic_salveaza/)
    expect(cod).not.toMatch(/OR REPLACE/)
    expect(cod).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|GRANT|CREATE POLICY|ALTER POLICY|DROP POLICY|ALTER TABLE|ALTER FUNCTION)\b/i)
    expect(cod.match(/^CREATE FUNCTION public\.[a-z_]+/gm)).toEqual(GARZI.map(f => 'CREATE FUNCTION public.' + f))
    expect(cod.match(/^CREATE TRIGGER [a-z_]+/gm)).toEqual(['CREATE TRIGGER trg_raport_lucrari_zz_proiect', 'CREATE TRIGGER trg_raport_distributie_zz_proiect'])
    for (const f of GARZI) expect(cod).toContain(`REVOKE ALL ON FUNCTION public.${f}() FROM PUBLIC, anon, authenticated, service_role;`)
  })
  it('r4 (L06 / L19): ambele gărzi iau rândul raportului apoi al șantierului FĂRĂ AȘTEPTARE, cu aceeași instrucțiune, înaintea verificărilor', () => {
    const lock = '    FROM public.rapoarte_zilnice r JOIN public.sites s ON s.id = r.site_id\n'
    const fin = '   WHERE r.id = NEW.raport_id\n     FOR SHARE OF r, s SKIP LOCKED;\n  IF NOT FOUND THEN\n'
      + '    -- raport inexistent: refuzul îl dă cheia străină (23503); altfel raportul / șantierul e ținut acum de altă tranzacție\n'
      + '    IF NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.id = NEW.raport_id) THEN RETURN NEW; END IF;\n'
      + "    RAISE EXCEPTION 'raport: raportul se salvează sau șantierul lui se mută chiar acum; reîncearcă peste câteva secunde (nimic salvat)'\n"
      + "      USING ERRCODE = '55P03';\n  END IF;\n"
    for (const f of GARZI) {
      const corp = corpFunctie(MIG, f)
      expect(nr(corp, lock)).toBe(1)
      expect(nr(corp, fin)).toBe(1)
      expect(corp.indexOf(fin)).toBeGreaterThan(corp.indexOf(lock))
      // nicio așteptare: fiecare FOR SHARE din corp e SKIP LOCKED; niciun bloc EXCEPTION (sub-tranzacție pe fiecare linie); niciun NOWAIT
      expect(corp.match(/FOR (KEY )?SHARE|FOR (NO KEY )?UPDATE/g)).toEqual(['FOR SHARE'])
      expect(corp).not.toMatch(/\bEXCEPTION\s+WHEN\b/)
      expect(corp).not.toMatch(/NOWAIT|pg_sleep|pg_advisory/)
      // verificările vin DUPĂ citirea sub lock; o singură citire a șantierului pe rând
      expect(corp.indexOf('IS DISTINCT FROM v_proiect')).toBeGreaterThan(corp.indexOf(fin))
      expect(nr(corp, 'public.sites')).toBe(1)
    }
    expect(corpFunctie(MIG, GARZI[0]).indexOf('IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN')).toBeGreaterThan(0)
  })
  it('r4 (P2): mesajele de refuz spun ce s-a întâmplat și ce are omul de făcut', () => {
    const mesaje = [...MIG.matchAll(/RAISE EXCEPTION '(raport: [^']+)'/g)].map(m => m[1])
    expect(mesaje).toHaveLength(6)
    for (const m of mesaje) expect(m).toMatch(/reîncarcă raportul și salvează din nou$|reîncearcă peste câteva secunde \(nimic salvat\)$/)
    for (const c of ['activitatea', 'obiectul', 'tronsonul']) {
      expect(mesaje.some(m => m.startsWith(`raport: ${c} % `) && m.includes('e din alt proiect decât cel în care e acum șantierul raportului'))).toBe(true)
    }
    // mesajul principal rămâne cel căutat de probe (harness T2 / T4, concurență L1 / L5c)
    expect(MIG).toContain("'raport: linia e pentru proiectul %, dar șantierul raportului e acum în alt proiect (%); reîncarcă raportul și salvează din nou'")
  })
  it('revenirea poartă amprenta exactă a corpului fiecărei funcții din migrare (md5 pe textul dintre $f$ … $f$)', () => {
    for (const [f, et] of [[GARZI[0], 'garda liniilor'], [GARZI[1], 'garda distributiei']]) {
      const m = new RegExp(`-- AMPRENTA-START ${et}\\n\\s*'([0-9a-f]{32})',\\n\\s*-- AMPRENTA-END ${et}\\n`).exec(REV)
      expect(m && m[1]).toBe(md5(corpFunctie(MIG, f)))
    }
  })
  it('revenirea: marcajul runnerului cu numele ei, plafonul, starea verificată și fără lock și sub lock (ambele tabele), apoi DROP', () => {
    expect(REV).toContain("IS DISTINCT FROM '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current()")
    expect(REV).toContain("v_plafon IS DISTINCT FROM '2000/session'")
    expect(REV).toContain('FOR v_pas IN 1 .. 2 LOOP')
    const iL = REV.indexOf('LOCK TABLE public.raport_lucrari IN ACCESS EXCLUSIVE MODE;')
    const iD = REV.indexOf('LOCK TABLE public.raport_distributie_linii IN ACCESS EXCLUSIVE MODE;')
    expect(iL).toBeGreaterThan(0)
    expect(iD).toBeGreaterThan(iL)
    expect(REV.indexOf('DROP TRIGGER trg_raport_lucrari_zz_proiect')).toBeGreaterThan(iD)
    expect(REV.indexOf('DROP TRIGGER trg_raport_distributie_zz_proiect')).toBeGreaterThan(iD)
    // definițiile trigger-elor verificate de revenire = cele din postcondițiile migrării
    for (const t of ['trg_raport_lucrari_zz_proiect', 'trg_raport_distributie_zz_proiect']) {
      const def = new RegExp(`'(CREATE TRIGGER ${t} [^']+)'`)
      expect(def.exec(REV)[1]).toBe(def.exec(MIG)[1])
    }
  })
  it('harness-ul: defectul reprodus ÎNAINTE de migrare, apoi aplicarea, testele (r4: + T4d distribuția), revenirea, re-aplicarea; tranzacția anulată', () => {
    const iT1 = HARNESS.indexOf('-- ── T1: ÎNAINTE de migrare')
    const iMig = HARNESS.indexOf('\\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql')
    expect(iT1).toBeGreaterThan(0)
    expect(iMig).toBeGreaterThan(iT1)
    for (const t of ['T2', 'T3', 'T4', 'T4d', 'T5', 'T6']) expect(HARNESS.indexOf(`-- ── ${t}`)).toBeGreaterThan(iMig)
    expect(nr(HARNESS, '\\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql')).toBe(2)
    expect(HARNESS.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(HARNESS).not.toMatch(/^COMMIT;$/m)
    // trigger-ul vechi al tronsonului e oprit DOAR într-un savepoint anulat imediat
    const iS = HARNESS.indexOf('SAVEPOINT t4d;'), iA = HARNESS.indexOf('ALTER TABLE public.raport_distributie_linii DISABLE TRIGGER'), iR = HARNESS.indexOf('ROLLBACK TO SAVEPOINT t4d;')
    expect(iS).toBeGreaterThan(0)
    expect(iA).toBeGreaterThan(iS)
    expect(iR).toBeGreaterThan(iA)
    expect(nr(HARNESS, 'DISABLE TRIGGER')).toBe(1)
  })
})

describe('scripturile pentru coordonator', () => {
  for (const [nume, t] of [['amprentele', SCRIPT], ['datele', DATE_SQL]]) {
    it(`${nume}: o tranzacție READ ONLY, încheiată cu ROLLBACK, fără scrieri`, () => {
      expect(t).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
      expect(t.trim().endsWith('ROLLBACK;')).toBe(true)
      const fara = faraComentarii(t)
      expect(fara).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMIT)\b/i)
    })
  }
  it('scriptul de date: garda țintei înaintea oricărei citiri de date', () => {
    expect(DATE_SQL.indexOf("RAISE EXCEPTION 'REFUZ: system_identifier")).toBeLessThan(DATE_SQL.indexOf('FROM public.rapoarte_zilnice'))
  })
  it('r4 (P2) scriptul de cost: garda țintei înaintea oricărei scrieri, o tranzacție anulată, corpul r3 = exact cel din r3 (amprenta)', () => {
    expect(COST.indexOf("RAISE EXCEPTION 'REFUZ: system_identifier")).toBeLessThan(COST.indexOf('CREATE OR REPLACE FUNCTION'))
    expect(COST.indexOf("RAISE EXCEPTION 'REFUZ: system_identifier")).toBeLessThan(COST.indexOf('INSERT INTO'))
    expect(COST.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(faraComentarii(COST)).not.toMatch(/\bCOMMIT\b/i)
    const i = COST.indexOf('CREATE OR REPLACE FUNCTION public.fn_raport_lucrari_proiect_garda()')
    const a = COST.indexOf('AS $f$', i) + 'AS $f$'.length
    expect(md5(COST.slice(a, COST.indexOf('$f$\n', a)))).toBe('27c216e9e8952b8b63acc88acae6e802')
    expect(COST).toContain('FOREACH n IN ARRAY ARRAY[50, 200, 500] LOOP')
  })
})

describe('scriptul de concurență (clonă)', () => {
  const cale = fileURLToPath(new URL('../scripts/raport_linii_proiect_concurenta.sh', import.meta.url))
  it('bash valid (bash -n), fără shebang CRLF, cu garda țintei înaintea oricărei scrieri', () => {
    const r = spawnSync('bash', ['-n', cale], { encoding: 'utf8' })
    if (r.error) return   // fără bash pe mașină: doar verificările de text
    expect(r.status, r.stderr).toBe(0)
    const t = readFileSync(cale, 'utf8')
    expect(t.includes('\r')).toBe(false)
    expect(t.indexOf('REFUZ: system_identifier')).toBeLessThan(t.indexOf('INSERT INTO public.proiect_activitati'))
    expect(t).toContain("trap 'curata || exit 25' EXIT")
  })
  it('r2: fereastra se deschide pe lock-uri observate, nu pe timp; proba nefuncțională are ieșirea ei', () => {
    const t = CONC
    expect(t).toMatch(/v_c = ANY \(pg_blocking_pids\(a\.pid\)\)/)
    expect(t).toContain("a.application_name = 'rlp17_$1_s'")
    expect(t.match(/pg_sleep\(([^)]*)\)/g).every((s) => s === 'pg_sleep(0.05)')).toBe(true)
    expect(t).not.toMatch(/salvarea nu a asteptat la activitate/)
    expect(t).toContain('verdict NEFUNCTIONAL')
    expect(t).toMatch(/^\s*exit 26$/m)
    expect(t).toContain('--verifica-bariera) VERIFICA=1')
    expect(t).toContain('salvare B0 172170001 2001-02-01 0 ROLLBACK')
  })
  it('r3: fiecare buclă care citește pg_stat_activity reia lista sesiunilor la fiecare pas', () => {
    const t = CONC
    const bucle = [...t.matchAll(/LOOP\n([\s\S]*?)END LOOP/g)].map((m) => m[1]).filter((b) => b.includes('FROM pg_stat_activity'))
    expect(bucle.length).toBe(3)   // observatorul salvării (L1, L2, L4, L6, L8, B0) + controlul L6 / L8 + mutarea în zbor (L3, L5, L7)
    expect(nr(t, 'FROM pg_stat_activity')).toBe(bucle.reduce((s, b) => s + nr(b, 'FROM pg_stat_activity'), 0) + 1)
    for (const b of bucle) {
      expect(b.indexOf('PERFORM pg_stat_clear_snapshot();')).toBeGreaterThanOrEqual(0)
      expect(b.indexOf('PERFORM pg_stat_clear_snapshot();')).toBeLessThan(b.indexOf('FROM pg_stat_activity'))
    }
  })
  it('mutanții au scenariile lor și strică textul REAL al migrării (fiecare „din” există în corpul funcției vizate)', () => {
    const t = CONC
    expect(t).toContain('fara_comparatie) fereastra L1 2001-02-01 0 172170011 172170012 inchis_activitate')
    expect(t).toContain('fara_comparatie) dupa_mutare L5c 2001-02-11 defect')
    expect(t).toContain('fara_verificare) fereastra L1 2001-02-01 0 172170011 172170012 defect')
    expect(t).toContain('fara_for_share) directa L3 2001-02-03 "$INS_L3" proiecte_linii 172170031 172170032 defect')
    expect(t).toContain('distributie_fara_lock) directa L7 2001-02-10 "$INS_L7" proiecte_distributie 172170071 172170072 defect')
    expect(t).toContain('cu_asteptare) cu_salvarea L6u 2001-02-07 "$UPD_L6" NULL 172170061 172170062 defect')
    expect(t).toContain('cu_salvarea L8 2001-02-12 "$UPD_L8" "$DISTRIB" 172170081 172170082 defect')
    const strica = [...t.matchAll(/strica (fn_[a-z_]+) ((?:'[^']+' '[^']*' ?\\?\n?\s*)+)/g)]
    expect(strica.length).toBe(6)
    for (const [, fn, perechi] of strica) {
      const din = [...perechi.matchAll(/'([^']+)' '[^']*'/g)].map(m => m[1])
      expect(din.length).toBeGreaterThan(0)
      for (const d of din) expect(corpFunctie(MIG, fn), `${fn}: ${d}`).toContain(d)
    }
    // fragmentele căutate în NOTICE-uri sunt exact cele din mesajele migrării
    for (const f of ['șantierul raportului e acum în alt proiect', 'reîncearcă peste câteva secunde', 'de pe linie e din alt proiect decât cel în care e acum șantierul raportului']) {
      expect(t).toContain(f)
      expect(MIG).toContain(f)
    }
    // L6: deadlock = orice 40P01; închis = salvarea trecută + refuz 55P03 sub 1 s
    expect(t).toContain('if grep -q "40P01" "$TMP/${sc}_s.log" "$TMP/${sc}_m.log"; then')
    expect(t).toContain('grep -Eq "$sc DIRECT refuz 55P03 .* dupa 00:00:00\\." "$TMP/${sc}_m.log"')
    expect(t).toContain('if [ "$DEFECT_VAZUT" = 1 ] && [ "$CONTRAR" = 0 ]; then echo "MUTANT $MUTANT PRINS"; exit 0; fi')
  })
  it('zilele de test (01 … 12) la fel în verificarea de start și în curățenie; fiecare scenariu în interval', () => {
    const t = CONC
    expect(nr(t, "DATE '2001-02-01' AND DATE '2001-02-12'")).toBe(2)
    const zile = [...t.matchAll(/2001-02-(\d\d)/g)].map(m => Number(m[1]))
    expect(zile.every(z => z >= 1 && z <= 12)).toBe(true)
    // fiecare zi folosită de un singur scenariu (în afară de L1 / B0, care nu se suprapun: B0 rulează singur)
    const scen = [...t.matchAll(/(?:fereastra|directa|dupa_mutare|cu_salvarea) (L\w+) 2001-02-(\d\d)/g)].map(m => [m[1], m[2]])
    const pe = {}
    for (const [s, z] of scen) { (pe[z] = pe[z] || new Set()).add(s) }
    expect(Object.values(pe).every(s => s.size === 1)).toBe(true)
  })
})
describe('harness-ul SQL: un caz pe care îl vede DOAR comparația (r3)', () => {
  it('T4 are blocul „doar comparatia” (proiect NULL, UPDATE proiect_id) separat de „doar verificarea activitatii”', () => {
    const i = HARNESS.indexOf('T4 FAIL: doar comparatia'), j = HARNESS.indexOf('T4 FAIL: doar verificarea activitatii')
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
    const bloc = HARNESS.slice(HARNESS.lastIndexOf('-- r3: cazurile pe care le vede DOAR comparația', i), i)
    expect(bloc).toContain('VALUES (%s, NULL, %s, 1)')
    expect(bloc).toContain('UPDATE public.raport_lucrari SET proiect_id = %s WHERE raport_id = %s')
  })
})
