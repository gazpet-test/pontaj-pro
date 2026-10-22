#!/usr/bin/env bash
# Sourced by test_izometrie_e3b.sh, on its isolated *_test database only.
# E1 supplies cursa/asteapta/q. Every section checks its NOTICE marker.
CA_G="${CA_R/000000000121/000000000030}"
CA_M="${CA_R/000000000121/000000000117}"
e2_sfarsit() {
  local out
  out="$(q "DO \$end\$ BEGIN RAISE NOTICE 'TESTE E3b-E2-$1: TOATE OK'; END \$end\$;" 2>&1)" || esec "E2-$1 marker"
  grep -qF "TESTE E3b-E2-$1: TOATE OK" <<<"$out" || esec "E2-$1 incomplet"
  ok "E2-$1"
}
e2_assert() { [ "$(q "SELECT coalesce(($2),false)")" = t ] || esec "$1"; }
e2_bucata() {
  BID="$(q "SELECT id FROM public.magazie_bucati WHERE serie='E2-$1'")"
  VER="$(q "SELECT server_ver FROM public.magazie_bucati WHERE id=$BID")"
  [[ "$BID" =~ ^[0-9]+$ && "$VER" =~ ^[0-9]+$ ]] || esec 'E2 fixture fara id/server_ver'
}
e2_propune() {
  q "BEGIN; $CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','E2 cursa $BID'); COMMIT" >/dev/null
  COR="$(q "SELECT id FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa'")"
  [[ "$COR" =~ ^[0-9]+$ ]] || esec 'E2 propunere absenta'
}
e2_stare() {
  e2_assert "E2 corectie $COR / $1" "(SELECT stare='$1' AND versiune=2 FROM public.izo_corectii WHERE id=$COR)
    AND (SELECT stare='$2' AND perete_mm=8 FROM public.magazie_bucati WHERE id=$BID)
    AND (SELECT count(*)=$3 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id='$COR')
    AND (SELECT count(*)=$3 FROM public.magazie_bucati_miscari WHERE eveniment_id=(SELECT eveniment_id FROM public.izo_corectii WHERE id=$COR))"
}

# 1. Decisions serialize on the proposal row, in BOTH orders.
for decizie in retrage respinge; do
  if [ "$decizie" = retrage ]; then ca_dec="$CA_G"; st_dec=retrasa; n=01; else ca_dec="$CA_M"; st_dec=respinsa; n=03; fi
  e2_bucata "$n"; e2_propune
  cursa "aproba -> $decizie" "$CA_R; SELECT public.fn_izo_cor_aproba($COR,1)" \
    "BEGIN; $ca_dec; SELECT public.fn_izo_cor_$decizie($COR,1,'decizie concurenta'); COMMIT" err '40001' transactionid
  e2_stare aplicata carantina 1
  if [ "$decizie" = retrage ]; then n=02; else n=04; fi
  e2_bucata "$n"; e2_propune
  cursa "$decizie -> aproba" "$ca_dec; SELECT public.fn_izo_cor_$decizie($COR,1,'decizie concurenta')" \
    "BEGIN; $CA_R; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT" err '40001' transactionid
  e2_stare "$st_dec" receptionat 0
done
e2_sfarsit DECIZII

# 2. Compatible SHARE locks; the wait is on the uncommitted unique index entry.
for final in COMMIT ROLLBACK; do
  if [ "$final" = COMMIT ]; then n=05; rezultat=err; tipar=23505; else n=06; rezultat=ok; tipar=corectie_id; fi
  e2_bucata "$n"
  prop="SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','E2 propuneri concurente')"
  cursa "propune x propune / $final" "$CA_G; $prop" "BEGIN; $CA_G; $prop; COMMIT" "$rezultat" "$tipar" transactionid "$final"
  e2_assert 'E2 index deschisa / fara efecte registru' "(SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa')
    AND (SELECT stare='receptionat' AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
    AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol<>'nascut')"
done
e2_sfarsit PROPUNERI

# 3. Second field correction uses the version captured BEFORE either transaction.
e2_bucata 07
cursa 'camp x camp / CAS' "$CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','camp castigator E2')" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":10}','camp pierzator E2'); COMMIT" err 40001 transactionid
e2_assert 'E2 camp CAS efect unic' "(SELECT perete_mm=9 AND server_ver<>$VER FROM public.magazie_bucati WHERE id=$BID)
  AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='aplicata')
  AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='corectat')"
e2_sfarsit CAMP

