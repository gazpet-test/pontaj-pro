// Blocurile Task 2 (secțiunile 0–2: gărzile, funcțiile pure, tabelele). Valorile așteptate scrise de mână (L25). Sondele directe pe
// constrângeri rulează în sub-blocuri ANULATE cu session_replication_role = replica LA ORICE COMMIT (blocuri cumulative: de la Task 4 modul
// oprește triggerele USER, iar CHECK / UNIQUE / NOT NULL lovesc la fel); fiecare refuz are CONTRA-PROBA lui (aceeași scriere, singura diferență
// = valoarea refuzată) care TRECE.
import { U, sonda, ca, lit } from './baza.mjs'
import { insereaza, CAZURI, F, H } from './fixtura.mjs'
import { TABELE, TABELE_CITITE, CHECKURI, UNICE } from './inventar.mjs'
import { codDcc, numeFisierDcc, titluScurtDcc, formatValid, intervalCanonic, intervalECanonic } from '../../../src/dcc/dccCod.js'
import { intrareReala, siruriInterval, combinatiiFormator, generator } from '../../../src/dcc/dccCodSpeciale.js'

const R = { replica: true }
// refuz + contra-proba pe aceeași țintă (ambele în replica)
async function refuzSiContra(db, A, ce, sqlRau, sqlBun, cod, constrangere) {
  A.cod(await sonda(db, sqlRau, R), cod, ce, { constrangere })
  A.trece(await sonda(db, sqlBun, R), ce + ' (contra-proba)')
}
const PRIMA_COL = t => (t === 'dcc_intentii' ? 'cheie' : t === 'dcc_snapshot_revizii' ? 'snapshot_id' : 'id')

