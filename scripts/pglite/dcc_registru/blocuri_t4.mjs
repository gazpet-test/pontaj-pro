// Blocurile Task 4 (secțiunea 4: triggerele), pe fix_baza, pe căile DIRECTE ca postgres (plasa care ține pe orice cale, L07). Fiecare refuz are
// CONTRA-PROBA lui: aceeași scriere, pe aceeași țintă, cu singura diferență starea / valoarea refuzată — care TRECE.
import { U, sonda, lit } from './baza.mjs'
import { TABELE } from './inventar.mjs'
import { F } from './fixtura.mjs'

const RE = cod => new RegExp('^' + cod + ':')
// fixtura: documentul 4 = ANULAT (cu fila 3 și revizia 6 rămasă rezervata); documentul 3 = ACTIV cu file (file 1, 2; anexa 1; reviziile 3, 4, 5)
const REV_NOUA = (doc, fila, cod) => `INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, ghid_id, cod_text, nume_fisier_baza, creat_de)
  VALUES (1, ${doc}, ${fila}, 1, 'RO', 1, '${cod}', '${cod}', '${U.L1}')`
export const STARI = ['rezervata', 'pregatita', 'copiata_pentru_gmail', 'trimisa_manual_neverificata', 'trimisa_manual_confirmata', 'trimisa_erp', 'necunoscut', 'anulata']
// tabelul TRANZIȚIILOR din plan (A3), scris de mână — nu citit din funcție
export const PERMISE = new Set(['rezervata>pregatita', 'rezervata>copiata_pentru_gmail', 'rezervata>trimisa_manual_neverificata', 'rezervata>anulata',
  'pregatita>copiata_pentru_gmail', 'pregatita>trimisa_manual_neverificata', 'pregatita>anulata',
  'copiata_pentru_gmail>copiata_pentru_gmail', 'copiata_pentru_gmail>trimisa_manual_neverificata', 'copiata_pentru_gmail>anulata',
  'trimisa_manual_neverificata>trimisa_manual_confirmata'])
const anulareCampuri = s => (s === 'anulata' ? `, anulata_la = now(), anulata_de = '${U.OWNER}', anulata_prin = 'revizie', motiv_anulare = 'proba'` : '')