# 4. Exact four cases from §4. Cases 1/3 must NOT wait on the unique index.
e2_bucata 08; e2_propune
cursa 'direct / propunere comisa neatinsa' 'SELECT 1' \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','direct E2'); COMMIT" err 23505 none
e2_assert 'E2 propunere intacta' "(SELECT stare='propusa' AND versiune=1 FROM public.izo_corectii WHERE id=$COR)
  AND (SELECT perete_mm=8 AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)"
e2_bucata 09; e2_propune
cursa 'direct / aprobare in zbor' "$CA_R; SELECT public.fn_izo_cor_aproba($COR,1)" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','direct E2'); COMMIT" err 40001 transactionid
e2_stare aplicata carantina 1
e2_bucata 10; e2_propune
cursa 'direct / retragere in zbor' "$CA_G; SELECT public.fn_izo_cor_retrage($COR,1,'retragere E2')" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','direct E2'); COMMIT" err 23505 none
e2_stare retrasa receptionat 0
q "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','retry dupa retragere E2'); COMMIT" >/dev/null
e2_assert 'E2 retry dupa retragere' "(SELECT perete_mm=9 FROM public.magazie_bucati WHERE id=$BID)
 AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='aplicata')"
for final in COMMIT ROLLBACK; do
  if [ "$final" = COMMIT ]; then n=11; rezultat=err; tipar=23505; perete=8; else n=12; rezultat=ok; tipar=corectie_id; perete=9; fi
  e2_bucata "$n"
  # Barrier BEFORE INSERT/FK: this is the lock order under review, not a sleep.
  cursa "propune in zbor -> camp / $final" "SELECT public.fn_izo_cor_bucata_lock($BID,3)" \
    "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','direct E2'); COMMIT" "$rezultat" "$tipar" transactionid "$final" \
    "$CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere dupa bariera E2')"
  e2_assert 'E2 propune/camp final' "(SELECT perete_mm=$perete AND stare='receptionat' FROM public.magazie_bucati WHERE id=$BID)
    AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID)"
done
e2_bucata 13
cursa 'camp -> propune / revalidare' "$CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','camp inainte E2')" \
  "BEGIN; $CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere dupa camp E2'); COMMIT" ok corectie_id transactionid
e2_assert 'E2 propunere vede versiunea noua' "(SELECT perete_mm=9 AND server_ver<>$VER FROM public.magazie_bucati WHERE id=$BID)
  AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa')
  AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='aplicata')"
e2_sfarsit DIRECT_PROPUNERE

# 5. Full storno serializes with writers on the PROJECT advisory, never on FK.
for n in 14 15; do
  e2_bucata "$n"
  full="SELECT public.fn_izo_import_storno(3,'E2-import-$n','storno complet E2')"
  camp="SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','camp concurent storno E2')"
  if [ "$n" = 14 ]; then
    cursa 'camp -> full storno' "$CA_R; $camp" "BEGIN; $full; COMMIT" ok bucati_anulate advisory
  else
    cursa 'full storno -> camp' "$full" "BEGIN; $CA_R; $camp; COMMIT" err 40001 advisory
  fi
  e2_assert 'E2 camp/full reconciliere' "(SELECT stare='anulata' FROM public.magazie_bucati WHERE id=$BID)
    AND (SELECT stare='stornat' FROM public.izo_importuri WHERE proiect_id=3 AND import_id='E2-import-$n')
    AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
done
for n in 16 17; do
  e2_bucata "$n"
  full="SELECT public.fn_izo_import_storno(3,'E2-import-$n','storno complet E2')"
  partial="SELECT public.fn_izo_cor_storno_import(3,'E2-import-$n',ARRAY[$BID]::bigint[],'storno partial E2','00000000-0000-0000-0000-000000000117')"
  if [ "$n" = 16 ]; then
    cursa 'partial -> full storno' "$partial" "BEGIN; $full; COMMIT" ok bucati_anulate advisory
  else
    cursa 'full -> partial storno' "$full" "BEGIN; $partial; COMMIT" err 22023 advisory
  fi
  e2_assert 'E2 partial/full fara dublu anulat' "(SELECT count(*)=2 FROM public.magazie_bucati WHERE serie IN ('E2-$n','E2-${n}b') AND stare='anulata')
    AND (SELECT stare='stornat' FROM public.izo_importuri WHERE proiect_id=3 AND import_id='E2-import-$n')
    AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
