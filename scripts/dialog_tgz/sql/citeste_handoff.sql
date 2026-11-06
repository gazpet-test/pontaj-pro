-- Dialog TGZ (a): citeste handoff_activ. Interogare FIXA, fara parametri.
-- Iesire: o singura linie "md5|base64(UTF-8)" (base64 fara linii noi), ca textul sa ajunga exact,
-- octet cu octet, in orchestrator (md5-ul se verifica si local).
BEGIN READ ONLY;
SELECT md5(content_md) || '|' || translate(encode(convert_to(content_md, 'UTF8'), 'base64'), E'\n\r', '')
FROM public.claude_docs
WHERE slug = 'handoff_activ';
COMMIT;
