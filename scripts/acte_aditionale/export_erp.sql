-- Export ERP pentru verificarea saptamanala a actelor aditionale + GBE / polite CAR (task #15, automatizari #69). DOAR SELECT.
-- Claude il ruleaza prin Supabase MCP si scrie rezultatul (coloana erp) in C:\Users\Public\paw\acte\<AAAA-LL-ZZ>\erp.md
-- proiecte.tsv se exporta separat:
--   SELECT E'id\tcod\tcale\n' || string_agg(id || E'\t' || cod_intern || E'\t' || coalesce(nas_folder_path,''), E'\n' ORDER BY id) FROM executie_proiecte WHERE activ AND id <> 24;
-- 21.11.2026 (GBE / CAR): data de referinta = ziua din Europe/Bucharest (nu CURRENT_DATE UTC); la polite: moneda, data emiterii,
--   garantie_pana_la, data emiterii actelor si valorile EFECTIVE (cu actele) + zilele pana la expirare din fn_polite_scadente
--   (singura definitie, aceeasi ca alertele; doar pentru politele active); Registrul de garantii (garantii) GBE / CAR nelegat de o polita
--   de pe contract (cele legate apar deja la `polite contract`); numarul contractului si beneficiarul. Fara IBAN / cont.
WITH azi AS (SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date AS d),
p AS (SELECT id, cod_intern, contract_id, valoare_lei, garantie_buna_exec_pct FROM executie_proiecte WHERE activ AND id<>24),
ct AS (SELECT c.id, c.numar_contract, b.nume AS beneficiar FROM contracte_terti c LEFT JOIN beneficiari b ON b.id = c.beneficiar_id),
sc AS (SELECT DISTINCT ON (cheie) cheie, valoare, data_expirare, zile FROM fn_polite_scadente(NULL) ORDER BY cheie),
a AS (SELECT contract_id, string_agg(format('[AA id=%s nr=%s data=%s tip=%s valoare_noua=%s termen_nou=%s]', id, numar_act, data_semnare, tip, valoare_noua_lei, data_termen_noua), ' ' ORDER BY data_semnare NULLS LAST, id) acte FROM contracte_acte_aditionale GROUP BY contract_id),
e AS (SELECT proiect_id, string_agg(format('[EXEC id=%s nr=%s data=%s delta=%s activ=%s]', id, numar_act, data_semnare, modificare_valoare_lei, activ), ' ' ORDER BY data_semnare) ex FROM executie_acte_aditionale GROUP BY proiect_id),
pol AS (SELECT cp.contract_id, string_agg(format('[POLITA id=%s tip=%s asigurator=%s nr=%s moneda=%s valoare=%s emisa=%s exp=%s garantie_pana_la=%s status=%s | efectiv cu actele: valoare=%s exp=%s zile=%s | acte: %s]',
          cp.id, cp.tip, cp.asigurator, cp.nr_polita, cp.moneda, cp.valoare_lei, cp.data_emitere, cp.data_expirare, cp.garantie_pana_la, cp.status,
          coalesce(sc.valoare::text,'-'), coalesce(sc.data_expirare::text,'-'), coalesce(sc.zile::text,'-'),
          coalesce((SELECT string_agg(format('AA %s emis=%s val_noua=%s exp_noua=%s', pa.nr_act, pa.data_emitere, pa.valoare_noua_lei, pa.data_expirare_noua), ', ' ORDER BY pa.data_emitere, pa.nr_act, pa.id) FROM contracte_polite_acte pa WHERE pa.polita_id=cp.id),'-')), ' ' ORDER BY cp.id) pol
        FROM contracte_polite cp LEFT JOIN sc ON sc.cheie = 'contract:' || cp.id GROUP BY cp.contract_id),
gp AS (SELECT contract_id, string_agg(format('[GBE_POLITA id=%s nr=%s emitent=%s valoare=%s emisa=%s exp=%s zile=%s activ=%s]', id, numar_polita, emitent, valoare_lei, data_emitere, data_expirare,
          coalesce((data_expirare - (SELECT d FROM azi))::text,'-'), activ), ' ' ORDER BY id) gp FROM gbe_polite GROUP BY contract_id),
gr AS (SELECT g.contract_terti_id, string_agg(format('[REGISTRU id=%s tip=%s forma=%s emitent=%s nr=%s moneda=%s valoare=%s emisa=%s exp=%s zile=%s stare=%s beneficiar=%s]',
          g.id, g.tip, g.forma, g.emitent, g.numar_document, g.moneda, g.valoare, g.data_emitere, g.data_expirare,
          coalesce(sc.zile::text, (g.data_expirare - (SELECT d FROM azi))::text, '-'), g.stare, g.beneficiar), ' ' ORDER BY g.id) gr
        FROM garantii g LEFT JOIN sc ON sc.cheie = 'registru:' || g.id
       WHERE g.tip IN ('buna_executie','car') AND g.contract_polita_id IS NULL AND g.contract_terti_id IS NOT NULL GROUP BY g.contract_terti_id),
s AS (SELECT proiect_id, sum(valoare_ajustare_lei) aj, count(*) FILTER (WHERE coalesce(valoare_ajustare_lei,0)<>0) n_aj, count(*) n_sl FROM executie_situatii_plata GROUP BY proiect_id)
SELECT E'# ERP la ' || (SELECT d FROM azi) || E' (data de referinta, Europe/Bucharest; valori fara TVA, lei)\n\n' || string_agg(format(E'## P%s %s\ncontract_id=%s | contract nr=%s | beneficiar=%s | contract valoare_initiala=%s | valoare_actuala_calc=%s | executie_proiecte.valoare_lei=%s | GBE procent=%s\nacte contract: %s\nacte executie: %s\npolite contract (GBE/CAR/GPL/avans/altul): %s\npolite GBE (evidenta GBE): %s\nregistru garantii GBE/CAR nelegate: %s\nSL: %s situatii, %s cu ajustare, suma ajustari=%s\n',
  p.id, p.cod_intern, coalesce(p.contract_id::text,'-'), coalesce(ct.numar_contract,'-'), coalesce(ct.beneficiar,'-'), coalesce(v.valoare_initiala::text,'-'), coalesce(v.valoare_actuala_calc::text,'-'), p.valoare_lei, coalesce(p.garantie_buna_exec_pct::text,'-'),
  coalesce(a.acte,'-'), coalesce(e.ex,'-'), coalesce(pol.pol,'-'), coalesce(gp.gp,'-'), coalesce(gr.gr,'-'), coalesce(s.n_sl,0), coalesce(s.n_aj,0), coalesce(s.aj,0)), E'\n' ORDER BY p.id) AS erp
FROM p LEFT JOIN ct ON ct.id=p.contract_id LEFT JOIN v_contract_efecte_acte v ON v.contract_id=p.contract_id LEFT JOIN a ON a.contract_id=p.contract_id LEFT JOIN e ON e.proiect_id=p.id
LEFT JOIN pol ON pol.contract_id=p.contract_id LEFT JOIN gp ON gp.contract_id=p.contract_id LEFT JOIN gr ON gr.contract_terti_id=p.contract_id LEFT JOIN s ON s.proiect_id=p.id;