done
e2_bucata 18
cursa 'propune -> full storno' "SELECT public.fn_izo_cor_bucata_lock($BID,3)" \
  "BEGIN; SELECT public.fn_izo_import_storno(3,'E2-import-18','full dupa propunere E2'); COMMIT" err 23514 transactionid COMMIT \
  "$CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere inainte storno E2')"
e2_assert 'E2 propune blocheaza full fara efecte' "(SELECT stare='receptionat' AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
  AND (SELECT stare='aplicat' FROM public.izo_importuri WHERE proiect_id=3 AND import_id='E2-import-18')
  AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa')"
e2_bucata 19
cursa 'full storno -> propune' "SELECT public.fn_izo_import_storno(3,'E2-import-19','full inainte propunere E2')" \
  "BEGIN; $CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere dupa storno E2'); COMMIT" err 22023 transactionid
e2_assert 'E2 propunere dupa full fara efecte' "(SELECT stare='anulata' FROM public.magazie_bucati WHERE id=$BID)
  AND NOT EXISTS(SELECT 1 FROM public.izo_corectii WHERE bucata_id=$BID)
  AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
e2_bucata 25
cursa 'propune -> partial storno' "SELECT public.fn_izo_cor_bucata_lock($BID,3)" \
  "BEGIN; SELECT public.fn_izo_cor_storno_import(3,'E2-import',ARRAY[$BID]::bigint[],'partial dupa propunere E2','00000000-0000-0000-0000-000000000117'); COMMIT" err 22023 transactionid COMMIT \
  "$CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere inainte partial E2')"
e2_assert 'E2 propune blocheaza partial' "(SELECT stare='receptionat' AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
 AND (SELECT count(*)=1 FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa')
 AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
e2_bucata 26
cursa 'partial storno -> propune' "SELECT public.fn_izo_cor_storno_import(3,'E2-import',ARRAY[$BID]::bigint[],'partial inainte propunere E2','00000000-0000-0000-0000-000000000117')" \
  "BEGIN; $CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','propunere dupa partial E2'); COMMIT" err 22023 transactionid
e2_assert 'E2 propunere dupa partial atomica' "(SELECT stare='anulata' FROM public.magazie_bucati WHERE id=$BID)
 AND NOT EXISTS(SELECT 1 FROM public.izo_corectii WHERE bucata_id=$BID)
 AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
e2_sfarsit STORNO

# 6. Two NULL-bucata proposals are legal; the series index arbitrates approvals.
q "BEGIN; $CA_G;
 SELECT public.fn_izo_cor_propune('gasit_nou',3,NULL,'{\"tip_cod\":\"teava\",\"depozit_id\":11,\"serie\":\"E2-GASIT-COMUN\",\"sarja\":\"E2-S\",\"perete_mm\":8,\"lungime_aviz_mm\":12000}','gasit concurent E2 A');
 SELECT set_config('izo.corectie_ctx','',true);
 SELECT public.fn_izo_cor_propune('gasit_nou',3,NULL,'{\"tip_cod\":\"teava\",\"depozit_id\":11,\"serie\":\"E2-GASIT-COMUN\",\"sarja\":\"E2-S\",\"perete_mm\":8,\"lungime_aviz_mm\":12000}','gasit concurent E2 B'); COMMIT" >/dev/null
GAS_A="$(q "SELECT id FROM public.izo_corectii WHERE motiv='gasit concurent E2 A'")"
GAS_B="$(q "SELECT id FROM public.izo_corectii WHERE motiv='gasit concurent E2 B'")"
cursa 'gasit_nou aprobari aceeasi serie' "$CA_R; SELECT public.fn_izo_cor_aproba($GAS_A,1)" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_aproba($GAS_B,1); COMMIT" err 23505 transactionid
e2_assert 'E2 gasit exact un castigator / pierzator atomic' "(SELECT count(*)=1 FROM public.magazie_bucati WHERE serie='E2-GASIT-COMUN' AND stare='carantina')
 AND (SELECT stare='aplicata' AND versiune=2 AND bucata_id IS NOT NULL AND eveniment_id IS NOT NULL FROM public.izo_corectii WHERE id=$GAS_A)
 AND (SELECT stare='propusa' AND versiune=1 AND bucata_id IS NULL AND eveniment_id IS NULL FROM public.izo_corectii WHERE id=$GAS_B)
 AND (SELECT count(*)=1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id IN ('$GAS_A','$GAS_B'))
 AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE eveniment_id IN (SELECT eveniment_id FROM public.izo_corectii WHERE id IN ($GAS_A,$GAS_B)))"
