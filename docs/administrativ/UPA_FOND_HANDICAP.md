# Administrativ → Unități protejate: fondul de handicap necheltuit (20261229a)

> **Actualizare 20.11.2026 (20270101a, NEAPLICATĂ):** plafonul fix e înlocuit de contribuția CALCULATĂ după răspunsul expertului
> contabil (NMA din pontaj, salariul minim pe perioade, deducerea = cel mult jumătate, reportul). Vezi `docs/administrativ/UPA_CALCUL_EXPERT.md`.
> Restul documentului (jurnalul, destinatarii, drepturile, bucketul) rămâne valabil.

Deciziile owner-ului (19.11.2026):

- Plafonul lunar (azi 7.000 lei) rămâne o valoare **setată** de firmă (o calculează ei din numărul de angajați raportat la cei cu handicap
  obligatorii); platforma NU calculează obligația. Plafonul devine **versionat pe lună**: istoricul și alerta folosesc plafonul valabil în luna
  respectivă, nu pe cel de azi.
- Destinatarii mailului: lista din `logistica_setari.upa_alerta_emails` (o completează coordonatorul după aplicare; adresele NU stau în repo).

Deciziile owner-ului pentru runda 3 (19.11.2026):

- **Numărul facturii obligatoriu pe toate căile** (varianta B): garda în BD pe rândurile noi (migrarea separată `20261229b`) + câmpul
  „Nr. factură” în Citește Orice (UPA).
- **Destinatarii alertei: doar adrese interne** (`@gazpet.ro`). O adresă din setări care nu e internă e ignorată (nu primește nimic) și
  numărată în jurnal; adresele reale se pun în setări după merge, de coordonator.
- **Lunile vechi se ignoră** (vezi „Limite”).
- **Bucketul `documente-upa`**: politica largă se înlocuiește cu drepturi după modul (migrarea separată `20261229c`).

## Ce se schimbă

| Unde | Ce |
|---|---|
| BD (migrarea `20261229a`, NEAPLICATĂ) | `upa_plafon_lunar` (plafonul pe lună), `upa_luna_inchisa` (instantaneul lunii încheiate, scris o dată, nemodificabil), `upa_alerta_jurnal` (o alertă pe zi, o închidere pe lună), `fn_upa_luni` (definiția unică a alertei), `fn_upa_alerta_rezerva` / `_proba` / `_marcheaza` (doar service_role), `fn_upa_plafon_seteaza` (ecranul, CAS), `fn_upa_poate_scrie`; `upa_achizitii`: citire ca azi, scriere / ștergere doar owner + `administrativ` / `administrativ.upa` (admin / editor). |
| Edge `upa-plafon-alerta` v10 (NEPUBLICATĂ) | rulează zilnic; închide luna anterioară, trimite alerta zilei / închiderii, marchează rezultatul. Logica: `supabase/functions/_shared/upaAlerta.mjs`. |
| Ecran (`src/UnitatiProtejate.jsx`) | istoric pe 12 luni cu plafonul fiecărei luni și necheltuitul de la închidere, banner roșu după ziua din setări, plafonul prin RPC, numărul facturii obligatoriu în formularul manual și în Citește Orice (UPA), avertisment fără PDF / factură din altă lună, butoanele de scriere doar pentru cine are drept, salvarea prin `fn_upa_achizitie_adauga`. |
| BD (migrarea `20261229b`, NEAPLICATĂ) | numărul facturii obligatoriu pe rândurile noi din `upa_achizitii` pe toate căile: `fn_upa_numar_factura_ok` (predicatul unic), CHECK `upa_achizitii_numar_factura_nevid` NOT VALID, trigger `trg_upa_achizitii_numar_factura` (23514, mesaj clar). |
| BD (migrarea `20261229c`, NEAPLICATĂ) | bucketul `documente-upa`: politica largă „upa docs authenticated all” înlocuită cu citire (`fn_upa_poate_citi`: owner / Administrativ orice nivel), încărcare și ștergere (`fn_upa_poate_scrie`); fără UPDATE. |

### Runda 2 (după review)

