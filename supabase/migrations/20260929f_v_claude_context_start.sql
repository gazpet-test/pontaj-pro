-- v_claude_context_start: contextul de la PORNIREA sesiunii Claude, redus (decizia Răzvan 29.09.2026 „1+2”, claude_context #1490).
-- Itemii 'critical' vin cu textul întreg; restul doar id + titlu + lungimea detaliilor (citite la cerere din claude_context).
-- Aceleași filtre ca v_claude_context_smart (se construiește peste el); view-ul vechi rămâne neschimbat.
-- Înainte: ~1,23M caractere la pornire (~810k după dezactivarea backup-urilor 1103/1108); după: ~233k.
CREATE OR REPLACE VIEW public.v_claude_context_start WITH (security_invoker = on) AS
SELECT s.id,
       s.category,
       s.priority,
       s.title,
       CASE WHEN s.priority = 'critical' THEN s.content END AS content,
       CASE WHEN s.priority = 'critical' THEN NULL ELSE length(s.content) END AS lungime_detalii,
       s.todo_section,
       s.todo_completed,
       s.created_at
FROM public.v_claude_context_smart s;

REVOKE ALL ON public.v_claude_context_start FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_claude_context_start TO authenticated, service_role;

COMMENT ON VIEW public.v_claude_context_start IS
  'Context de pornire Claude: critical = text întreg; restul = titlu + lungime (detalii: SELECT content FROM claude_context WHERE id IN (...)). RLS owner-only prin security_invoker pe claude_context.';
