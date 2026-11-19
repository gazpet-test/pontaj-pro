# Administrativ → Unități protejate: fondul de handicap necheltuit (20261229a)

Deciziile owner-ului (19.11.2026):

- Plafonul lunar (azi 7.000 lei) rămâne o valoare **setată** de firmă (o calculează ei din numărul de angajați raportat la cei cu handicap
  obligatorii); platforma NU calculează obligația. Plafonul devine **versionat pe lună**: istoricul și alerta folosesc plafonul valabil în luna
  respectivă, nu pe cel de azi.
- Destinatarii mailului: lista din `logistica_setari.upa_alerta_emails` (o completează coordonatorul după aplicare; adresele NU stau în repo).

## Ce se schimbă

| Unde | Ce |
|---|---|
| BD (migrarea `20261229a`, NEAPLICATĂ) | `upa_plafon_lunar` (plafonul pe lună), `upa_luna_inchisa` (instantaneul lunii încheiate, scris o dată, nemodificabil), `upa_alerta_jurnal` (o alertă pe zi, o închidere pe lună), `fn_upa_luni` (definiția unică a alertei), `fn_upa_alerta_rezerva` / `_proba` / `_marcheaza` (doar service_role), `fn_upa_plafon_seteaza` (ecranul, CAS), `fn_upa_poate_scrie`; `upa_achizitii`: citire ca azi, scriere / ștergere doar owner + `administrativ` / `administrativ.upa` (admin / editor). |
| Edge `upa-plafon-alerta` v10 (NEPUBLICATĂ) | rulează zilnic; închide luna anterioară, trimite alerta zilei / închiderii, marchează rezultatul. Logica: `supabase/functions/_shared/upaAlerta.mjs`. |
| Ecran (`src/UnitatiProtejate.jsx`) | istoric pe 12 luni cu plafonul fiecărei luni și necheltuitul de la închidere, banner roșu după ziua din setări, plafonul prin RPC, numărul facturii obligatoriu, avertisment fără PDF / factură din altă lună, butoanele de scriere doar pentru cine are drept. |

### Reguli

- **Plafonul lunii M** = ultimul rând din `upa_plafon_lunar` cu `luna <= M`. La aplicare primește un rând: luna curentă = valoarea din
  `logistica_setari.upa_plafon_lunar`. Lunile dinaintea primului rând apar „plafon neînregistrat” (nu se inventează un plafon pentru trecut);
  dacă se dorește istoricul vechi, se adaugă rânduri separat, cu acordul owner-ului.
- Schimbarea din ecran scrie rândul **lunii curente** (deci și lunile viitoare); trecutul nu se rescrie; CAS pe valoarea văzută (40001 = s-a
  schimbat între timp).
- **Alerta zilnică**: de la ziua `upa_alerta_zi` (plafonată la ultima zi a lunii) până la sfârșitul lunii, cât cheltuit < plafonul lunii;
  cel mult o alertă pe zi (cheia `zilnic:<zi>`, UNIQUE). Mail: „Fond handicap <luna>: cheltuit X din Y lei, rămân Z lei, mai sunt N zile”.
- **Închiderea**: la prima rulare din luna următoare (normal pe 1), luna anterioară se scrie o dată în `upa_luna_inchisa`; cu alerta pornită
  și necheltuit > 0: mail „Fond handicap <luna>: necheltuit Z lei - se plătește la bugetul de stat”. Închiderea se face și cu alerta oprită
  (istoricul nu depinde de comutator). O factură adăugată după închidere se vede în ecran ca diferență; instantaneul rămâne.
- **Notificări în aplicație** (modulul Administrativ): owner + oricine are `administrativ` / `administrativ.upa`; alerta zilei `warning`
  (`error` în ultimele 3 zile), închiderea `error`; erorile de configurare (ziua invalidă, plafon lipsă) doar owner-ului, o dată pe zi.
- **Destinatarii mailului**: separați prin virgulă, doar `@gazpet.ro`, cel mult 10; o adresă invalidă = lista refuzată întreagă (rândul
  rămâne `fara_mail`, notificările pleacă).
- **Trimiterea** (L04 / L05): rezervare în BD înainte, `Idempotency-Key` = cheia rândului, apoi `trimis`; timeout / 5xx / rețea = `necunoscut`
  (fără retrimitere automată), 4xx = `eroare`; o rezervare rămasă peste 1 h devine `necunoscut`.

## Ordinea livrării (de coordonator, după review și „da”)

1. Migrarea, prin runner (`scripts/livrare_migrare.sh … --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
   supabase/migrations/20261229a_administrativ_upa_alerta.l15.tsv`). Lista obiectelor revizuită: `supabase/tests/20261229a_administrativ_upa_alerta.l15.obiecte.tsv`.
   Lock: `upa_achizitii` ACCESS EXCLUSIVE (doar politicile), restul obiecte noi.
