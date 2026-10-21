-- Rollback pentru UPDATE-ul din 21.10.2026 pe clarificari_tipare.trigger (22 tipare, decizia Răzvan „A”,
-- docs/cercetare/VALIDARE_FRAZE_TIPARE_2026-10-19.md §5–§6). Merge-ul a fost nedistructiv (trigger || json):
-- `semnal` și `tip_detectie` au rămas neatinse; s-au adăugat chei noi și s-a rescris `unde_cauti` acolo unde JSON-ul îl conținea.
-- Rollback = scoți cheile noi și repui `unde_cauti` de dinainte (snapshot citit 21.10.2026 înainte de UPDATE).
-- Se rulează DOAR cu acordul lui Răzvan (date reale).
UPDATE public.clarificari_tipare t
SET trigger = (t.trigger - ARRAY['fraze','regex','perechi','excluderi','fereastra','conditii','teme','teme_din_text','incredere_fraze','nota_validare','validat_la','aprobat'])
              || jsonb_build_object('unde_cauti', v.u::jsonb)
FROM (VALUES
 ('PAT-GAZ-14', '["caiet_sarcini","contract","F3"]'),
 ('PAT-CAL-01', '["fisa_de_date","caiet_sarcini","planse"]'),
 ('PAT-STD-08', '["caiet_sarcini","fisa_de_date","contract"]'),
 ('PAT-CAL-04', '["fisa_de_date"]'),
 ('PAT-CAL-15', '["fisa_de_date"]'),
 ('PAT-CAL-05', '["fisa_de_date"]'),
 ('PAT-CAL-07', '["fisa_de_date"]'),
 ('PAT-GAZ-10', '["fisa_de_date","caiet_sarcini","planse"]'),
 ('PAT-STD-15', '["caiet_sarcini","F3"]'),
 ('PAT-AMB-11', '["fisa_de_date"]'),
 ('PAT-AMB-13', '["fisa_de_date","F3","contract"]'),
 ('PAT-CTR-04', '["caiet_sarcini","fisa_de_date"]'),
 ('PAT-TRM-06', '["fisa_de_date","caiet_sarcini"]'),
 ('PAT-GAR-01', '["fisa_de_date"]'),
 ('PAT-GAR-03', '["contract","fisa_de_date"]'),
 ('PAT-AMB-02', '["fisa_de_date"]'),
 ('PAT-STD-01', '["caiet_sarcini"]'),
 ('PAT-STD-09', '["caiet_sarcini","fisa_de_date"]'),
 ('PAT-GAZ-15', '["caiet_sarcini","fisa_de_date","F3"]'),
 ('PAT-CTC-08', '["fisa_de_date","contract"]'),
 ('PAT-INF-09', '["caiet_sarcini","F3"]'),
 ('PAT-STD-07', '["caiet_sarcini","F3"]')
) AS v(pid, u)
WHERE t.pattern_id = v.pid
RETURNING t.pattern_id;
