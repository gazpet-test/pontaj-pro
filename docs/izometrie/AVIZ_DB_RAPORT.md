# AVIZ-1 — raport DB (27.10.2026)
Stare: implementare pregătită pentru review; NU este validată pentru livrare (PG16 nerulat).
M = supabase/migrations/20261120a_izometrie_aviz_iesire.sql; R = supabase/revenire/20261120a_izometrie_aviz_iesire_ROLLBACK.sql.
T = supabase/tests/izometrie_aviz.test.sql; H = scripts/test_izometrie_aviz.sh; C = scripts/izometrie/aviz/concurenta.sh.
Livrat: schema r2, trei RPC-uri, punte privată către ieșirea LIVE, bucket/politici, revenire, fixture-uri și harness cu două sesiuni/barieră.
Etapa 2 exclusă: nicio politică/funcție pentru hr-semnaturi; UI/LIVE/Git/producție neatinse; Pas 0 executat.
Static: `& 'C:/Program Files/Python313/python.exe' scripts/izometrie/aviz/verifica_static.py C:/Users/Public/paw-data/brief/aviz_base`.
Rezultat: PASS baseline byte-identic; PASS bash -n (3 scripturi); PASS contracte statice/amprentă identică. Acestea NU sunt PASS SQL.
Harness încercat: `wsl.exe -d Ubuntu-24.04 -- bash /mnt/c/Users/Public/paw-data/cdx/20261027-223850-a5be7b-avizdb1/scripts/izometrie/aviz/harness_wsl.sh 0`.
Ieșire: `exit=-1; Access is denied. Error code: Wsl/Service/E_ACCESSDENIED`; log: scripts/izometrie/aviz/harness_attempt.log. Fără PASS PG16.
Blocaj de contract: PG16 standard cere ownership pentru CREATE POLICY; harness-ul elimină apartenența postgres la ownerul Storage. Nu am introdus GRANT compensatoriu.
De verificat: hash-urile COMMENT prod sunt stricte; amprentele E4 includ OID-uri de rol, deci baseline-ul local poate diferi. Nu am slăbit precondiția pentru teste.
Rămân: clarificarea celor două diferențe de mediu, rularea PG16/concurenței/regresiilor/revenirii până la PASS; numerele finale la preview-ul lui Răzvan.
Abateri: punte privată (păstrează ACL-ul LIVE); lpad păstrează numere >9999; wrapper-ul WSL scrie doar în worktree, fără copia /tmp din model; NTFS poate refuza initdb/chmod.
L01: M fn_izo_iesire_cu_aviz, advisory înaintea primei citiri; UPDATE serie RETURNING; verificare statică PASS; C pregătit, nerulat.
L02: M alocare + ieșire + instantaneu în același RPC, fără catch care să consume numărul; T cazul stare, nerulat.
L03: M antet/continut salvate pe server; PDF citește metadata actuală sub lock pe aviz; T atașare/conflict, nerulat.
L04: M op_cheie UNIQUE + hash payload canonic + recitire sub lock; T retry/payload diferit și C aceeași cheie, nerulate.
L05 n/a (fără client/rețea sau operații externe).
L06: M comentarii cu ordinea blocărilor; serie înaintea ieșirii LIVE; manualul nu cere serie; C două sesiuni, nerulat.
L07: M RLS SELECT cu identitate, scriere API revocată, politici Storage restrictive; T scrieri directe/Storage/RLS, nerulat.
L08: M auth.uid(), identitatea emitentului și hash-ul numai pe server; checker confirmă lipsa mutatorilor de identitate în RPC-uri.
L09: M fn_izo_birou_autorizat + refuzurile LIVE pentru fiecare bucată/proiect; T utilizator fără drept, nerulat.
L10 n/a (fără secrete, parole sau integrare nouă).
L11 n/a (fără extragere documente).
L12: M instantaneu_incomplet refuză lungime/greutate lipsă; nu transformă greutatea necunoscută în zero; T totaluri fixe, nerulat.
L13: M expresii ancorate pentru serie/hash/mărimea PDF; T PDF invalid și normalizare auto, nerulat.
L14: M/R blocuri DO atomice + protocol runner; R LOCK înaintea verificării datelor/configurației; H apply/reapply/rollback/reapply pregătit, nerulat.
L15: M amprente baseline + extindere poartă E4b (inclusiv FORCE RLS); R restaurează corpul/stampilele; egalitatea <amprenta> verificată static, porțile SQL nerulate.
L16: M UNIQUE(serie,numar), op_cheie NOT NULL UNIQUE, hash include toate argumentele semantice; T cheie refolosită, nerulat.
L17: M zi în Europe/Bucharest, m din mm/1000, kg din bucăți; T dată viitoare și totaluri 12 m/123,5 kg, nerulat.
L18: M identitate/NULL validate explicit, CHECK-uri condiționale cu IS NOT NULL, PDF/date necunoscute refuzate; T NULL/invalid, nerulat.
L19: M reutilizează fn_izo_birou_autorizat/fn_izo_citire/ieșirea LIVE; nu există pereche JS–SQL nouă.
L20: T succes angajat/extern, refuzuri, anulare și reapel; testele sunt scrise, nu declarate trecute.
L21 n/a (fără AI/edge).
L22 n/a (fără apeluri AI/costuri).
L23 n/a (fără UI/paginare).
L24 n/a (fără React/async).
L25: H bootstrap NOSUPERUSER, T authenticated prin authenticator fără GRANT/REVOKE, C două conexiuni + barieră + wait; pregătite, NERULATE din cauza WSL.
Integrare (Izometrie, 27.10 ~23:05): harness PASS prodlike PG16 (scripts/izometrie/aviz/harness_wsl.sh 3, din WSL ca root -> copie /tmp + utilizator postgres). Corecturi: preconditia pe corpurile exacte prod (md5 prosrc) in locul md5 pe COMMENT (OID-uri de rol diferite intre medii; drift-ul COMMENT ramane prins de <amprenta>); curbele fara lungime admise (325 pe prod), masa obligatorie, total_m >= 0; motivul fara campuri goale; bariera de concurenta citita de admin (postgres NOSUPERUSER nu vede wait_event); harness-ul da GRANT supabase_storage_admin TO postgres doar pentru pasul 20261120a (pe prod postgres a creat politici Storage la E3/E4a).
