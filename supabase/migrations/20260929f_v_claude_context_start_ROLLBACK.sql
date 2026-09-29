-- Rollback 20260929f: elimină view-ul de pornire (v_claude_context_smart rămâne neatins).
-- Pasul de date asociat (NU e în migrare): claude_context 1103, 1108 au fost trecute active=false pe 29.09;
-- revenire: UPDATE public.claude_context SET active = true WHERE id IN (1103, 1108);
DROP VIEW IF EXISTS public.v_claude_context_start;