- **Salvarea din formular** are o cheie de intenție (`upa_achizitii.cheie_intentie`, UNIQUE, NULL permis pentru Citește Orice și rândurile
  vechi). Reîncercarea trimite aceeași cheie, deci o salvare intrată cu răspunsul pierdut nu se dublează; după un conflict pe cheie sau un
  răspuns pierdut, ecranul caută rândul după cheie și compară valorile.
- **PDF-ul încărcat** se scoate DOAR după un refuz sigur al serverului (răspuns 4xx, `respingereServer`), nu după orice cod de eroare. La
  rețea / timeout / 5xx rezultatul e „necunoscut”: nimic nu se șterge, formularul se îngheață, singura acțiune e „Reîncearcă” (identic).
- **Erorile de configurare** (`setare_zi_invalida`, `fara_plafon`) vin în răspunsul rezervării și al probei (`erori_config`) la FIECARE
  rulare; edge-ul răspunde atunci `ok:false, error:'configurare_invalida'` (status 200: rularea a mers până la capăt). În jurnal + notificarea
  owner-ului rămân o dată pe zi și cod.
- **Preflight-ul notificărilor**: migrarea face exact inserarea alertei (ambele tipuri, modulul, linkul, lungimile maxime) într-o
  subtranzacție anulată, în loc să caute cuvinte în textul regulilor tabelului.
- **Revenirea** verifică amprenta COMPLETĂ a obiectelor migrării (același bloc de calcul ca în postcondițiile migrării, constanta revizuită) și
  reface politica veche identic în catalog pentru toate cele 4 forme acceptate (rolurile + clauza WITH CHECK, păstrate în comentariu).
- **Ecranul**: furnizorii se citesc pe pagini; eroarea la citirea rundei de consumabile se arată (nu mai e „nicio rundă”), cumulul vechi se
  scoate; acțiunile (salvare, ștergere, plafon, PDF) se aplică doar cât ecranul / profilul sunt aceleași.

### Runda 3 (după review-ul rundei 2 + deciziile owner-ului)

- **Salvarea din formular prin RPC** (`fn_upa_achizitie_adauga`, SECURITY INVOKER): cheia de intenție + **amprenta durabilă** a valorilor
  (`upa_achizitii.hash_intentie` = md5 pe TOATE câmpurile intenției, `fn_upa_campuri_intentie`; pusă de trigger, nemodificabilă). RPC-ul
  caută întâi cheia: există cu aceeași amprentă → `existent` (fără să ceară dreptul de scriere de acum: o salvare intrată cu răspunsul pierdut
  nu mai poate părea „refuzată” dacă dreptul s-a retras între timp); există cu alte valori → `UPA02` (nimic scris); altfel inserarea.
- **PDF-ul** se scoate doar la un refuz sigur al unei intenții **fără nicio încercare nesigură înainte**. După un rezultat necunoscut,
  formularul rămâne înghețat și nimic din intenția aceea nu se mai șterge (un refuz al reîncercării nu dovedește refuzul primei încercări).
- **Async (L24)**: încărcarea PDF-ului și RPC-ul pleacă doar cât formularul e montat și ecranul e în aceeași epocă (același cont);
  paginarea furnizorilor / achizițiilor se oprește la o încărcare nouă sau la demontare. Un PDF încărcat chiar înainte de închiderea
  formularului rămâne neatașat în bucket (calea conține cheia intenției; nicio scriere după demontare).
- **Avertismentul de trunchiere** a rundei de consumabile e afișat oricând lista e tăiată, independent de filtrul pe categorii și de plafon.
- **Revenirea** `20261229a`: amprenta conține și drepturile pe coloane și TOATE obiectele care depind de coloanele noi din `upa_achizitii`
  (oricum s-ar numi), deci un index / o constrângere / o statistică adăugate ulterior pe ele opresc revenirea în loc să dispară tăcut.

### Limite (declarate)

- **Lunile vechi** (decizia owner-ului): alerta privește DOAR luna curentă și luna tocmai încheiată (luna anterioară zilei de rulare). Lunile
  dinaintea aplicării nu au plafon înregistrat, deci nu se închid și nu primesc alertă; nu există recuperare sau alertă retroactivă. Dacă
  alerta nu rulează o lună întreagă (cron oprit), luna sărită nu se mai închide automat; ecranul o arată „neînchisă · estimat necheltuit”.
