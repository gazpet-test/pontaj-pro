// Fixtura comună fix_baza (planul, „Ordinea de execuție”): rânduri sintetice inserate DIRECT ca postgres, valide față de TOATE triggerele din
// secțiunea 4 (un trigger care o refuză = fixtura sau triggerul e greșit; nu se ocolește). Plus șabloanele de rând valide pentru sondele
// directe în modul replica (fără chei străine verificate: id-urile pot lipsi).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, U, lit } from './baza.mjs'

export const CAZURI = JSON.parse(readFileSync(join(ROOT, 'src/dcc/dccCodCazuri.json'), 'utf8'))
export const F = CAZURI.formate
const J = o => `${lit(JSON.stringify(o))}::jsonb`
export const H = c => c.repeat(64)

// valorile fiecărui ghid de test (aceleași în toate)
export const VALORI = [['emitent', 'AAA', false], ['emitent', 'SUB', false], ['tematica', 'TM1', false], ['tematica', 'TM2', false], ['tematica', 'TS', false],
  ['tip', 'COR', false], ['tip', 'RAP', false], ['tip', 'DES', false], ['tip', 'MOM', true], ['limba', 'RO', false], ['limba', 'EN', false], ['limba', 'BI', false]]

export const FIX_BAZA = `
INSERT INTO public.dcc_ghiduri (id, cod, versiune, sursa, format_cod, format_fisier) VALUES
  (1, 'GL1', 1, 'ghid sintetic lot 1', ${J(F.lot1)}, ${J(F.lot1)}),
  (2, 'GDDE', 1, 'ghid sintetic DDE', ${J(F.dde)}, ${J(F.dde)}),
  (3, 'GDDE3', 1, 'ghid sintetic SR1 ingust', ${J(F.dde)}, ${J(F.dde)}),
  (4, 'GL1', 2, 'ghid sintetic fara SR', ${J(F.lot1)}, ${J(F.lot1)}),
  (5, 'GDDE5', 1, 'ghid sintetic SR1 egal', ${J(F.dde)}, ${J(F.dde)}),
  (6, 'GL6', 1, 'ghid sintetic fila F', ${J(F.g6_fila_f)}, ${J(F.g6_fila_f)});
INSERT INTO public.dcc_ghid_valori (ghid_id, categorie, cod, fara_tematica)
  SELECT g, v.c, v.k, v.f FROM generate_series(1, 6) g,
    (VALUES ${VALORI.map(([c, k, f]) => `('${c}', '${k}', ${f})`).join(', ')}) v(c, k, f) ORDER BY g, v.c, v.k;
INSERT INTO public.dcc_ghid_intervale (ghid_id, interval, limita_inf, limita_sup) VALUES
  (1, 'general', 1, 99999),
  (2, 'SR1', 100, 199), (2, 'SR2', 200, 299), (2, 'general', 300, 99999),
  (3, 'SR1', 100, 150), (3, 'general', 300, 99999),
  (4, 'general', 1, 99999),
  (5, 'SR1', 100, 199), (5, 'general', 300, 99999),
  (6, 'general', 1, 99999);
INSERT INTO public.dcc_contracte (id, beneficiar, cod_contract, mod_alocare, creat_prin) VALUES
  (1, 'BEN', '30', 'automat', 'server'), (2, 'ALT', '30', 'automat', 'server'), (3, 'BEN', '43', 'automat', 'server'), (4, 'BEN', '29', 'manual', 'server');
INSERT INTO public.dcc_proiecte (id, contract_id, executie_proiect_id, ghid_id, emitent, limba_implicita, adresa_dcc, cc_lista) VALUES
  (1, 1, 1, 1, 'AAA', 'RO', 'dcc@exemplu.invalid', ARRAY['cc@exemplu.invalid']),
  (2, 1, 2, 1, 'AAA', 'RO', 'dcc@exemplu.invalid', '{}'),
  (3, 3, 3, 1, 'AAA', 'RO', 'dcc@exemplu.invalid', '{}'),
  (4, 4, 4, 1, 'AAA', 'RO', NULL, '{}');
INSERT INTO public.dcc_serii (id, contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf, limita_sup, prag_initial, ultimul_ocupat, motiv_prag, initializata_prin) VALUES
  (1, 1, 'AAA', 'TM1', 'COR', 'general', 1, 1, 99999, 44, 46, 'prag sintetic', 'server'),
  (2, 1, 'AAA', 'TM1', 'DES', 'general', 1, 1, 99999, 9, 11, 'prag sintetic', 'server'),
  (3, 3, 'AAA', 'TM2', 'COR', 'general', 1, 1, 99999, 0, 1, 'prag sintetic', 'server');
INSERT INTO public.dcc_documente (id, contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de) VALUES
  (1, 1, 1, 'AAA', 'TM1', 'COR', 45, 'general', 1, 'automat', 'Raport unu', false, '${U.L1}'),
  (2, 1, 2, 'AAA', 'TM1', 'COR', 46, 'general', 1, 'automat', 'Raport doi', false, '${U.ED}'),
  (3, 1, 1, 'AAA', 'TM1', 'DES', 10, 'general', 2, 'automat', 'Plan cu file', true, '${U.L1}'),
  (4, 1, 1, 'AAA', 'TM1', 'DES', 11, 'general', 2, 'automat', 'Plan anulat', true, '${U.L1}'),
  (5, 3, 3, 'AAA', 'TM2', 'COR', 1, 'general', 3, 'automat', 'Raport lot 43', false, '${U.ED}');
INSERT INTO public.dcc_file (id, document_id, fila, titlu) VALUES (1, 3, 1, 'Plansa 1'), (2, 3, 2, 'Plansa 2'), (3, 4, 1, 'Plansa 1');
INSERT INTO public.dcc_anexe (id, document_id, numar, titlu) VALUES (1, 3, 1, 'Anexa unu');
INSERT INTO public.dcc_revizii (id, contract_id, document_id, fila_id, anexa_id, revizie, limba, ghid_id, cod_text, nume_fisier_baza, stare_transport, creat_de) VALUES
  (1, 1, 1, NULL, NULL, 0, 'RO', 1, '30-AAA-TM1-COR-00045.Rev0.RO', '30-AAA-TM1-COR-00045.Rev0.RO', 'trimisa_manual_neverificata', '${U.L1}'),
  (2, 1, 2, NULL, NULL, 0, 'RO', 1, '30-AAA-TM1-COR-00046.Rev0.RO', '30-AAA-TM1-COR-00046.Rev0.RO', 'trimisa_manual_neverificata', '${U.ED}'),
  (3, 1, 3, 1, NULL, 0, 'RO', 1, '30-AAA-TM1-DES-00010-01.Rev0.RO', '30-AAA-TM1-DES-00010-01.Rev0.RO', 'rezervata', '${U.L1}'),
  (4, 1, 3, 2, NULL, 0, 'RO', 1, '30-AAA-TM1-DES-00010-02.Rev0.RO', '30-AAA-TM1-DES-00010-02.Rev0.RO', 'rezervata', '${U.L1}'),
  (5, 1, 3, NULL, 1, 0, 'RO', 1, '30-AAA-TM1-DES-00010-A01.Rev0.RO', '30-AAA-TM1-DES-00010-A01.Rev0.RO', 'rezervata', '${U.L1}'),
  (6, 1, 4, 3, NULL, 0, 'RO', 1, '30-AAA-TM1-DES-00011-01.Rev0.RO', '30-AAA-TM1-DES-00011-01.Rev0.RO', 'rezervata', '${U.L1}'),
  (7, 3, 5, NULL, NULL, 0, 'RO', 1, '43-AAA-TM2-COR-00001.Rev0.RO', '43-AAA-TM2-COR-00001.Rev0.RO', 'rezervata', '${U.ED}');
-- documentul 4 anulat DIRECT (doar documentul, fără cascada RPC-ului): revizia 6 rămâne rezervata (ținta probelor de gardă)
UPDATE public.dcc_documente SET stare = 'anulat', anulat_la = now(), anulat_de = '${U.OWNER}', motiv_anulare = 'anulat in fixtura' WHERE id = 4;
INSERT INTO public.dcc_istoric_aparitii (id, contract_id, proiect_dcc_id, sursa, sursa_id, pozitie, lot_import, valori_originale, cod_scris, emitent, tematica, tip,
    secventa, revizie, probleme, continut_hash, importat_prin) VALUES
  (1, 1, 1, 'excel_registru', 'R-1', 1, 'lot0', '{"rand": 1}', '30-AAA-TM1-COR-45', 'AAA', 'TM1', 'COR', 45, NULL, ARRAY['revizie_necunoscuta'], '${H('1')}', 'server'),
  (2, 1, 2, 'excel_registru', 'R-2', 1, 'lot0', '{"rand": 2}', '30-AAA-TM1-COR-00046.Rev0', 'AAA', 'TM1', 'COR', 46, 0, '{}', '${H('2')}', 'server'),
  (3, 3, 3, 'mail_trimis', 'M-3', 1, 'lot0', '{"rand": 3}', NULL, NULL, NULL, NULL, NULL, NULL, '{}', '${H('3')}', 'server');
INSERT INTO public.dcc_snapshoturi (id, contract_id, proiect_dcc_id, tip, to_lista, subiect, corp, hash, aprobat_de) VALUES
  (1, 1, 1, 'copiat_gmail', ARRAY['dcc@exemplu.invalid'], '30-AAA-TM1-COR-00045.Rev0.RO Raport unu', 'corp sintetic', '${H('a')}', '${U.L1}'),
  (2, 1, 2, 'copiat_gmail', ARRAY['dcc@exemplu.invalid'], '30-AAA-TM1-COR-00046.Rev0.RO Raport doi', 'corp sintetic', '${H('b')}', '${U.ED}');
INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (1, 1), (2, 2);
INSERT INTO public.dcc_mesaje (id, contract_id, proiect_dcc_id, directie, sursa, casuta_declarata, data_mesaj, snapshot_id, dovezi_complete, creat_de) VALUES
  (1, 1, 1, 'trimis', 'manual_declarat', 'eu@exemplu.invalid', now(), 1, false, '${U.L1}'),
  (2, 1, 2, 'trimis', 'manual_declarat', 'eu@exemplu.invalid', now(), 2, false, '${U.ED}');
INSERT INTO public.dcc_legaturi (id, mesaj_id, revizie_id, metoda, stare, autor, confirmat_de, confirmat_la) VALUES
  (1, 1, 1, 'manual', 'confirmata', '${U.L1}', '${U.L1}', now()),
  (2, 2, 2, 'manual', 'confirmata', '${U.ED}', '${U.ED}', now());
SELECT setval(pg_get_serial_sequence('public.' || t, 'id'), 100) FROM unnest(ARRAY['dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte',
  'dcc_proiecte', 'dcc_serii', 'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_mesaje',
  'dcc_legaturi']) t;`

