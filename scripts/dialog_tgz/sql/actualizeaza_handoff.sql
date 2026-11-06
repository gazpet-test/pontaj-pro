-- Dialog TGZ (e): inlocuieste DOAR randul "Dialog TGZ: ultimul procesat: juridic#NNN..." din handoff_activ.
-- Interogare FIXA. Variabile psql (validate de orchestrator inainte de apel, numai cifre / hex / data):
--   md5_vechi  = md5(content_md) citit la pasul (a)              ^[0-9a-f]{32}$
--   md5_nou    = md5 al textului calculat local de orchestrator   ^[0-9a-f]{32}$
--   nr_juridic = ultimul juridic#NNN procesat                     ^[0-9]{3}$
--   nr_claude  = claude#NNN scris acum                            ^[0-9]{3}$
--   cand       = momentul procesarii                              ^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$
-- Garzi: (1) md5 vechi = handoff-ul nu s-a schimbat intre timp; (2) exact un rand-marcaj in text;
--        (3) rezultatul inlocuirii din BD = exact textul calculat local (aceeasi regula, verificata prin md5).
-- 0 randuri intoarse = orchestratorul NU forteaza, scrie EROARE in stare.
BEGIN;
UPDATE public.claude_docs d
SET content_md = regexp_replace(
      d.content_md,
      'Dialog TGZ: ultimul procesat: juridic#[0-9]{3}[^\r\n]*',
      'Dialog TGZ: ultimul procesat: juridic#' || :'nr_juridic' || ' (raspuns claude#' || :'nr_claude' || ', ' || :'cand' || ')')
WHERE d.slug = 'handoff_activ'
  AND md5(d.content_md) = :'md5_vechi'
  AND (SELECT count(*) FROM regexp_matches(d.content_md, 'Dialog TGZ: ultimul procesat: juridic#[0-9]{3}', 'g')) = 1
  AND md5(regexp_replace(
        d.content_md,
        'Dialog TGZ: ultimul procesat: juridic#[0-9]{3}[^\r\n]*',
        'Dialog TGZ: ultimul procesat: juridic#' || :'nr_juridic' || ' (raspuns claude#' || :'nr_claude' || ', ' || :'cand' || ')')) = :'md5_nou'
RETURNING 'ACTUALIZAT|' || md5(d.content_md);
COMMIT;