e2_sfarsit GASIT

# 7. E3 document fixtures are created only through the real API entries.
e2_document() {
  q "BEGIN; $CA_G; DO \$doc\$ DECLARE v_r jsonb; v_d bigint; v_check jsonb; BEGIN
    v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
      '{\"proiect_id\":3,\"depozit_id\":11,\"sablon\":\"aviz_teava\",\"furnizor\":\"E2 curse\",\"nr_document\":\"E2-DOC-$1\",\"data_document\":\"2026-10-22\",\"total_m\":12}',
      '[{\"nr_crt\":1,\"serie\":\"E2-DOC-$1\",\"sarja\":\"E2-S\",\"perete_mm\":8,\"lungime_doc_mm\":12000}]',NULL);
    v_d:=(v_r->>'document_id')::bigint; v_check:=public.fn_izo_doc_verifica(v_d);
    PERFORM public.fn_izo_doc_confirma(v_d,(v_check->>'versiune')::bigint,v_check->>'hash');
    PERFORM set_config('izo.receptie_ctx','',true);
    IF $2 THEN PERFORM public.fn_izo_doc_pv(v_d,2,'E2-PV-$1','2026-10-22'); END IF;
  END \$doc\$; COMMIT" >/dev/null
  DOC="$(q "SELECT id FROM public.izo_documente_intrare WHERE nr_document='E2-DOC-$1'")"
  DV="$(q "SELECT versiune FROM public.izo_documente_intrare WHERE id=$DOC")"
  BID="$(q "SELECT id FROM public.magazie_bucati WHERE aviz_intrare_id=$DOC")"
  VER="$(q "SELECT server_ver FROM public.magazie_bucati WHERE id=$BID")"
}
e2_document 1 true; e2_propune
cursa 'carantina aprobata -> E3 PV repetat' "$CA_R; SELECT public.fn_izo_cor_aproba($COR,1)" \
  "BEGIN; $CA_G; SELECT public.fn_izo_doc_pv($DOC,$DV,'ALT-PV-E2','2026-10-22'); COMMIT" err 23505 transactionid
e2_stare aplicata carantina 1
e2_assert 'E2 PV initial pastrat' "(SELECT pv_nr='E2-PV-1' AND versiune=$DV FROM public.izo_documente_intrare WHERE id=$DOC)"
e2_document 2 false
cursa 'E3 PV -> propunere carantina' "$CA_G; SELECT public.fn_izo_doc_pv($DOC,$DV,'E2-PV-2','2026-10-22')" \
  "BEGIN; $CA_G; SELECT public.fn_izo_cor_propune('carantina_intrare',3,$BID,'{\"ncr_ref\":\"E2-NCR\"}','carantina dupa PV concurent E2'); COMMIT" ok corectie_id transactionid
COR="$(q "SELECT id FROM public.izo_corectii WHERE bucata_id=$BID AND stare='propusa'")"
e2_assert 'E2 propunere dupa PV revalidata' "(SELECT stare='receptionat' FROM public.magazie_bucati WHERE id=$BID)
 AND (SELECT inainte->>'stare'='receptionat' FROM public.izo_corectii WHERE id=$COR)"
q "BEGIN; $CA_R; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT" >/dev/null
e2_stare aplicata carantina 1
e2_document 3 true; e2_propune
cursa 'aprobare -> anulare document E3' "$CA_R; SELECT public.fn_izo_cor_aproba($COR,1)" \
  "BEGIN; SELECT public.fn_izo_doc_anuleaza($DOC,'anulare concurenta E2','00000000-0000-0000-0000-000000000117'); COMMIT" ok bucati_anulate transactionid
e2_assert 'E2 anulare reconciliaza carantina' "(SELECT stare='anulat' FROM public.izo_documente_intrare WHERE id=$DOC)
 AND (SELECT stare='anulata' FROM public.magazie_bucati WHERE id=$BID)
 AND (SELECT stare='aplicata' FROM public.izo_corectii WHERE id=$COR)
 AND (SELECT count(*)=1 FROM public.magazie_bucati_miscari WHERE bucata_id=$BID AND rol='anulat')"
