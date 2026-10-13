-- Export ERP pentru verificarea saptamanala a actelor aditionale (task #15, automatizari #69). DOAR SELECT.
-- Claude il ruleaza prin Supabase MCP si scrie rezultatul (coloana erp) in C:\Users\Public\paw-data\acte\<AAAA-LL-ZZ>\erp.md
-- proiecte.tsv se exporta separat:
--   SELECT E'id\tcod\tcale\n' || string_agg(id || E'\t' || cod_intern || E'\t' || coalesce(nas_folder_path,''), E'\n' ORDER BY id) FROM executie_proiecte WHERE activ AND id <> 24;
WITH p AS (SELECT id, cod_intern, contract_id, valoare_lei, garantie_buna_exec_pct FROM executie_proiecte WHERE activ AND id<>24),
a AS (SELECT contract_id, string_agg(format('[AA id=%s nr=%s data=%s tip=%s valoare_noua=%s termen_nou=%s]', id, numar_act, data_semnare, tip, valoare_noua_lei, data_termen_noua), ' ' ORDER BY data_semnare NULLS LAST, id) acte FROM contracte_acte_aditionale GROUP BY contract_id),
e AS (SELECT proiect_id, string_agg(format('[EXEC id=%s nr=%s data=%s delta=%s activ=%s]', id, numar_act, data_semnare, modificare_valoare_lei, activ), ' ' ORDER BY data_semnare) ex FROM executie_acte_aditionale GROUP BY proiect_id),
pol AS (SELECT cp.contract_id, string_agg(format('[POLITA id=%s tip=%s %s nr=%s valoare=%s exp=%s status=%s acte: %s]', cp.id, cp.tip, cp.asigurator, cp.nr_polita, cp.valoare_lei, cp.data_expirare, cp.status,
          coalesce((SELECT string_agg(format('AA %s val_noua=%s exp_noua=%s', pa.nr_act, pa.valoare_noua_lei, pa.data_expirare_noua), ', ' ORDER BY pa.data_emitere) FROM contracte_polite_acte pa WHERE pa.polita_id=cp.id),'-')), ' ') pol
        FROM contracte_polite cp GROUP BY cp.contract_id),
gp AS (SELECT contract_id, string_agg(format('[GBE_POLITA id=%s nr=%s %s valoare=%s exp=%s activ=%s]', id, numar_polita, emitent, valoare_lei, data_expirare, activ), ' ') gp FROM gbe_polite GROUP BY contract_id),
s AS (SELECT proiect_id, sum(valoare_ajustare_lei) aj, count(*) FILTER (WHERE coalesce(valoare_ajustare_lei,0)<>0) n_aj, count(*) n_sl FROM executie_situatii_plata GROUP BY proiect_id)
SELECT E'# ERP la ' || now()::date || E' (valori fara TVA, lei)\n\n' || string_agg(format(E'## P%s %s\ncontract_id=%s | contract valoare_initiala=%s | valoare_actuala_calc=%s | executie_proiecte.valoare_lei=%s | GBE procent=%s\nacte contract: %s\nacte executie: %s\npolite contract: %s\npolite GBE: %s\nSL: %s situatii, %s cu ajustare, suma ajustari=%s\n',
  p.id, p.cod_intern, coalesce(p.contract_id::text,'-'), coalesce(v.valoare_initiala::text,'-'), coalesce(v.valoare_actuala_calc::text,'-'), p.valoare_lei, coalesce(p.garantie_buna_exec_pct::text,'-'),
  coalesce(a.acte,'-'), coalesce(e.ex,'-'), coalesce(pol.pol,'-'), coalesce(gp.gp,'-'), coalesce(s.n_sl,0), coalesce(s.n_aj,0), coalesce(s.aj,0)), E'\n' ORDER BY p.id) AS erp
FROM p LEFT JOIN v_contract_efecte_acte v ON v.contract_id=p.contract_id LEFT JOIN a ON a.contract_id=p.contract_id LEFT JOIN e ON e.proiect_id=p.id
LEFT JOIN pol ON pol.contract_id=p.contract_id LEFT JOIN gp ON gp.contract_id=p.contract_id LEFT JOIN s ON s.proiect_id=p.id;