2. Funcția edge `upa-plafon-alerta` (v10), aceeași configurare de acces ca v9 (poarta `cronSauOwner` în cod).
3. Cronul (jobid 29) trece pe zilnic: `SELECT cron.alter_job(29, schedule := '0 6 * * *');` (comanda și antetele jobului rămân). Până atunci
   v10 rulează doar pe 25 (închide luna anterioară și trimite alerta zilei în aceeași rulare).
4. Merge-ul ecranului. Între 1 și 4 ecranul vechi scrie plafonul în `logistica_setari` (valoare care nu mai e citită) — plafonul se schimbă
   din ecranul nou.
5. Destinatarii în `logistica_setari.upa_alerta_emails` (coordonatorul), apoi proba: owner-ul cheamă edge-ul cu `?dry=1` (nimic scris).

Revenire: `supabase/revenire/20261229a_administrativ_upa_alerta_ROLLBACK.sql` (runner cu plafon 2000, fără amprentă globală). Refuză dacă au
apărut date noi (o lună închisă, un rând în jurnal, un plafon schimbat din ecran). Edge-ul și ecranul se retrag înainte.

## Fișa de securitate (CLAUDE.md pct. 7)

- **(a) Conținut extern citit:** niciunul. Edge-ul citește doar BD-ul (setări, plafon, achiziții, furnizori). Facturile încărcate de oameni
  nu sunt citite de alertă.
- **(b) Ce scrie / face:** BD: `upa_luna_inchisa` (o dată pe lună), `upa_alerta_jurnal`, `notifications` (doar prin RPC-uri); trimite mail
  prin Resend de la `rapoarte@gazpet.ro` către lista din setări (doar `@gazpet.ro`, max. 10); conținutul = sume + numele furnizorilor UPA.
  Nu atinge bani, drepturi sau date personale.
- **(c) Identitate:** edge-ul folosește `service_role`, necesar pentru cron (fără utilizator); RPC-urile alertei au EXECUTE doar pentru
  `service_role`; tabelele noi nu au scriere directă pentru niciun rol al aplicației.
- **(d) Cine o pornește:** cronul (jobid 29) cu `x-intern-secret` din Vault, sau owner-ul logat (`cronSauOwner`, verificare de rol în cod;
  `verify_jwt` nu ajunge). Proba `?dry=1` doar owner-ul.
- **(e) Confirmare umană:** nu e nevoie: (a) și (b) nu se ating (niciun conținut extern), destinatarii sunt fixați de coordonator în setări,
  mailul e intern. Pornirea / oprirea = `upa_alerta_activa`.

## Text propus pentru `registru_automatizari` și rândul `automatizari` id 23 (de actualizat de coordonator, după livrare)

> **upa-plafon-alerta (v10, 20261229a)** — cron jobid 29, `0 6 * * *` (zilnic, 08/09 ora RO), edge `upa-plafon-alerta` cu `x-intern-secret`
> (Vault `INTERN_EDGE_SECRET`). În fiecare zi: închide luna anterioară în `upa_luna_inchisa` (o dată) și, de la ziua `upa_alerta_zi` până la
> sfârșitul lunii, cât cheltuit < plafonul lunii, trimite o alertă pe zi (mail Resend de la rapoarte@gazpet.ro către `upa_alerta_emails`,
> doar @gazpet.ro + notificare în aplicație pentru owner și Administrativ / UPA); la închidere, mail cu necheltuitul (de plătit la bugetul
> de stat). Jurnal: `upa_alerta_jurnal`. Comutator: `upa_alerta_activa`. Secrete (nume): `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
> `INTERN_EDGE_SECRET`. Fișa: (a) niciun conținut extern; (b) BD prin RPC-uri + mail intern; (c) service_role, RPC-uri doar service_role;
> (d) cron cu secret intern sau owner logat; (e) fără confirmare (nu citește conținut extern).

Rândul `automatizari` id 23: `program` = `0 6 * * *`, `descriere` = textul de mai sus pe scurt, `secrete_nume` = `RESEND_API_KEY,
SUPABASE_SERVICE_ROLE_KEY, INTERN_EDGE_SECRET`, `verificat_la` = data probei.

## Probe

- `scripts/pglite/test_upa_alerta_local.mjs` (PGlite, schema falsă Supabase): aplicarea ca runnerul L15 v2 (manifest = lista revizuită,
  PLAFON_TIMP, LOCK_TINUT), RLS ca non-owner, plafonul versionat, scenariile alertei, edge-ul pe BD-ul migrării cu Resend simulat, paritatea
  textelor JS ↔ SQL, refuzurile migrării și ale revenirii, aplicare → revenire → reaplicare (și cu politica veche pe rolul `public`), mutanți
  SQL și JS.
- `src/upaAlerta.test.js` (vitest): textul mailului, edge-ul cu BD / Resend simulate, logica ecranului.
