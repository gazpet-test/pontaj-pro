-- Live alerts: no notifications, cron, external messages or persisted side effects.
CREATE FUNCTION public.fn_izo_teren_praguri(p_proiect bigint) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT jsonb_build_object('toleranta_mm',c.toleranta_mm) FROM public.izo_proiect_config c
 WHERE c.proiect_id=p_proiect AND public.fn_izo_citire(p_proiect)
$f$;
CREATE VIEW public.v_izo_alerte WITH (security_invoker=on) AS
 SELECT 'izo_lungime_diferita_aviz'::text AS cod,d.proiect_id,d.tronson_id,d.id AS declaratie_id,b.id AS bucata_id,
  NULL::bigint AS sudura_id,true AS blocanta,
  jsonb_build_object('aviz_mm',b.lungime_aviz_mm,'stoc_mm',b.lungime_mm,'declarat_mm',n.mm,'versiune',d.versiune) AS detalii
 FROM public.izo_declaratii d
 JOIN public.magazie_bucati b ON b.id=coalesce(d.sursa_bucata_id,d.bucata_id) OR b.uid=coalesce(d.sursa_decl_uid,d.bucata_decl_uid)
 CROSS JOIN LATERAL (SELECT CASE WHEN d.tip='taiere' THEN (d.payload->>'baza_mm')::integer
  ELSE coalesce((d.payload#>>'{confirmare,masurata_mm}')::integer,(d.payload->>'lungime_masurata_mm')::integer) END AS mm) n
 WHERE d.stare NOT IN ('aprobata','respinsa','stearsa') AND d.tip<>'cuplare' AND n.mm IS NOT NULL
  AND ((d.payload#>>'{confirmare,mod}'='marcaj_diferit' AND n.mm<>b.lungime_mm)
    OR (d.payload#>>'{confirmare,mod}'='masurat' AND abs(n.mm-b.lungime_mm)>
     coalesce((SELECT (c->>'toleranta_mm')::integer FROM public.fn_izo_teren_praguri(d.proiect_id) c),20)))
 UNION ALL
 SELECT 'izo_tranzitie_perete_neconfirmata',s.proiect_id,s.tronson_id,s.declaratie_id,NULL::bigint,s.id,true,
  jsonb_build_object('nr',s.nr,'sufix',s.sufix)
 FROM public.izo_suduri s WHERE s.stare='aprobata' AND s.tranzitie_perete AND s.tranzitie_confirmata_de IS NULL;
REVOKE ALL ON public.v_izo_alerte FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_izo_alerte TO authenticated;

CREATE FUNCTION public.fn_izo_emitere_blocaje(p_bucati bigint[]) RETURNS text[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT coalesce(array_agg(DISTINCT a.cod ORDER BY a.cod),'{}') FROM public.v_izo_alerte a
 WHERE (a.bucata_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.magazie_bucati b JOIN public.magazie_bucati src
  ON coalesce(src.radacina_id,src.id)=coalesce(b.radacina_id,b.id) WHERE b.id=ANY(p_bucati) AND src.id=a.bucata_id))
 OR (a.sudura_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_suduri_capete c WHERE c.sudura_id=a.sudura_id AND c.activ AND c.bucata_id=ANY(p_bucati)))
$f$;
CREATE FUNCTION public.fn_izo_fisa_verifica(p_decl bigint) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_blocaje text[]; v_ids bigint[];
BEGIN
 SELECT * INTO v_d FROM public.izo_declaratii WHERE id=p_decl;
 IF v_d.id IS NULL OR NOT public.fn_izo_citire(v_d.proiect_id) THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 SELECT array_agg(b.id ORDER BY b.id) INTO v_ids FROM public.magazie_bucati b
 WHERE b.id=coalesce(v_d.bucata_id,v_d.sursa_bucata_id) OR b.uid=coalesce(v_d.bucata_decl_uid,v_d.sursa_decl_uid)
 OR b.uid IN (SELECT c.uid FROM public.izo_bucati_declarate c WHERE c.declaratie_id=p_decl);
 v_blocaje:=public.fn_izo_emitere_blocaje(v_ids);
 IF cardinality(v_blocaje)>0 THEN RAISE EXCEPTION 'emitere_blocata: %',v_blocaje; END IF;
 RETURN true;
END $f$;