- **Rândurile vechi fără număr de factură** rămân (CHECK `NOT VALID`); o modificare a unui astfel de rând cere întâi completarea numărului,
  ștergerea rămâne posibilă. `VALIDATE CONSTRAINT` se face separat, după ce nu mai există niciunul.
- **Un alt trigger BEFORE pe `upa_achizitii`** care ar rescrie câmpurile intenției înaintea triggerului amprentei ar face ca o reluare să
  apară „cu alte valori” (`UPA02`): rezultat sigur (nimic șters), dar formularul rămâne înghețat. Pe clonă se listează triggerele tabelului.

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
- **Destinatarii mailului**: separați prin virgulă; primesc mail DOAR adresele interne `@gazpet.ro` (formă ancorată: nici subdomenii, nici
  sufixe), fără dubluri, cel mult 10 (peste 10 = lista refuzată întreagă, `prea_multi_destinatari`). Orice altă adresă e **ignorată**: nu
  primește nimic, numărul ei intră în jurnal (`upa_alerta_jurnal.nr_dest_ignorati`) și în răspunsul edge-ului (`destinatari_ignorati`, fără
  adrese); adresele ignorate apar doar în proba owner-ului (`?dry=1`). Doar adrese din afară = `fara_mail` / `doar_destinatari_externi`
  (notificările în aplicație pleacă oricum). Edge-ul reverifică domeniul (`DOMENIU_INTERN`) înainte de trimitere: o adresă din afară într-un
  rând rezervat = nimic trimis (`rezervare_invalida`).
- **Trimiterea** (L04 / L05): rezervare în BD înainte, `Idempotency-Key` = cheia rândului, apoi `trimis`; timeout / 5xx / rețea = `necunoscut`
  (fără retrimitere automată), 4xx = `eroare`; o rezervare rămasă peste 1 h devine `necunoscut`.

## Ordinea livrării (de coordonator, după review și „da”)

Pe scurt: **migrarea 20261229a → merge-ul → 20261229b și 20261229c (aceasta după verificarea de pe live) → edge → destinatarii în setări → cron.**
Toate migrările se livrează prin runner (`scripts/livrare_migrare.sh … --plafon-tranzactie-ms 5000 --amprenta-globala <md5>
--diferente-globale supabase/migrations/<nume>.l15.tsv`); listele obiectelor revizuite sunt în `supabase/tests/<nume>.l15.obiecte.tsv`.

1. **`20261229a`** (versiune 20261229120000). Lock: `upa_achizitii` ACCESS EXCLUSIVE (politicile + coloanele cheii / amprentei, triggerul).
   Între 1 și 2 ecranul vechi scrie plafonul în `logistica_setari` (valoare care nu mai e citită) — plafonul se schimbă din ecranul nou;
   inserarea directă a ecranului vechi (fără cheie) rămâne permisă cu dreptul de scriere.
2. **Merge-ul ecranului** (salvează prin `fn_upa_achizitie_adauga`, care există doar după 1; Citește Orice are câmpul „Nr. factură”).
3. **`20261229b`** (numărul facturii, versiune 20261229120100), după merge: altfel Citește Orice vechi ar primi refuzul fără explicație.
   Preflight-ul tipărește câte rânduri vechi fără număr există (`20261229b: randuri vechi fara numar = N`); rămân, nu se modifică.
4. **`20261229c`** (bucketul, versiune 20261229120200), după merge ȘI după **verificarea pe live, făcută de chat** (nu de migrare): cine a
   încărcat / confirmat facturi UPA în ultimele luni (Unități protejate și Citește Orice → UPA) **fără** acces Administrativ / Unități protejate
   admin sau editor — după aplicare acel cont n-ar mai putea încărca; cine deschidea facturile fără niciun acces Administrativ n-ar mai putea
   deschide PDF-ul. Migrarea cere forma EXACTĂ a politicii vechi (altfel refuză și tipărește forma găsită) și verifică prin sondă politicile
   EFECTIVE de pe `storage.objects` (o politică generică din alt modul care ar deschide bucketul o oprește).