e2_document 4 true; e2_propune
# An existing open proposal PREVENTS cancellation. Stop cancellation at its first
# document lock; after release it must return 23514, then the waiting approval wins.
cursa 'anulare document inceputa -> aprobare' "SELECT id FROM public.izo_documente_intrare WHERE id=$DOC FOR UPDATE" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT" ok corectie_id transactionid COMMIT \
  "DO \$cancel\$ BEGIN
     BEGIN PERFORM public.fn_izo_doc_anuleaza($DOC,'anulare concurenta E2','00000000-0000-0000-0000-000000000117');
       RAISE EXCEPTION 'anulare a ignorat propunerea';
     EXCEPTION WHEN check_violation THEN
       IF SQLERRM NOT LIKE 'E3b: decide / retrage intai propunerile:%' THEN RAISE; END IF;
       RAISE NOTICE '23514 anulare refuzata';
     END;
   END \$cancel\$"
grep -q '23514 anulare refuzata' /tmp/izo_e3b_${PORT}_a.out || esec 'E2 anulare n-a fost refuzata'
e2_stare aplicata carantina 1
e2_assert 'E2 anulare refuzata atomica' "(SELECT stare='confirmat' AND eveniment_storno_intrare_id IS NULL AND eveniment_storno_pv_id IS NULL FROM public.izo_documente_intrare WHERE id=$DOC)"
e2_sfarsit DOCUMENTE

# 8. Real non-owner approver: the assignment row is part of authorization.
ATR="$(q "SELECT id FROM public.izo_atribuiri WHERE profile_id='00000000-0000-0000-0000-000000000117' AND rol='manager_aprobator' AND proiect_id=3")"
e2_bucata 20; e2_propune
cursa 'aprobare -> revocare atribuire' "$CA_M; SELECT public.fn_izo_cor_aproba($COR,1)" \
  "BEGIN; UPDATE public.izo_atribuiri SET activ=false WHERE id=$ATR; SELECT 'revocat'; COMMIT" ok revocat transactionid
e2_stare aplicata carantina 1
e2_assert 'E2 revocare dupa aprobare' "(SELECT NOT activ FROM public.izo_atribuiri WHERE id=$ATR)"
q "UPDATE public.izo_atribuiri SET activ=true WHERE id=$ATR" >/dev/null
e2_bucata 21; e2_propune
cursa 'revocare atribuire -> aprobare' "UPDATE public.izo_atribuiri SET activ=false WHERE id=$ATR" \
  "BEGIN; $CA_M; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT" err 42501 transactionid
e2_assert 'E2 reautorizare dupa revocare / zero efecte' "(SELECT stare='propusa' AND versiune=1 AND eveniment_id IS NULL FROM public.izo_corectii WHERE id=$COR)
 AND (SELECT stare='receptionat' AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
 AND (SELECT NOT activ FROM public.izo_atribuiri WHERE id=$ATR)"
q "UPDATE public.izo_atribuiri SET activ=true WHERE id=$ATR;
 INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-000000000117','inlocuitor_aprobator',NULL,'test','martor deadlock E2')" >/dev/null
ATR2="$(q "SELECT id FROM public.izo_atribuiri WHERE profile_id='00000000-0000-0000-0000-000000000117' AND rol='inlocuitor_aprobator' AND proiect_id=3")"
e2_bucata 22; e2_propune
# A owns the lower id before the barrier. B revokes upper id, then waits on
# lower id (pg_locks proof). Released A authorizes in ascending order and waits
# on upper id: a real cycle, no sleeps. Either victim is legal; catch ONLY 40P01
# in a subtransaction, then assert the exact all-or-nothing result below.
cursa 'doua revocari ordine inversa / martor 40P01' \
  "SET LOCAL deadlock_timeout='100ms'; SELECT id FROM public.izo_atribuiri WHERE id=$ATR FOR SHARE" \
  "BEGIN; SET LOCAL deadlock_timeout='100ms'; DO \$revoke\$ BEGIN
     BEGIN
       UPDATE public.izo_atribuiri SET activ=false WHERE id=$ATR2;
       UPDATE public.izo_atribuiri SET activ=false WHERE id=$ATR;
       RAISE NOTICE 'revocare B';
     EXCEPTION WHEN deadlock_detected THEN RAISE NOTICE '40P01 B'; END;
   END \$revoke\$; COMMIT" ok 'revocare B\|40P01 B' transactionid COMMIT \
  "$CA_M; DO \$approve\$ BEGIN
     BEGIN PERFORM public.fn_izo_cor_aproba($COR,1); RAISE NOTICE 'aprobare A';
     EXCEPTION WHEN deadlock_detected THEN RAISE NOTICE '40P01 A'; END;
   END \$approve\$"
[ "$(cat /tmp/izo_e3b_${PORT}_{a,b}.out | grep -c '40P01 [AB]')" = 1 ] || esec 'E2 martorul nu a produs exact un 40P01'
e2_assert 'E2 deadlock fara revocare/aprobare partiala' "(
  (SELECT stare='aplicata' AND versiune=2 AND eveniment_id IS NOT NULL FROM public.izo_corectii WHERE id=$COR)
  AND (SELECT count(*)=2 FROM public.izo_atribuiri WHERE id IN ($ATR,$ATR2) AND activ)
  AND (SELECT stare='carantina' FROM public.magazie_bucati WHERE id=$BID)
  AND (SELECT count(*)=1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id='$COR')
 ) OR (
  (SELECT stare='propusa' AND versiune=1 AND eveniment_id IS NULL FROM public.izo_corectii WHERE id=$COR)
  AND (SELECT count(*)=2 FROM public.izo_atribuiri WHERE id IN ($ATR,$ATR2) AND NOT activ)
  AND (SELECT stare='receptionat' AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
  AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id='$COR')
 )"