export const BLOCURI_T2 = [
  {
    nume: 't2_constrangeri', task: 2, cere: ['0', '1', '2'], fixtura: true,
    async fn(db, A) {
      const I = insereaza
      await refuzSiContra(db, A, 'trimitere_permisa = true', I('dcc_proiecte', { trimitere_permisa: 'true' }), I('dcc_proiecte'), '23514', 'dcc_proiecte_trimitere_ck')
      await refuzSiContra(db, A, 'casuta_id nenul', I('dcc_proiecte', { casuta_id: '1' }), I('dcc_proiecte'), '23514', 'dcc_proiecte_casuta_ck')
      await refuzSiContra(db, A, 'emitent aa1', I('dcc_ghid_valori', { cod: "'aa1'" }), I('dcc_ghid_valori', { cod: "'AAB'" }), '23514', 'dcc_ghid_valori_forma_ck')
      await refuzSiContra(db, A, 'interval GENERAL în ghid', I('dcc_ghid_intervale', { interval: "'GENERAL'" }), I('dcc_ghid_intervale', { interval: "'general'" }),
        '23514', 'dcc_ghid_intervale_interval_ck')
      await refuzSiContra(db, A, 'prag sub limita_inf - 1', I('dcc_serii', { limita_inf: '100', limita_sup: '199', prag_initial: '98', ultimul_ocupat: '98' }),
        I('dcc_serii', { limita_inf: '100', limita_sup: '199', prag_initial: '99', ultimul_ocupat: '99' }), '23514', 'dcc_serii_prag_ck')
      await refuzSiContra(db, A, 'document automat fără serie', I('dcc_documente', { serie_id: 'NULL' }), I('dcc_documente'), '23514', 'dcc_documente_automat_ck')
      await refuzSiContra(db, A, 'revizie cu filă ȘI anexă', I('dcc_revizii', { fila_id: '1', anexa_id: '1' }), I('dcc_revizii', { fila_id: '1' }),
        '23514', 'dcc_revizii_tinta_ck')
      // aceeași cheie canonică: primul document ANULAT (valid, fără revizii) — refuzul vine DOAR din dcc_documente_cod_uq (unicitatea nu e parțială)
      const anulat = I('dcc_documente', { stare: "'anulat'", anulat_la: 'now()', anulat_de: `'${U.OWNER}'`, motiv_anulare: "'anulat'" })
      await refuzSiContra(db, A, 'aceeași cheie ca un document anulat', [anulat, I('dcc_documente')], [anulat, I('dcc_documente', { secventa: '501' })],
        '23505', 'dcc_documente_cod_uq')
      await refuzSiContra(db, A, 'aceeași cheie ca un document activ', [I('dcc_documente'), I('dcc_documente')], [I('dcc_documente'), I('dcc_documente', { secventa: '501' })],
        '23505', 'dcc_documente_cod_uq')
      // același cod_text + limbă pe ACELAȘI contract (documente diferite: dcc_revizii_uq nu se atinge) -> refuz; pe contracte diferite -> ok
      await refuzSiContra(db, A, 'cod_text dublat pe contract', [I('dcc_revizii'), I('dcc_revizii', { document_id: '998' })],
        [I('dcc_revizii'), I('dcc_revizii', { document_id: '998', contract_id: '998' })], '23505', 'dcc_revizii_cod_uq')
      await refuzSiContra(db, A, 'intenție om fără autor', I('dcc_intentii', { autor: 'NULL' }), I('dcc_intentii'), '23514', 'dcc_intentii_autor_ck')
      await refuzSiContra(db, A, 'intenție server cu autor', I('dcc_intentii', { actor: "'server'" }), I('dcc_intentii', { actor: "'server'", autor: 'NULL' }),
        '23514', 'dcc_intentii_autor_ck')
    },
  },
  {
    nume: 't2_acces_inchis', task: 2, cere: ['2'], fixtura: true,
    async fn(db, A) {
      for (const [rol, uid] of [['anon', null], ['service_role', null], ['authenticated', U.ED], ['authenticated', U.OWNER]]) {
        for (const t of TABELE) {
          const c = PRIMA_COL(t)
          for (const [op, sql] of [['INSERT', `INSERT INTO public.${t} DEFAULT VALUES`], ['UPDATE', `UPDATE public.${t} SET ${c} = ${c} WHERE false`],
            ['DELETE', `DELETE FROM public.${t} WHERE false`], ['TRUNCATE', `TRUNCATE public.${t}`]]) {
            A.cod(await ca(db, rol, uid, sql), '42501', `${rol}${uid === U.OWNER ? '(owner)' : ''} ${op} ${t}`)
          }
          if (rol !== 'authenticated' || !TABELE_CITITE.includes(t)) A.cod(await ca(db, rol, uid, `SELECT 1 FROM public.${t} LIMIT 1`), '42501', `${rol} SELECT ${t}`)
        }
        A.cod(await ca(db, rol, uid, `SELECT nextval('public.dcc_documente_id_seq')`), '42501', `${rol} nextval pe secvența documentelor`)
      }
    },
  },
  {
    // STARE INTERMEDIARĂ (singurul rând al registrului): adevărat doar cât lipsește secțiunea 3; succesori cumulativi t3_grant + t3_rls_fixtura
    nume: 't2_select_inainte_de_politici', task: 2, cere: ['2'], cere_absent: ['3'], fixtura: true,
    async fn(db, A) {
      for (const t of TABELE_CITITE) A.cod(await ca(db, 'authenticated', U.OWNER, `SELECT 1 FROM public.${t} LIMIT 1`), '42501', `authenticated SELECT ${t} înaintea politicilor`)
    },
  },
  {
    nume: 'p_check_null_unknown', task: 2, cere: ['2'], fixtura: true,
    async fn(db, A) {
      // documentul activ 1 din fixtură: anularea cu motiv NULL / gol / spații / 501 caractere -> 23514 pe dcc_documente_anulare_ck
      const anul = m => `UPDATE public.dcc_documente SET stare = 'anulat', anulat_la = now(), anulat_de = '${U.OWNER}', motiv_anulare = ${m} WHERE id = 1`
      for (const [m, ce] of [['NULL', 'NULL'], ["''", 'gol'], ["'   '", 'spatii'], [lit('x'.repeat(501)), '501']]) {
        A.cod(await sonda(db, anul(m), R), '23514', `document anulat cu motiv ${ce}`, { constrangere: 'dcc_documente_anulare_ck' })
      }
      A.trece(await sonda(db, anul("'motiv valid'"), R), 'document anulat cu motiv valid (contra-proba)')
      const anulRev = (prin, m) => `UPDATE public.dcc_revizii SET stare_transport = 'anulata', anulata_la = now(), anulata_de = '${U.OWNER}', anulata_prin = ${prin},
        motiv_anulare = ${m} WHERE id = 3`
      A.cod(await sonda(db, anulRev("'revizie'", 'NULL'), R), '23514', 'revizie anulată cu motiv NULL', { constrangere: 'dcc_revizii_anulare_ck' })
      A.cod(await sonda(db, anulRev('NULL', "'motiv'"), R), '23514', 'revizie anulată fără anulata_prin', { constrangere: 'dcc_revizii_anulare_ck' })
      A.trece(await sonda(db, anulRev("'revizie'", "'motiv'"), R), 'revizie anulată cu motiv + prin (contra-proba)')
      A.cod(await sonda(db, insereaza('dcc_mesaje', { casuta_declarata: 'NULL' }), R), '23514', 'mesaj manual fără căsuța declarată', { constrangere: 'dcc_mesaje_manual_ck' })
      A.trece(await sonda(db, insereaza('dcc_mesaje'), R), 'mesaj manual cu căsuța declarată (contra-proba)')
    },
  },
  {
    nume: 'p_check_inventar', task: 2, cere: ['2'], fixtura: true,
    async fn(db, A) {
      // (1) catalogul = EXACT inventarul (nume + tabel), pentru CHECK și pentru UNIQUE
      const cat = async tip => (await db.query(`SELECT c.conrelid::regclass::text AS t, c.conname AS n FROM pg_constraint c
          WHERE c.contype = '${tip}' AND c.conrelid = ANY (ARRAY[${TABELE.map(t => `'public.${t}'::regclass`).join(', ')}]) ORDER BY 1, 2`)).rows
        .map(r => `${r.t.replace(/^public\./, '')}/${r.n}`).sort()
      const asteptC = CHECKURI.map(([t, n]) => `${t}/${n}`).sort()
      const asteptU = UNICE.map(([t, n]) => `${t}/${n}`).sort()
      const c = await cat('c'), u = await cat('u')
      A.ok(JSON.stringify(c) === JSON.stringify(asteptC), `CHECK-urile din catalog ≠ inventar: în plus ${c.filter(x => !asteptC.includes(x))}; lipsă ${asteptC.filter(x => !c.includes(x))}`)
      A.ok(JSON.stringify(u) === JSON.stringify(asteptU), `UNIQUE din catalog ≠ inventar: în plus ${u.filter(x => !asteptU.includes(x))}; lipsă ${asteptU.filter(x => !u.includes(x))}`)
      A.ok(new Set(CHECKURI.map(x => x[1])).size === CHECKURI.length && CHECKURI.every(x => /^N[1-6]$/.test(x[2])), 'inventarul: nume unice, o clasă N1–N6 pe fiecare')
      const I = insereaza
      // N1: o sondă pe clasă — NULL pe o coloană NOT NULL dă 23502 (nu UNKNOWN)
      A.cod(await sonda(db, I('dcc_serii', { motiv_prag: 'NULL' }), R), '23502', 'N1 motiv_prag NULL')
      // N2: NULL permis (contra), gol / spații refuzate pe coloanele text — CU EXCEPȚIA cod_scris din istoric (orice șir ≤ 200, dată brută)
      for (const [t, col, ck] of [['dcc_proiecte', 'limba_implicita', 'dcc_proiecte_limba_ck'], ['dcc_proiecte', 'adresa_dcc', 'dcc_proiecte_adresa_ck'],
        ['dcc_revizii', 'limba', 'dcc_revizii_limba_ck'], ['dcc_revizii', 'verdict', 'dcc_revizii_verdict_val_ck'], ['dcc_istoric_aparitii', 'limba', 'dcc_istoric_aparitii_limba_ck'],
        ['dcc_legaturi', 'verdict_propus', 'dcc_legaturi_verdict_ck']]) {
        // verdictul reviziei: confirmarea completă pusă, ca singura constrângere lovită să fie forma valorii
        const extra = col === 'verdict' ? { verdict_mesaj_id: '1', verdict_confirmat_de: `'${U.OWNER}'`, verdict_confirmat_la: 'now()' } : {}
        for (const v of ["''", "'   '"]) A.cod(await sonda(db, I(t, { ...extra, [col]: v }), R), '23514', `N2 ${t}.${col} = ${v}`, { constrangere: ck })
        A.trece(await sonda(db, I(t, { [col]: 'NULL' }), R), `N2 ${t}.${col} NULL (contra-proba)`)
      }
      for (const v of ["''", "'   '"]) {
        A.cod(await sonda(db, I('dcc_revizii', { anulata_prin: v, stare_transport: "'anulata'", anulata_la: 'now()', anulata_de: `'${U.OWNER}'`, motiv_anulare: "'m'" }), R),
          '23514', `N2 anulata_prin = ${v}`, { constrangere: 'dcc_revizii_anulata_prin_val_ck' })
      }
      A.cod(await sonda(db, I('dcc_proiecte', { casuta_id: '7' }), R), '23514', 'N2 casuta_id nenul', { constrangere: 'dcc_proiecte_casuta_ck' })
      for (const [col, rau, ck] of [['secventa', '0', 'dcc_istoric_aparitii_secventa_ck'], ['fila', '1000', 'dcc_istoric_aparitii_fila_ck'],
        ['anexa', '0', 'dcc_istoric_aparitii_anexa_ck'], ['revizie', '-1', 'dcc_istoric_aparitii_revizie_ck']]) {
        A.cod(await sonda(db, I('dcc_istoric_aparitii', { [col]: rau }), R), '23514', `N2 istoric.${col} = ${rau}`, { constrangere: ck })
      }
      // cod_scris: gol și spații ACCEPTATE (semantica declarată a istoricului), 201 caractere refuzate, 200 acceptate
      for (const v of ["''", "'   '", lit('x'.repeat(200))]) {
        A.trece(await sonda(db, I('dcc_istoric_aparitii', { cod_scris: v, revizie: 'NULL', probleme: "ARRAY['revizie_necunoscuta']" }), R), `N2 cod_scris ${v.slice(0, 6)} acceptat`)
      }
      A.cod(await sonda(db, I('dcc_istoric_aparitii', { cod_scris: lit('x'.repeat(201)), probleme: "ARRAY['revizie_necunoscuta']" }), R), '23514', 'N2 cod_scris 201',
        { constrangere: 'dcc_istoric_aparitii_cod_scris_ck' })
      // N3: fiecare coloană cerută lăsată NULL -> 23514 pe numele constrângerii
      const anD = { stare: "'anulat'", anulat_la: 'now()', anulat_de: `'${U.OWNER}'`, motiv_anulare: "'m'" }
      A.cod(await sonda(db, I('dcc_documente', { ...anD, anulat_de: 'NULL' }), R), '23514', 'N3 anulat_de NULL', { constrangere: 'dcc_documente_anulare_ck' })
      A.trece(await sonda(db, I('dcc_documente', anD), R), 'N3 document anulat complet (contra-proba)')
      const anR = { stare_transport: "'anulata'", anulata_la: 'now()', anulata_de: `'${U.OWNER}'`, anulata_prin: "'revizie'", motiv_anulare: "'m'" }
      A.cod(await sonda(db, I('dcc_revizii', { ...anR, anulata_de: 'NULL' }), R), '23514', 'N3 anulata_de NULL', { constrangere: 'dcc_revizii_anulare_ck' })
      A.trece(await sonda(db, I('dcc_revizii', anR), R), 'N3 revizie anulată completă (contra-proba)')
      const vd = { verdict: "'validat'", verdict_mesaj_id: '1', verdict_confirmat_de: `'${U.OWNER}'`, verdict_confirmat_la: 'now()' }
      for (const col of ['verdict_mesaj_id', 'verdict_confirmat_de', 'verdict_confirmat_la']) {
        A.cod(await sonda(db, I('dcc_revizii', { ...vd, [col]: 'NULL' }), R), '23514', `N3 verdict fără ${col}`, { constrangere: 'dcc_revizii_verdict_ck' })
      }
      A.trece(await sonda(db, I('dcc_revizii', vd), R), 'N3 verdict complet (contra-proba)')
      A.cod(await sonda(db, I('dcc_legaturi', { stare: "'confirmata'" }), R), '23514', 'N3 legătură confirmată fără confirmat_la', { constrangere: 'dcc_legaturi_confirmare_ck' })
      A.trece(await sonda(db, I('dcc_legaturi', { stare: "'confirmata'", confirmat_la: 'now()' }), R), 'N3 legătură confirmată completă (contra-proba)')
      A.cod(await sonda(db, I('dcc_casute', { tip: "'personala'" }), R), '23514', 'N3 căsuță personală fără proprietar', { constrangere: 'dcc_casute_proprietar_ck' })
      A.cod(await sonda(db, I('dcc_contracte', { creat_prin: "'om'" }), R), '23514', 'N3 contract om fără autor', { constrangere: 'dcc_contracte_creat_ck' })
      A.cod(await sonda(db, I('dcc_serii', { initializata_prin: "'om'" }), R), '23514', 'N3 serie om fără autor', { constrangere: 'dcc_serii_initializata_ck' })
      A.cod(await sonda(db, I('dcc_istoric_aparitii', { importat_prin: "'om'" }), R), '23514', 'N3 import om fără autor', { constrangere: 'dcc_istoric_aparitii_importat_ck' })
      A.cod(await sonda(db, I('dcc_documente', { stare: "'anulat'" }), R), '23514', 'N3 anulat fără anulat_la', { constrangere: 'dcc_documente_stare_ck' })
      A.cod(await sonda(db, I('dcc_mesaje', { sursa: "'erp'", gmail_thread_id: "'t1'" }), R), '23514', 'N3 thread fără căsuță', { constrangere: 'dcc_mesaje_thread_ck' })
      A.cod(await sonda(db, I('dcc_mesaje', { rfc_message_id: "'<a@b>'" }), R), '23514', 'N3 mesaj manual cu Message-ID', { constrangere: 'dcc_mesaje_manual_ck' })
      // N4: formate malformate (segment fără prefix, prefix null, cifre text, [], {}, null JSON) -> 23514; funcția nu întoarce NULL pe ele
      const baza = F.lot1
      const cu = (i, s) => baza.map((x, j) => (j === i ? s : x))
      const rele = [cu(1, { camp: 'emitent' }), cu(1, { camp: 'emitent', prefix: null }), cu(4, { camp: 'secventa', prefix: '-', cifre: '5' }), [], {}, null]
      for (const f of rele) {
        const j = `${lit(JSON.stringify(f))}::jsonb`
        A.cod(await sonda(db, I('dcc_ghiduri', { format_cod: j }), R), '23514', `N4 format_cod ${JSON.stringify(f).slice(0, 40)}`, { constrangere: 'dcc_ghiduri_format_cod_ck' })
        A.cod(await sonda(db, I('dcc_ghiduri', { format_fisier: j }), R), '23514', `N4 format_fisier ${JSON.stringify(f).slice(0, 40)}`, { constrangere: 'dcc_ghiduri_format_fisier_ck' })
        const v = (await db.query(`SELECT public.fn_dcc_format_valid(${j}) AS v`)).rows[0].v
        A.ok(v === false, `N4 fn_dcc_format_valid(${JSON.stringify(f).slice(0, 40)}) = ${v} (aștepta false, nu NULL)`)
      }
      // limba lipsă din AMBELE formate -> dcc_ghiduri_limba_ck (N1); contra-proba: limba doar în fișier
      A.cod(await sonda(db, I('dcc_ghiduri', { format_cod: `${lit(JSON.stringify(F.lot2_cod))}::jsonb`, format_fisier: `${lit(JSON.stringify(F.lot2_cod))}::jsonb` }), R),
        '23514', 'limba lipsă din ambele formate', { constrangere: 'dcc_ghiduri_limba_ck' })
      A.trece(await sonda(db, I('dcc_ghiduri', { format_cod: `${lit(JSON.stringify(F.lot2_cod))}::jsonb`, format_fisier: `${lit(JSON.stringify(F.lot2_fisier))}::jsonb` }), R),
        'limba doar în formatul de fișier (contra-proba)')
      // N5: element NULL în probleme -> <@ dă false, CHECK-ul respinge (dovedit, nu presupus)
      for (const v of ['ARRAY[NULL]::text[]', "ARRAY['dublura', NULL]::text[]"]) {
        A.cod(await sonda(db, I('dcc_istoric_aparitii', { probleme: v }), R), '23514', `N5 probleme ${v}`, { constrangere: 'dcc_istoric_aparitii_probleme_ck' })
      }
      const op = (await db.query(`SELECT (ARRAY[NULL]::text[] <@ ARRAY['dublura']::text[]) AS v`)).rows[0].v
      A.ok(op === false, `N5 comportamentul <@ pe element NULL = ${op} (aștepta false)`)
      A.trece(await sonda(db, I('dcc_istoric_aparitii', { probleme: "ARRAY['dublura']" }), R), 'N5 probleme valide (contra-proba)')
      // N6: cod_scris + revizie 0 + problema revizie_necunoscuta -> refuz; revizie NULL fără problemă -> refuz; contra-probele
      A.cod(await sonda(db, I('dcc_istoric_aparitii', { cod_scris: "'X'", revizie: '0', probleme: "ARRAY['revizie_necunoscuta']" }), R), '23514', 'N6 revizie 0 + necunoscută',
        { constrangere: 'dcc_istoric_aparitii_revizie_problema_ck' })
      A.cod(await sonda(db, I('dcc_istoric_aparitii', { cod_scris: "'X'", revizie: 'NULL', probleme: "'{}'::text[]" }), R), '23514', 'N6 revizie NULL fără problemă',
        { constrangere: 'dcc_istoric_aparitii_revizie_problema_ck' })
      A.trece(await sonda(db, I('dcc_istoric_aparitii', { cod_scris: "'X'", revizie: '0' }), R), 'N6 revizie 0 fără problemă (contra-proba)')
    },
  },
  {
    nume: 'p_mom_unicitate_direct', task: 2, cere: ['2'], fixtura: true,
    async fn(db, A) {
      const mom = s => insereaza('dcc_documente', { contract_id: '4', proiect_dcc_id: '4', tematica: 'NULL', tip: "'MOM'", secventa: s, interval: 'NULL', serie_id: 'NULL', mod: "'manual'" })
      A.trece(await sonda(db, [mom('7')], R), 'primul MOM (contra-proba)')
      A.cod(await sonda(db, [mom('7'), mom('7')], R), '23505', 'al doilea MOM cu aceeași secvență', { constrangere: 'dcc_documente_cod_uq' })
      A.trece(await sonda(db, [mom('7'), mom('8')], R), 'MOM cu altă secvență (contra-proba)')
    },
  },
  {
    nume: 'p_paritate_formator', task: 2, cere: ['1'], fixtura: false,
    async fn(db, A) {
      const sqlCod = 'SELECT public.fn_dcc_cod_text($1::jsonb, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS r'
      const sqlFis = 'SELECT public.fn_dcc_nume_fisier($1::jsonb, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) AS r'
      const js = fn => { try { return { ok: fn() } } catch (e) { return { err: String(e.message).split(':')[0] } } }
      const pg = async (sql, p) => { try { return { ok: (await db.query(sql, p)).rows[0].r } } catch (e) { return { err: String(e.message).split(':')[0], code: e.code } } }
      const param = (format, c) => [JSON.stringify(format), c.contract, c.emitent, c.tematica, c.tip, c.secventa, c.fila, c.anexa, c.revizie, c.limba]
      let n = 0
      for (const c of CAZURI.cazuri) {
        const fis = 'titlu_scurt' in c
        const s = fis ? await pg(sqlFis, [...param(F[c.format], c.comp), c.titlu_scurt, c.ext]) : await pg(sqlCod, param(F[c.format], c.comp))
        const asteptat = 'asteptat' in c ? { ok: c.asteptat } : { err: c.eroare }
        A.ok(JSON.stringify({ ok: s.ok, err: s.err }) === JSON.stringify({ ok: asteptat.ok, err: asteptat.err }), `caz ${c.id}: SQL ${JSON.stringify(s)} ≠ ${JSON.stringify(asteptat)}`)
        if (s.err) A.ok(s.code === '22023', `caz ${c.id}: SQLSTATE ${s.code}`)
        n++
      }
      for (const c of combinatiiFormator(F)) {
        const j = js(() => numeFisierDcc(F[c.format], c.comp, c.titlu_scurt, c.ext))
        const s = await pg(sqlFis, [...param(F[c.format], c.comp), c.titlu_scurt, c.ext])
        const jc = js(() => codDcc(F[c.format], c.comp))
        const sc = await pg(sqlCod, param(F[c.format], c.comp))
        A.ok(JSON.stringify(j) === JSON.stringify({ ok: s.ok, err: s.err }), `combinație ${JSON.stringify(c)}: JS ${JSON.stringify(j)} ≠ SQL ${JSON.stringify(s)}`)
        A.ok(JSON.stringify(jc) === JSON.stringify({ ok: sc.ok, err: sc.err }), `cod ${JSON.stringify(c)}: JS ${JSON.stringify(jc)} ≠ SQL ${JSON.stringify(sc)}`)
        n++
      }
      // titlul scurt direct + formatValid pe formate malformate și mutații generate
      for (const t of ['ăâîșşțţ ĂÂÎȘŞȚŢ', '  _x_ ', '—', 'a'.repeat(59) + ' b', 'Ø', '']) {
        const j = js(() => titluScurtDcc(t)), s = await pg('SELECT public.fn_dcc_titlu_scurt($1) AS r', [t])
        A.ok(JSON.stringify(j) === JSON.stringify({ ok: s.ok, err: s.err }), `titlu ${JSON.stringify(t)}: JS ${JSON.stringify(j)} ≠ SQL ${JSON.stringify(s)}`)
      }
      const r = generator(77)
      const formate = Object.values(F)
      const mutatii = []
      for (let i = 0; i < 200; i++) {
        const f = JSON.parse(JSON.stringify(formate[Math.floor(r() * formate.length)]))
        const k = Math.floor(r() * f.length), op = Math.floor(r() * 7)
        if (op === 0) delete f[k].prefix
        else if (op === 1) f[k].prefix = null
        else if (op === 2) f[k].cifre = String(f[k].cifre ?? 2)
        else if (op === 3) f.splice(k, 1)
        else if (op === 4) f.push({ ...f[k] })
        else if (op === 5) f[k].prefix = f[k].prefix + ' '
        else f[k] = [f[k]]
        mutatii.push(f)
      }
      for (const f of [...formate, ...mutatii, [], {}, null, 'x', [null], [1]]) {
        const s = (await db.query('SELECT public.fn_dcc_format_valid($1::jsonb) AS v', [JSON.stringify(f)])).rows[0].v
        A.ok(s === formatValid(f), `formatValid ${JSON.stringify(f).slice(0, 80)}: SQL ${s} ≠ JS ${formatValid(f)}`)
      }
      A.ok(n >= 530, `paritate pe ${n} cazuri (aștepta ≥ 530)`)
    },
  },
  {
    nume: 'p_interval_canonic', task: 2, cere: ['1', '2'], fixtura: true,
    async fn(db, A) {
      const pg = async (sql, p) => { try { return { ok: (await db.query(sql, p)).rows[0].r } } catch (e) { return { err: String(e.message).split(':')[0], code: e.code } } }
      for (const c of CAZURI.intervale) {
        const v = intrareReala(c.in)
        const s = await pg('SELECT public.fn_dcc_interval_canonic($1) AS r', [v])
        const asteptat = 'eroare' in c ? { err: c.eroare } : { ok: c.asteptat }
        A.ok(JSON.stringify({ ok: s.ok, err: s.err }) === JSON.stringify(asteptat), `interval ${JSON.stringify(v)}: SQL ${JSON.stringify(s)} ≠ ${JSON.stringify(asteptat)}`)
        let j; try { j = { ok: intervalCanonic(v) } } catch (e) { j = { err: String(e.message).split(':')[0] } }
        A.ok(JSON.stringify(j) === JSON.stringify(asteptat), `interval ${JSON.stringify(v)}: JS ${JSON.stringify(j)}`)
        if (s.err) A.ok(s.code === '22023', `interval ${JSON.stringify(v)}: SQLSTATE ${s.code}`)
      }
      for (const c of CAZURI.intervale_forma) {
        const v = intrareReala(c.in)
        const s = (await db.query('SELECT public.fn_dcc_interval_e_canonic($1) AS r', [v])).rows[0].r
        A.ok(s === c.asteptat && s !== null && intervalECanonic(v) === c.asteptat, `forma ${JSON.stringify(v)}: SQL ${s} JS ${intervalECanonic(v)} aștepta ${c.asteptat}`)
      }
      let puncte = 0
      for (const sir of siruriInterval()) {
        const e = (await db.query('SELECT public.fn_dcc_interval_e_canonic($1) AS r', [sir])).rows[0].r
        const c = await pg('SELECT public.fn_dcc_interval_canonic($1) AS r', [sir])
        const fix = !c.err && c.ok === sir
        A.ok(e === fix && e === intervalECanonic(sir), `proprietatea pe ${JSON.stringify(sir)}: e_canonic ${e}, punct fix ${fix}`)
        if (fix) puncte++
      }
      A.ok(puncte > 10, `proprietatea: ${puncte} puncte fixe (aștepta > 10)`)
      // INSERT direct în replica pe cele trei tabele -> 23514 pe constrângerea lor (inclusiv 'S R1', pentru care funcția canonică ar arunca)
      const NBSP = String.fromCharCode(160), TAB = String.fromCharCode(9)
      const rele = ['GENERAL', 'sr1', '', ' ', '   ', TAB, 'SR1' + NBSP, 'S R1']
      const tinte = [['dcc_ghid_intervale', {}, 'dcc_ghid_intervale_interval_ck'], ['dcc_serii', {}, 'dcc_serii_interval_ck'],
        ['dcc_documente', {}, 'dcc_documente_interval_ck'],
        ['dcc_documente', { mod: "'manual'", serie_id: 'NULL', secventa: '777' }, 'dcc_documente_interval_ck']]
      for (const [t, extra, ck] of tinte) {
        for (const v of rele) A.cod(await sonda(db, insereaza(t, { ...extra, interval: lit(v) }), R), '23514', `${t}${extra.mod ? '(manual)' : ''} interval ${JSON.stringify(v)}`, { constrangere: ck })
        for (const v of ['SR1', 'general']) A.trece(await sonda(db, insereaza(t, { ...extra, interval: lit(v) }), R), `${t}${extra.mod ? '(manual)' : ''} interval ${v} (contra-proba)`)
      }
      A.cod(await sonda(db, insereaza('dcc_serii', { interval: 'NULL' }), R), '23502', 'dcc_serii interval NULL')
      A.cod(await sonda(db, insereaza('dcc_ghid_intervale', { interval: 'NULL' }), R), '23502', 'dcc_ghid_intervale interval NULL')
      A.trece(await sonda(db, insereaza('dcc_documente', { mod: "'manual'", serie_id: 'NULL', interval: 'NULL', secventa: '778' }), R), 'document manual interval NULL (contra-proba)')
    },
  },
]