5. Funcția edge `upa-plafon-alerta` (v10), aceeași configurare de acces ca v9 (poarta `cronSauOwner` în cod).
6. Destinatarii în `logistica_setari.upa_alerta_emails` (coordonatorul; doar adrese interne), apoi proba: owner-ul cheamă edge-ul cu `?dry=1`
   (nimic scris; arată și adresele ignorate).
7. Cronul (jobid 29) trece pe zilnic: `SELECT cron.alter_job(29, schedule := '0 6 * * *');` (comanda și antetele jobului rămân). Până atunci
   v10 rulează doar pe 25 (închide luna anterioară și trimite alerta zilei în aceeași rulare).

Reveniri (runner cu plafon 2000, fără amprentă globală), **în ordinea c → b → a** (politicile din `20261229c` folosesc
`fn_upa_poate_scrie` din `20261229a`: revenirea lui `a` înaintea lui `c` pică la DROP FUNCTION, nimic schimbat):
- `supabase/revenire/20261229c_administrativ_upa_bucket_ROLLBACK.sql` (20261229120201): reface EXACT politica veche a bucketului (verificată
  imediat după, pe comandă / roluri / USING / CHECK) și scoate `fn_upa_poate_citi`; refuză la orice abatere de la amprentă.
- `supabase/revenire/20261229b_administrativ_upa_numar_factura_ROLLBACK.sql` (20261229120101): scoate triggerul, CHECK-ul și predicatul
  (numărul redevine opțional); refuză la orice abatere de la amprentă (inclusiv CHECK-ul validat între timp).
- `supabase/revenire/20261229a_administrativ_upa_alerta_ROLLBACK.sql` (20261229120001): refuză dacă au apărut date noi (o lună închisă, un rând
  în jurnal, un plafon schimbat din ecran) sau dacă amprenta obiectelor migrării diferă de constanta revizuită (orice definiție, drept pe tabel
  sau pe coloană, proprietar, RLS, coloană, constrângere, index, trigger, secvență, politică, ORICE obiect dependent de coloanele noi).
  Excepție declarată: cheile și amprentele din `upa_achizitii.cheie_intentie` / `hash_intentie` se pierd odată cu coloanele (achizițiile
  rămân). Edge-ul și ecranul se retrag înainte.

Constantele amprentelor sunt calculate pe PGlite (PG 18, cu NOT NULL-urile din `pg_constraint` scoase); proba pe clona PG 17 le confirmă —
dacă diferă, postcondiția migrării refuză aplicarea și tipărește textul amprentei (`AMPRENTA_<id>_TEXT`) pentru comparare.

## Fișa de securitate (CLAUDE.md pct. 7)

- **(a) Conținut extern citit:** niciunul. Edge-ul citește doar BD-ul (setări, plafon, achiziții, furnizori). Facturile încărcate de oameni
  nu sunt citite de alertă.
- **(b) Ce scrie / face:** BD: `upa_luna_inchisa` (o dată pe lună), `upa_alerta_jurnal`, `notifications` (doar prin RPC-uri); trimite mail
  prin Resend de la `rapoarte@gazpet.ro` DOAR către adresele interne din setări (`@gazpet.ro`, max. 10; celelalte ignorate și numărate în
  jurnal, garda în BD și reverificată în edge); conținutul = sume + numele furnizorilor UPA.
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
  SQL și JS. Runda 3: salvarea prin RPC (P1: reluarea după retragerea dreptului = `existent`; P2: aceeași cheie + orice alt câmp = `UPA02`),
  destinatarii doar interni, `20261229b` și `20261229c` (aplicare ca runnerul, matricea de drepturi pe bucket: owner / editor / admin /
  viewer / alt modul / anonim, sonda, refuzuri, revenire → reaplicare, ordinea revenirilor), logica ecranului pe BD-ul real + mutanții ei.
- `src/upaAlerta.test.js` (vitest): textul mailului, edge-ul cu BD / Resend simulate, logica ecranului.