if [ "$(q "SELECT stare FROM public.izo_corectii WHERE id=$COR")" = propusa ]; then
  refuza 42501 "${PSQL[@]}" -d "$BAZA" -v VERBOSITY=verbose -c "BEGIN; $CA_M; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT"
else
  q "BEGIN; $CA_M; SELECT public.fn_izo_cor_aproba($COR,1); COMMIT" >/dev/null
  e2_stare aplicata carantina 1
fi
e2_sfarsit REVOCARI

# 9. E3 step-3 pattern, now on an E3b API entry (same exclusive runner key).
e2_bucata 23
cursa 'E3b schema partajata -> runner exclusiv + DDL' \
  "$CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','schema E2')" \
  "BEGIN; SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
   CREATE FUNCTION teste.e2_leak() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati';
   SELECT 'creat'; COMMIT" ok creat advisory
e2_assert 'E2 scriere inainte de DDL' "(SELECT perete_mm=9 AND server_ver<>$VER FROM public.magazie_bucati WHERE id=$BID)"
q 'DROP FUNCTION teste.e2_leak()' >/dev/null
e2_bucata 24
cursa 'runner exclusiv + DDL -> E3b revalideaza poarta' \
  "SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
   CREATE FUNCTION teste.e2_leak() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati'" \
  "BEGIN; $CA_R; SELECT public.fn_izo_cor_camp($BID,$VER,'{\"perete_mm\":9}','schema refuz E2'); COMMIT" err 42501 advisory
e2_assert 'E2 poarta dupa asteptare / zero efecte' "(SELECT perete_mm=8 AND server_ver=$VER FROM public.magazie_bucati WHERE id=$BID)
 AND NOT EXISTS(SELECT 1 FROM public.izo_corectii WHERE bucata_id=$BID)"
q 'DROP FUNCTION teste.e2_leak()' >/dev/null
e2_assert 'E2 poarta restaurata' "public.fn_izo_porti_lipsa()='{}'::text[]"
# Combined activation acquires its project lock before reaching the import
# prologue. With the runner holding schema exclusively it MUST fail fast.
cursa 'runner exclusiv -> activare/import 55P03 fara efecte' \
  "SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))" \
  "BEGIN; SELECT public.fn_izo_activeaza_si_importa(4,'E2-schema-55',
   '{\"motiv\":\"schema E2\",\"surse\":[{\"fisier\":\"schema.xlsx\",\"sha256\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"}],\"bucati\":[{\"tip\":\"teava\",\"serie\":\"E2-SCHEMA-55\",\"sarja\":\"E2-S\",\"lungime_mm\":12000,\"perete_mm\":8,\"stare\":\"receptionat\",\"depozit_id\":13,\"sursa\":{\"fisier\":\"schema.xlsx\",\"foaie\":\"F\",\"rand\":1}}]}',
   'schema fail fast E2'); COMMIT" err 55P03 none
e2_assert 'E2 activare/import 55P03 atomic' "NOT EXISTS(SELECT 1 FROM public.izo_proiect_config WHERE proiect_id=4)
 AND NOT EXISTS(SELECT 1 FROM public.izo_importuri WHERE proiect_id=4)
 AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE proiect_id=4)
 AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati WHERE serie='E2-SCHEMA-55')"
e2_sfarsit SCHEMA