// numărul rândurilor fiecărui proiect DCC din fixtură (scris de mână, nu numărat din fixtură): P1 / P2 / P3
export const FIX_RANDURI_P1 = { dcc_documente: 3, dcc_file: 3, dcc_anexe: 1, dcc_revizii: 5, dcc_istoric_aparitii: 1, dcc_snapshoturi: 1,
  dcc_snapshot_revizii: 1, dcc_mesaje: 1, dcc_legaturi: 1, dcc_proiecte: 1, dcc_contracte: 1 }

// ── șabloanele de rând VALIDE pentru sondele directe (replica: cheile străine nu se verifică; valorile nu se ciocnesc cu fixtura) ──
const UID = `'${U.ED}'`
export const SABLON = {
  dcc_casute: { adresa: "'proba@exemplu.invalid'", tip: "'dedicata'", proprietar: 'NULL', stare_conectare: "'neconectata'" },
  dcc_ghiduri: { cod: "'GPROBA'", versiune: '9', sursa: "'proba'", format_cod: J(F.lot1), format_fisier: J(F.lot1) },
  dcc_ghid_valori: { ghid_id: '999', categorie: "'emitent'", cod: "'ZZZ'", fara_tematica: 'false', activ: 'true' },
  dcc_ghid_intervale: { ghid_id: '999', interval: "'SR9'", limita_inf: '900', limita_sup: '999' },
  dcc_contracte: { beneficiar: "'TST'", cod_contract: "'99'", mod_alocare: "'automat'", creat_prin: "'server'", creat_de: 'NULL' },
  dcc_proiecte: { contract_id: '999', executie_proiect_id: '9', ghid_id: '1', emitent: "'AAA'", limba_implicita: 'NULL', adresa_dcc: 'NULL',
    casuta_id: 'NULL', trimitere_permisa: 'false', plafon_atasamente_mb: '15', cc_implicit: "'{}'::jsonb", versiune: '1' },
  dcc_intentii: { cheie: "'00000000-0000-4000-8000-0000000000f1'", operatie: "'aloca'", parametri_hash: `'${H('d')}'`, autor: UID, actor: "'om'" },
  dcc_serii: { contract_id: '999', emitent: "'AAA'", tematica: "'TS'", tip: "'RAP'", interval: "'general'", ghid_id: '1', limita_inf: '1', limita_sup: '99999',
    prag_initial: '0', ultimul_ocupat: '0', motiv_prag: "'proba'", initializata_prin: "'server'", initializata_de: 'NULL' },
  dcc_documente: { contract_id: '999', proiect_dcc_id: '999', emitent: "'AAA'", tematica: "'TS'", tip: "'RAP'", secventa: '500', interval: "'general'",
    serie_id: '999', mod: "'automat'", titlu: "'Proba'", are_file: 'false', stare: "'activ'", anulat_la: 'NULL', anulat_de: 'NULL', motiv_anulare: 'NULL',
    creat_de: UID },
  dcc_file: { document_id: '999', fila: '50' },
  dcc_anexe: { document_id: '999', numar: '50', titlu: "'Anexa proba'" },
  dcc_revizii: { contract_id: '999', document_id: '999', fila_id: 'NULL', anexa_id: 'NULL', revizie: '50', limba: "'RO'", ghid_id: '1', cod_text: "'PROBA-50'",
    nume_fisier_baza: "'PROBA-50'", stare_transport: "'rezervata'", anulata_la: 'NULL', anulata_de: 'NULL', anulata_prin: 'NULL', motiv_anulare: 'NULL',
    verdict: 'NULL', verdict_mesaj_id: 'NULL', verdict_confirmat_de: 'NULL', verdict_confirmat_la: 'NULL', creat_de: UID },
  dcc_istoric_aparitii: { contract_id: '999', proiect_dcc_id: '999', sursa: "'excel_registru'", sursa_id: "'proba-1'", pozitie: '1', lot_import: "'lot_proba'",
    valori_originale: "'{}'::jsonb", cod_scris: 'NULL', secventa: 'NULL', fila: 'NULL', anexa: 'NULL', revizie: 'NULL', limba: 'NULL', probleme: "'{}'::text[]",
    continut_hash: `'${H('e')}'`, importat_prin: "'server'", importat_de: 'NULL' },
  dcc_snapshoturi: { contract_id: '999', proiect_dcc_id: '999', tip: "'copiat_gmail'", to_lista: "ARRAY['dcc@exemplu.invalid']", subiect: "'S'", corp: "'C'",
    manifest: "'[]'::jsonb", hash: `'${H('f')}'`, aprobat_de: UID },
  dcc_snapshot_revizii: { snapshot_id: '999', revizie_id: '999' },
  dcc_mesaje: { contract_id: '999', proiect_dcc_id: '999', directie: "'trimis'", sursa: "'manual_declarat'", casuta_declarata: "'eu@exemplu.invalid'",
    rfc_message_id: 'NULL', gmail_message_id: 'NULL', gmail_thread_id: 'NULL', casuta_id: 'NULL', data_mesaj: 'now()', dovezi_complete: 'false' },
  dcc_legaturi: { mesaj_id: '999', revizie_id: '999', metoda: "'manual'", dovada: "'{}'::jsonb", stare: "'propusa'", verdict_propus: 'NULL',
    confirmat_la: 'NULL' },
}
// INSERT-ul unui rând valid cu modificările date ({col: expresie SQL})
export const insereaza = (tabel, mod = {}) => {
  const r = { ...SABLON[tabel], ...mod }
  const cols = Object.keys(r)
  return `INSERT INTO public.${tabel} (${cols.join(', ')}) VALUES (${cols.map(c => r[c]).join(', ')})`
}
