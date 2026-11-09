-- Revenire 20261123a (r2, după Copilot P1-03 / Jakarinos P1-4): REFUZĂ dacă în coloanele noi există date
-- (bazele confirmate de om + urmele verificării automate nu se pierd în tăcere).
-- Ordinea: 1) redeploy normative-scan-lunar v10 (v11 cere coloanele); 2) dacă există date, întâi export + „da” explicit
-- de la Răzvan, apoi golirea lor separat (preview → da → UPDATE … RETURNING); 3) abia apoi acest script, prin runner.
-- Rulează doar prin runner (garda gazpet.livrare_migrare legată de txid), într-o singură tranzacție.
DO $rev$
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
 IS DISTINCT FROM '20261123a_normative_sursa_oficiala_ROLLBACK:'||txid_current() THEN RAISE EXCEPTION 'NSO-R numai runner postgres'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 LOCK TABLE public.ofertare_normative IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.ofertare_normative'::regclass
     AND attname IN ('legislatie_doc_id','forma_oficiala_la','verificat_auto_la','verificare_auto') AND NOT attisdropped) <> 4
 THEN RAISE EXCEPTION 'NSO-R schema nu corespunde migrarii 20261123a (coloane lipsa)'; END IF;
 IF EXISTS (SELECT 1 FROM public.ofertare_normative WHERE legislatie_doc_id IS NOT NULL OR forma_oficiala_la IS NOT NULL
            OR verificat_auto_la IS NOT NULL OR verificare_auto IS NOT NULL)
 THEN RAISE EXCEPTION 'NSO-R refuz: exista date in coloanele 20261123a — export + da Razvan + golire separata, apoi reia'; END IF;
END $rev$;

DROP TRIGGER trg_normative_urma_auto ON public.ofertare_normative;
DROP FUNCTION public.fn_normative_urma_auto_garda();
ALTER TABLE public.ofertare_normative
  DROP COLUMN verificare_auto,
  DROP COLUMN verificat_auto_la,
  DROP COLUMN forma_oficiala_la,
  DROP COLUMN legislatie_doc_id;