export const BLOCURI_T4 = [
  {
    nume: 't4_imuabil_config', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      A.cod(await sonda(db, `UPDATE public.dcc_ghiduri SET format_cod = ${lit(JSON.stringify(F.dde))}::jsonb WHERE id = 1`), 'P0001', 'ghid: format_cod', { re: RE('DCC_GHID_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_ghiduri SET sursa = 'alta' WHERE id = 1`), 'P0001', 'ghid: sursa', { re: RE('DCC_GHID_IMUABIL') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_ghiduri WHERE id = 6`), 'P0001', 'ghid: DELETE', { re: RE('DCC_GHID_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_ghid_intervale SET limita_sup = 99998 WHERE ghid_id = 1`), 'P0001', 'interval ghid: limita', { re: RE('DCC_GHID_IMUABIL') })
      // valorile: activ true -> false ok (contra-proba); false -> true refuz; codul / descrierea refuz
      const val = `(SELECT id FROM public.dcc_ghid_valori WHERE ghid_id = 1 AND categorie = 'tip' AND cod = 'RAP')`
      A.trece(await sonda(db, `UPDATE public.dcc_ghid_valori SET activ = false WHERE id = ${val}`), 'valoare: dezactivare (contra-proba)')
      A.cod(await sonda(db, [`UPDATE public.dcc_ghid_valori SET activ = false WHERE id = ${val}`, `UPDATE public.dcc_ghid_valori SET activ = true WHERE id = ${val}`]),
        'P0001', 'valoare: reactivare', { re: RE('DCC_GHID_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_ghid_valori SET descriere = 'x' WHERE id = ${val}`), 'P0001', 'valoare: descriere', { re: RE('DCC_GHID_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_ghid_valori SET activ = false, descriere = 'x' WHERE id = ${val}`), 'P0001', 'valoare: dezactivare + descriere', { re: RE('DCC_GHID_IMUABIL') })
      // intervalele aceluiași ghid: suprapunere -> 23P01; contra-proba: interval disjunct
      A.cod(await sonda(db, `INSERT INTO public.dcc_ghid_intervale (ghid_id, interval, limita_inf, limita_sup) VALUES (2, 'SR3', 150, 160)`), '23P01', 'interval suprapus în ghid',
        { re: RE('DCC_INTERVALE_SUPRAPUSE') })
      A.trece(await sonda(db, `INSERT INTO public.dcc_ghid_intervale (ghid_id, interval, limita_inf, limita_sup) VALUES (2, 'SR3', 50, 60)`), 'interval disjunct (contra-proba)')
      // contractul: mod / beneficiar / cod imuabile; descrierea se poate schimba (contra-proba); DELETE refuz
      for (const [col, v] of [['mod_alocare', "'manual'"], ['beneficiar', "'XYZ'"], ['cod_contract', "'31'"]]) {
        A.cod(await sonda(db, `UPDATE public.dcc_contracte SET ${col} = ${v} WHERE id = 1`), 'P0001', `contract: ${col}`, { re: RE('DCC_CONTRACT_IMUABIL') })
      }
      A.trece(await sonda(db, `UPDATE public.dcc_contracte SET descriere = 'descriere noua' WHERE id = 1`), 'contract: descriere (contra-proba)')
      A.cod(await sonda(db, `DELETE FROM public.dcc_contracte WHERE id = 2`), 'P0001', 'contract: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
      // proiectul: emitent străin -> 22023; ghid incompatibil cu seriile -> DCC_GHID_INCOMPATIBIL; contract schimbat cu documente -> refuz
      const proiect = em => `INSERT INTO public.dcc_proiecte (contract_id, executie_proiect_id, ghid_id, emitent) VALUES (2, 5, 1, '${em}')`
      A.cod(await sonda(db, proiect('XYZ')), '22023', 'proiect cu emitent din afara ghidului', { re: RE('DCC_EMITENT_STRAIN') })
      A.trece(await sonda(db, proiect('SUB')), 'proiect cu emitent din ghid (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_proiecte SET ghid_id = 2 WHERE id = 1`), 'P0001', 'proiect mutat pe un ghid incompatibil (general 300–99999)', { re: RE('DCC_GHID_INCOMPATIBIL') })
      A.trece(await sonda(db, `UPDATE public.dcc_proiecte SET ghid_id = 4 WHERE id = 1`), 'proiect mutat pe un ghid compatibil (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_proiecte SET contract_id = 2 WHERE id = 1`), 'P0001', 'contract_id schimbat pe un proiect cu documente', { re: RE('DCC_PROIECT_IMUABIL') })
      A.trece(await sonda(db, `UPDATE public.dcc_proiecte SET contract_id = 2 WHERE id = 4`), 'contract_id schimbat pe un proiect fără documente (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_proiecte SET emitent = 'SUB' WHERE id = 1`), 'P0001', 'emitent schimbat pe un proiect cu documente', { re: RE('DCC_PROIECT_IMUABIL') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_proiecte WHERE id = 4`), 'P0001', 'proiect: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
      const v = await sonda(db, [`UPDATE public.dcc_proiecte SET adresa_dcc = 'alt@exemplu.invalid' WHERE id = 1`, `UPDATE public.dcc_proiecte SET antet_financiar = 'x' WHERE id = 1`,
        `SELECT versiune FROM public.dcc_proiecte WHERE id = 1`])
      A.ok(v.rows && v.rows[0].versiune === 3, `versiunea proiectului după două UPDATE-uri: ${JSON.stringify(v.rows || v)} (aștepta 3)`)
      const vi = await sonda(db, [`UPDATE public.dcc_proiecte SET versiune = 99 WHERE id = 1`, `SELECT versiune FROM public.dcc_proiecte WHERE id = 1`])
      A.ok(vi.rows && vi.rows[0].versiune === 2, `versiunea pusă de server, nu de UPDATE: ${JSON.stringify(vi.rows || vi)} (aștepta 2)`)
    },
  },
  {
    nume: 't4_serii_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      const serie = (tem, interval, inf, sup) => `INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf, limita_sup, prag_initial,
        ultimul_ocupat, motiv_prag, initializata_prin) VALUES (1, 'AAA', '${tem}', 'COR', '${interval}', 2, ${inf}, ${sup}, ${inf - 1}, ${inf - 1}, 'proba', 'server')`
      A.cod(await sonda(db, serie('TM1', 'SR1', 100, 199)), '23P01', 'serie suprapusă pe aceeași cheie (alt interval, alt ghid)', { re: RE('DCC_GARDA_INTERVALE_SUPRAPUSE') })
      A.trece(await sonda(db, serie('TM2', 'SR1', 100, 199)), 'aceeași serie pe altă cheie (contra-proba)')
      const up = s => `UPDATE public.dcc_serii SET ${s} WHERE id = 1`
      A.cod(await sonda(db, up('ultimul_ocupat = 45')), 'P0001', 'contor descrescător', { re: RE('DCC_SERIE_IMUABILA') })
      A.cod(await sonda(db, up('ultimul_ocupat = 46')), 'P0001', 'contor EGAL (strict crescător)', { re: RE('DCC_SERIE_IMUABILA') })
      A.trece(await sonda(db, up('ultimul_ocupat = 47')), 'contor +1 (contra-proba)')
      A.cod(await sonda(db, up('limita_sup = 99998')), 'P0001', 'limita_sup schimbată', { re: RE('DCC_SERIE_IMUABILA') })
      A.cod(await sonda(db, up('ultimul_ocupat = 47, motiv_prag = \'alt motiv\'')), 'P0001', 'contor + motiv', { re: RE('DCC_SERIE_IMUABILA') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_serii WHERE id = 1`), 'P0001', 'serie: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
    },
  },
  {
    nume: 'p4_garzi_anulat_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      const G = { re: RE('DCC_GARDA_DOCUMENT_ANULAT') }
      const cazuri = [
        ['filă', `INSERT INTO public.dcc_file (document_id, fila) VALUES (4, 2)`, `INSERT INTO public.dcc_file (document_id, fila) VALUES (3, 3)`],
        ['anexă', `INSERT INTO public.dcc_anexe (document_id, numar, titlu) VALUES (4, 1, 'Anexa')`, `INSERT INTO public.dcc_anexe (document_id, numar, titlu) VALUES (3, 2, 'Anexa')`],
        ['revizie', REV_NOUA(4, 3, 'P-ANULAT-01.Rev1.RO'), REV_NOUA(3, 1, 'P-ACTIV-01.Rev1.RO')],
        ['rezervata -> copiata', `UPDATE public.dcc_revizii SET stare_transport = 'copiata_pentru_gmail' WHERE id = 6`,
          `UPDATE public.dcc_revizii SET stare_transport = 'copiata_pentru_gmail' WHERE id = 3`],
        ['snapshot <-> revizie', `INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (1, 6)`,
          `INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (1, 3)`],
        ['legătură manuală', `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare) VALUES (1, 6, 'manual', 'propusa')`,
          `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare) VALUES (1, 3, 'manual', 'propusa')`],
      ]
      for (const [ce, rau, bun] of cazuri) {
        A.cod(await sonda(db, rau), 'P0001', `document ANULAT: ${ce}`, G)
        A.trece(await sonda(db, bun), `document ACTIV: ${ce} (contra-proba)`)
      }
      // excepția unică: neverificata -> confirmata (istoric adevărat) rămâne permisă pe un document anulat, cu dovadă
      const conf = await sonda(db, [`UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_neverificata' WHERE id = 3`,
        `UPDATE public.dcc_documente SET stare = 'anulat', anulat_la = now(), anulat_de = '${U.OWNER}', motiv_anulare = 'proba' WHERE id = 3`,
        `INSERT INTO public.dcc_mesaje (id, contract_id, proiect_dcc_id, directie, sursa, rfc_message_id, data_mesaj, dovezi_complete) VALUES (50, 1, 1, 'trimis', 'erp', '<p@exemplu.invalid>', now(), true)`,
        `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare, confirmat_la) VALUES (50, 3, 'antet_rfc', 'confirmata', now())`,
        `UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_confirmata' WHERE id = 3`])
      A.trece(conf, 'neverificata -> confirmata cu dovadă pe un document anulat (excepția unică)')
    },
  },
  {
    nume: 't4_tranzitii_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      // revizia 3 (document activ) pusă în starea „din” cu triggerele oprite, apoi UPDATE-ul real spre „în”
      let n = 0
      for (const din of STARI) {
        for (const in_ of STARI) {
          if (din === in_ && din !== 'copiata_pentru_gmail') continue
          const pas = [
            'SET LOCAL session_replication_role = replica',
            `UPDATE public.dcc_revizii SET stare_transport = '${din}'${anulareCampuri(din)} WHERE id = 3`,
            'SET LOCAL session_replication_role = origin',
            `UPDATE public.dcc_revizii SET stare_transport = '${in_}'${din === 'anulata' ? '' : anulareCampuri(in_)} WHERE id = 3 RETURNING stare_transport`,
          ]
          const r = await sonda(db, pas)
          const permis = PERMISE.has(`${din}>${in_}`) && in_ !== 'trimisa_manual_confirmata'
          if (permis) A.trece(r, `${din} -> ${in_} permisă`)
          else A.cod(r, 'P0001', `${din} -> ${in_} nepermisă`, { re: RE(din === 'anulata' && in_ !== 'anulata' ? '(DCC_TRANZITIE_NEPERMISA|DCC_REVIZIE_IMUABILA)' : 'DCC_TRANZITIE_NEPERMISA') })
          n++
        }
      }
      A.ok(n === 57, `perechi încercate: ${n} (aștepta 57)`)
      // neverificata -> confirmata: fără legătură, cu legătură PROPUSĂ, cu mesaj fără Message-ID -> refuz; cu dovadă -> ok
      const baza = [`UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_neverificata' WHERE id = 3`]
      const msg = (id, rfc) => `INSERT INTO public.dcc_mesaje (id, contract_id, proiect_dcc_id, directie, sursa, rfc_message_id, data_mesaj, dovezi_complete)
        VALUES (${id}, 1, 1, 'trimis', 'erp', ${rfc}, now(), true)`
      const lg = (m, st) => `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare, confirmat_la) VALUES (${m}, 3, 'antet_rfc', '${st}', ${st === 'propusa' ? 'NULL' : 'now()'})`
      const conf = `UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_confirmata' WHERE id = 3`
      A.cod(await sonda(db, [...baza, conf]), 'P0001', 'confirmare fără legătură', { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.cod(await sonda(db, [...baza, msg(60, "'<a@exemplu.invalid>'"), lg(60, 'propusa'), conf]), 'P0001', 'confirmare cu legătură propusă', { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.cod(await sonda(db, [...baza, msg(61, 'NULL'), lg(61, 'confirmata'), conf]), 'P0001', 'confirmare cu mesaj fără Message-ID', { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.trece(await sonda(db, [...baza, msg(62, "'<b@exemplu.invalid>'"), lg(62, 'confirmata'), conf]), 'confirmare cu dovadă (contra-proba)')
    },
  },
  {
    nume: 't4_revizii_imuabile', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      for (const [col, v] of [['cod_text', "'30-AAA-TM1-DES-00010-01.Rev9.RO'"], ['nume_fisier_baza', "'NOU-01.Rev9.RO'"], ['revizie', '9'], ['limba', "'EN'"],
        ['ghid_id', '2'], ['fila_id', '3'], ['document_id', '2'], ['contract_id', '2'], ['titlu', "'titlu nou'"]]) {
        A.cod(await sonda(db, `UPDATE public.dcc_revizii SET ${col} = ${v} WHERE id = 3`), 'P0001', `revizie: ${col}`, { re: RE('DCC_REVIZIE_IMUABILA') })
      }
      A.trece(await sonda(db, `UPDATE public.dcc_revizii SET stare_transport = 'copiata_pentru_gmail' WHERE id = 3`), 'rezervata -> copiata pe document activ (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_revizii SET anulata_la = now(), anulata_de = '${U.OWNER}', anulata_prin = 'revizie', motiv_anulare = 'x' WHERE id = 3`), 'P0001',
        'câmpurile anulării fără tranziția spre anulata', { re: RE('DCC_REVIZIE_IMUABILA') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_revizii WHERE id = 3`), 'P0001', 'revizie: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
      // documentul: doar anularea; titlul / secvența imuabile; anulat -> activ refuz
      A.cod(await sonda(db, `UPDATE public.dcc_documente SET titlu = 'alt titlu' WHERE id = 1`), 'P0001', 'document: titlu', { re: RE('DCC_DOCUMENT_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_documente SET stare = 'activ', anulat_la = NULL, anulat_de = NULL, motiv_anulare = NULL WHERE id = 4`), 'P0001',
        'document: anulat -> activ', { re: RE('DCC_DOCUMENT_IMUABIL') })
      A.trece(await sonda(db, `UPDATE public.dcc_documente SET stare = 'anulat', anulat_la = now(), anulat_de = '${U.OWNER}', motiv_anulare = 'proba' WHERE id = 1`),
        'document: anularea (contra-proba)')
      // documentul nou cu o serie a altei chei / secvență în afara limitelor -> refuz
      const doc = (serie, sec) => `INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
        VALUES (1, 1, 'AAA', 'TM1', 'COR', ${sec}, 'general', ${serie}, 'automat', 'Nou', false, '${U.L1}')`
      A.cod(await sonda(db, doc(2, 60)), '22023', 'document cu seria altei chei', { re: RE('DCC_SERIE_NEPOTRIVITA') })
      A.trece(await sonda(db, doc(1, 60)), 'document cu seria cheii lui (contra-proba)')
      // fila / anexa imuabile
      A.cod(await sonda(db, `UPDATE public.dcc_file SET titlu = 'x' WHERE id = 1`), 'P0001', 'fila: UPDATE', { re: RE('DCC_FILA_IMUABILA') })
      A.cod(await sonda(db, `UPDATE public.dcc_anexe SET titlu = 'x' WHERE id = 1`), 'P0001', 'anexa: UPDATE', { re: RE('DCC_ANEXA_IMUABILA') })
      // ținta reviziei: fila altui document / revizie fără țintă pe un document cu file / fila pe un document fără file
      A.cod(await sonda(db, REV_NOUA(3, 3, 'T-STRAIN')), '22023', 'revizie cu fila altui document', { re: RE('DCC_TINTA_STRAINA') })
      A.cod(await sonda(db, REV_NOUA(3, 'NULL', 'T-FARA')), '22023', 'revizie fără țintă pe un document cu file', { re: RE('DCC_TINTA_NEPOTRIVITA') })
      A.cod(await sonda(db, `INSERT INTO public.dcc_file (document_id, fila) VALUES (1, 1)`), '22023', 'filă pe un document fără file', { re: RE('DCC_FARA_FILE') })
    },
  },
  {
    nume: 't4_intentii_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      const ins = k => `INSERT INTO public.dcc_intentii (cheie, operatie, parametri_hash, autor, actor) VALUES ('${k}', 'aloca', '${'a'.repeat(64)}', NULL, 'server')`
      const K1 = '00000000-0000-4000-8000-0000000000e1', K2 = '00000000-0000-4000-8000-0000000000e2'
      A.trece(await sonda(db, [ins(K1), `UPDATE public.dcc_intentii SET rezultat = '{"a": 1}' WHERE cheie = '${K1}'`]), 'rezultatul scris o dată, în tranzacția claim-ului (contra-proba)')
      A.cod(await sonda(db, [ins(K1), `UPDATE public.dcc_intentii SET rezultat = '{"a": 1}' WHERE cheie = '${K1}'`, `UPDATE public.dcc_intentii SET rezultat = '{"a": 2}' WHERE cheie = '${K1}'`]),
        'P0001', 'al doilea UPDATE al rezultatului', { re: RE('DCC_INTENTIE_IMUABILA') })
      A.cod(await sonda(db, [ins(K1), `UPDATE public.dcc_intentii SET operatie = 'revizie_noua', rezultat = '{"a": 1}' WHERE cheie = '${K1}'`]), 'P0001', 'operația schimbată',
        { re: RE('DCC_INTENTIE_IMUABILA') })
      await db.exec(ins(K2))
      A.cod(await sonda(db, `UPDATE public.dcc_intentii SET rezultat = '{"a": 1}' WHERE cheie = '${K2}'`), 'P0001', 'rezultatul scris în ALTĂ tranzacție decât claim-ul',
        { re: RE('DCC_INTENTIE_IMUABILA') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_intentii WHERE cheie = '${K2}'`), 'P0001', 'intenție: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
      const t = await db.query(`SELECT creat_tx::text AS t FROM public.dcc_intentii WHERE cheie = '${K2}'`)
      A.ok(/^[0-9]+$/.test(t.rows[0].t), `creat_tx pus de server: ${t.rows[0].t}`)
    },
  },
  {
    nume: 't4_istoric_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      A.cod(await sonda(db, `UPDATE public.dcc_istoric_aparitii SET cod_scris = 'altul' WHERE id = 1`), 'P0001', 'istoric: cod_scris', { re: RE('DCC_ISTORIC_IMUABIL') })
      const leaga = (id, doc) => `UPDATE public.dcc_istoric_aparitii SET document_id = ${doc}, legat_de = '${U.OWNER}', legat_la = now() WHERE id = ${id}`
      A.trece(await sonda(db, leaga(1, 1)), 'legarea pe un document al aceluiași proiect (contra-proba)')
      A.cod(await sonda(db, leaga(1, 2)), '23503', 'legarea pe un document al ALTUI proiect (cheia compusă)')
      A.cod(await sonda(db, [leaga(1, 1), leaga(1, 3)]), 'P0001', 'a doua legare', { re: RE('DCC_ISTORIC_IMUABIL') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_istoric_aparitii WHERE id = 1`), 'P0001', 'istoric: DELETE', { re: RE('DCC_STERGERE_INTERZISA') })
      // proveniența și amprenta le pune serverul (valorile date sunt ignorate)
      const r = await sonda(db, [`INSERT INTO public.dcc_istoric_aparitii (contract_id, proiect_dcc_id, sursa, sursa_id, lot_import, valori_originale, continut_hash, importat_prin,
          importat_de, document_id) VALUES (1, 1, 'mail_trimis', 'X-9', 'lot9', '{}', '${'0'.repeat(64)}', 'om', '${U.ED}', 1) RETURNING continut_hash, importat_prin, importat_de, document_id`])
      const x = r.rows && r.rows[0]
      A.ok(x && x.continut_hash !== '0'.repeat(64) && x.importat_prin === 'server' && x.importat_de === null && x.document_id === null,
        `proveniența pusă de server: ${JSON.stringify(x || r)}`)
    },
  },
  {
    nume: 't4_mesaje_direct', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      A.cod(await sonda(db, `UPDATE public.dcc_snapshoturi SET corp = 'alt corp' WHERE id = 1`), 'P0001', 'snapshot: corp', { re: RE('DCC_SNAPSHOT_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_mesaje SET subiect_original = 'alt' WHERE id = 1`), 'P0001', 'mesaj: subiect', { re: RE('DCC_MESAJ_IMUABIL') })
      A.cod(await sonda(db, `DELETE FROM public.dcc_mesaje WHERE id = 1`), 'P0001', 'mesaj: DELETE', { re: RE('DCC_MESAJ_IMUABIL') })
      A.cod(await sonda(db, `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare) VALUES (1, 2, 'manual', 'propusa')`), '22023',
        'legătură mesaj P1 <-> revizie P2', { re: RE('DCC_PROIECTE_AMESTECATE') })
      A.trece(await sonda(db, `INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare) VALUES (1, 3, 'manual', 'propusa')`), 'legătură în același proiect (contra-proba)')
      A.cod(await sonda(db, `INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (1, 2)`), '22023', 'snapshot P1 <-> revizie P2', { re: RE('DCC_PROIECTE_AMESTECATE') })
      A.cod(await sonda(db, `UPDATE public.dcc_legaturi SET dovada = '{"x": 1}' WHERE id = 1`), 'P0001', 'legătură: dovada', { re: RE('DCC_LEGATURA_IMUABILA') })
      // snapshotul: amprenta pusă de server pe forma canonică (valoarea dată e ignorată)
      const s = (await db.query(`SELECT hash, public.fn_dcc_snapshot_hash(tip, from_adresa, to_lista, cc_lista, subiect, corp, linkuri, manifest) AS h FROM public.dcc_snapshoturi WHERE id = 1`)).rows[0]
      A.ok(s.hash === s.h && s.hash !== 'a'.repeat(64), `amprenta snapshotului pusă de server: ${s.hash}`)
    },
  },
  {
    nume: 't4_truncate_delete', task: 4, cere: ['4'], fixtura: true,
    async fn(db, A) {
      const codDel = { dcc_ghiduri: 'DCC_GHID_IMUABIL', dcc_ghid_valori: 'DCC_GHID_IMUABIL', dcc_ghid_intervale: 'DCC_GHID_IMUABIL', dcc_file: 'DCC_FILA_IMUABILA',
        dcc_anexe: 'DCC_ANEXA_IMUABILA', dcc_snapshoturi: 'DCC_SNAPSHOT_IMUABIL', dcc_snapshot_revizii: 'DCC_SNAPSHOT_IMUABIL', dcc_mesaje: 'DCC_MESAJ_IMUABIL' }
      const pregatire = {
        dcc_casute: [`INSERT INTO public.dcc_casute (adresa, tip) VALUES ('c@exemplu.invalid', 'dedicata')`],
        dcc_intentii: [`INSERT INTO public.dcc_intentii (cheie, operatie, parametri_hash, actor) VALUES ('00000000-0000-4000-8000-0000000000e9', 'aloca', '${'b'.repeat(64)}', 'server')`],
      }
      for (const t of TABELE) {
        A.cod(await sonda(db, `TRUNCATE public.${t} CASCADE`), 'P0001', `TRUNCATE ${t}`, { re: RE('DCC_STERGERE_INTERZISA') })
        const n = (await sonda(db, [...(pregatire[t] || []), `SELECT count(*)::int AS n FROM public.${t}`])).rows[0].n
        A.ok(n > 0, `${t} are rânduri pentru proba DELETE (${n})`)
        A.cod(await sonda(db, [...(pregatire[t] || []), `DELETE FROM public.${t} WHERE ctid = (SELECT ctid FROM public.${t} LIMIT 1)`]), 'P0001', `DELETE ${t}`,
          { re: RE(codDel[t] || 'DCC_STERGERE_INTERZISA') })
      }
    },
  },
  {
    // review r1 implementare (P1): fiecare gardă care citește starea documentului îl ia FOR UPDATE (o anulare necomisă se așteaptă). PGlite are o
    // singură conexiune, deci comportamentul îl probează C8 din concurenta.sh; aici, forma: citirea documentului din fiecare gardă, exact.
    nume: 't4_garzi_lock_document', task: 4, cere: ['4'], fixtura: false,
    async fn(db, A) {
      const asteptat = {
        fn_dcc_file_garda: 'SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE;',
        fn_dcc_anexe_garda: 'SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE;',
        fn_dcc_revizii_garda: 'SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE;',
        fn_dcc_snapshot_revizii_garda: 'SELECT x.* INTO d FROM public.dcc_documente x JOIN public.dcc_revizii r ON r.document_id = x.id WHERE r.id = NEW.revizie_id FOR UPDATE OF x;',
        fn_dcc_legaturi_garda: 'SELECT x.* INTO d FROM public.dcc_documente x JOIN public.dcc_revizii r ON r.document_id = x.id WHERE r.id = NEW.revizie_id FOR UPDATE OF x;',
      }
      const r = (await db.query(`SELECT p.proname, p.prosrc FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc LIKE '%FROM public.dcc_documente x%'
        AND p.prorettype = 'trigger'::regtype ORDER BY 1`)).rows
      A.ok(r.map(x => x.proname).join(',') === Object.keys(asteptat).sort().join(','), `gărzile care citesc documentul: ${r.map(x => x.proname).join(',')}`)
      for (const x of r) {
        const citiri = x.prosrc.split('\n').filter(l => /FROM public\.dcc_documente x/.test(l)).map(l => l.replace(/--.*$/, '').trim())
        A.ok(citiri.length === 1 && citiri[0] === asteptat[x.proname], `${x.proname}: citirea documentului = ${JSON.stringify(citiri)}`)
      }
    },
  },
]
