# E4 — pachetul de pilot pe tabletă

> **APLICAT 24.10.2026 de chat, cu „da”-ul lui Răzvan pe preview:**
> - **§2:** cheia `executie.izometrie` + editor:
>   - `user_module_access` 443 TITI JENO;
>   - 444 VICIU MARIUS ALEXANDRU;
>   - 445 TOMA RAZVAN ALIN;
>   - **446 NICA EUGEN** (emp 81, profil `cb29a12a-b318-40bc-85c0-bb4f5b3bc2d3`, adăugat de Răzvan; NU Nica Florentin, emp 179).
>
>   Revenirea: DELETE din `user_module_access` pentru id-urile 443–446, apoi DELETE pe cheie.
> - **§1:** T15 (id 19) e în flux pentru **etapa 1, repetiția**. Etapa 2 (Toma aprobă, ireversibil) pornește doar la cuvântul lui Răzvan, după repetiție.
> - **§3:** GPS, varianta B (60 de zile), în implementare.
>
> Textul de mai jos e preview-ul original.

Stare la 24.10.2026: E4a (`20261109a`) și E4b (`20261109b`) sunt aplicate pe prod și pe main (#869, #872). Fluxul nu e activ pe niciun tronson. Cheia `executie.izometrie` nu există. Nu există dispozitive și nici coordonate GPS.

Toate cifrele de mai jos vin din SELECT-uri read-only pe prod, pe 24.10.

**Nimic din acest document nu se aplică pe un „da” general.** Fiecare bloc „APPLY” cere „da”-ul lui Răzvan pe preview-ul lui concret și se rulează de chat, din sesiunea `postgres` (psql, READ COMMITTED), cu RETURNING pentru revenire.

---

## 1. Tronsonul de pilot: propunerea T15 (id 19, LOT 2)

### Ce am găsit

| | T14 (id 18) | T15 (id 19) | TEST-IZO (proiect 37) |
|---|---|---|---|
| proiect | 3, LOT 2, nivel `stoc` | 3, LOT 2, nivel `stoc` | 37, nivel `stoc` |
| km | 60 000 – 66 000 | 66 000 – 71 000 | — |
| pachete / țevi / bucăți pe tronson | 0 / 0 / 0 | 0 / 0 / 0 | **niciun tronson, 0 bucăți** |
| oamenii (`izo_atribuiri`) | Titi #4, Viciu #5 (inginer), Toma #6 (MP), Janeta #1–3 (gestionar, depozitele 9 / 10 / 11) | la fel (pe proiect) | Toma #8 / #9, Janeta #7; Titi și Viciu NU |

Stoc disponibil pe LOT 2 (`receptionat`):
- depozitul 9: 522 de țevi;
- depozitul 11: 1037 de țevi și 325 de curbe.

### Recomandarea: T15, în două etape. De ce nu TEST-IZO

TEST-IZO nu are tronson și nici stoc. Ca să fie folosibil ar trebui create date noi: un tronson în `executie_tronsoane`, bucăți recepționate prin E3 și atribuiri de inginer pentru Titi și Viciu pe proiectul 37. Sunt mai multe scrieri reale decât pilotul însuși, iar tableta ar fi testată pe un scenariu artificial.

T15 e gol (0 pachete, 0 bucăți), deci nimic existent nu se poate strica. Oamenii au deja atribuirile pe proiectul 3.

- **Etapa 1, repetiția (reversibilă):** Titi declară pe tabletă bucăți din depozit, iar Toma vede preview-ul și **respinge**. Respingerea eliberează rezervările și nu scrie niciun fapt în registru. La final fluxul se poate opri (§1.3).
- **Etapa 2, pilotul real (ireversibil pe faptele aprobate):** Toma **aprobă**. Faptele (tăiere, montaj, suduri) intră în registru, iar stocul oficial scade. După primul montaj aprobat, `fn_izo_seteaza_flux(19,false,…)` refuză oprirea („E4a fapte montaj; oprire refuzata”). Așa e proiectat: un tronson cu fapte de montaj nu iese din flux.

**T14 sau T15:** alegeți tronsonul pe care se montează primul pe teren. Am propus T15 doar pentru că e cel din exemplele de design și din teste. Dacă alegeți T14, în SQL-ul de mai jos 19 devine 18 și „T15” devine „T14”.

### 1.1 PREVIEW (read-only)

```sql
SELECT t.id, t.cod, t.proiect_id,
  (SELECT count(*) FROM public.izo_tronson_config c WHERE c.tronson_id=t.id)            AS config,
  (SELECT count(*) FROM public.executie_pachete_lansare k WHERE k.tronson_id=t.id)      AS pachete,
  (SELECT count(*) FROM public.magazie_bucati b WHERE b.tronson_id=t.id)                AS bucati,
  (SELECT nivel_izo FROM public.izo_proiect_config WHERE proiect_id=t.proiect_id)       AS nivel,
  public.fn_izo_porti_lipsa()                                                           AS porti
FROM public.executie_tronsoane t WHERE t.id=19;
-- așteptat (24.10): 19 | T15 | 3 | 0 | 0 | 0 | stoc | {}
```

### 1.2 APPLY (doar după „da”, sesiune `postgres`, o tranzacție)

```sql
BEGIN;  -- READ COMMITTED (implicit)
INSERT INTO public.izo_tronson_config(tronson_id, proiect_id) VALUES (19, 3)
  RETURNING tronson_id, proiect_id, flux_montaj;                 -- așteptat: 19 | 3 | f
SELECT public.fn_izo_seteaza_flux(19, true, 'Pilot E4 tabletă — „da” Răzvan <data>');   -- așteptat: t
SELECT tronson_id, flux_montaj, flux_de_la, flux_motiv, flux_schimbat_de
  FROM public.izo_tronson_config WHERE tronson_id=19;           -- așteptat: 19 | t | <acum> | Pilot… | postgres
SELECT public.fn_izo_porti_lipsa();                              -- așteptat: {}
COMMIT;
```

Garda `a0_izo_flux_config` permite INSERT doar din sesiunea `postgres` și doar cu `flux_montaj = false`. Activarea trece numai prin `fn_izo_seteaza_flux`, care verifică:
- porțile `{}`;
- nivelul proiectului diferit de `off`;
- rânduri de pachet nelegate pe tronson: niciunul (T15 nu are);
- anteturi aprobate de Transgaz: niciunul.

Coloanele opționale (`sens_numerotare`, `nr_sudura_start`, `perete_proiectat`, `executant_implicit`) rămân NULL. Dacă la pilot e nevoie de numerotarea sudurilor de la alt start, se completează separat, cu „da”.

### 1.3 Revenirea

```sql
BEGIN;
SELECT public.fn_izo_seteaza_flux(19, false, 'Oprire pilot E4 — „da” Răzvan <data>');   -- așteptat: f
COMMIT;
```

- **Merge doar** cât timp T15 nu are fapte de montaj sau tăiere aprobate și nu are declarații deschise, rezervări active sau fronturi active. Adică merge după etapa 1, dacă toate sesiunile au fost respinse și frontul eliberat.
- Rândul din `izo_tronson_config` rămâne, cu `flux_montaj = false`, pentru că tabela nu permite DELETE. Asta nu afectează nimic.
- **După etapa 2 nu există revenire simplă:** faptele aprobate se corectează doar prin corecțiile MP / E3b, nu prin oprirea fluxului.

---

## 2. Cheia de modul `executie.izometrie` (Q-E4-9 A) și drepturile

### Ce am găsit

- `app_modules` are doar `executie` (fără copii). Sub-cheile se fac ca la `logistica.active` / `administrativ.upa`.
- `user_module_access.module` are FK pe `app_modules(key)` (ON DELETE CASCADE), CHECK pe `access_level` ∈ {admin, editor, viewer} și UNIQUE (`profile_id`, `module`).
- **RPC-urile E4b cer `executie.izometrie` editor** (sau admin), pe lângă atribuire:
  - tableta: `fn_izo_teren_autorizat` = modul + `inginer_izometrie`;
  - MP: `fn_izo_birou_autorizat` → `fn_izo_acces(…,'executie.izometrie','editor','manager_aprobator')`.
  - Fără cheie, doar owner-ul poate folosi tableta și aprobarea.
- În UI nu se schimbă nimic: ruta `/executie` cere `executie`, iar `hasModuleAccess` acceptă și sub-cheile. Pagina Izometrie e deja vizibilă celor trei.

Oamenii (`profiles` ⨝ `employees`, verificat 24.10, nu presupus):

| Om | employee_id | profile_id | rol profil | is_owner | Atribuire izo (proiect 3) | Are azi `executie` |
|---|---|---|---|---|---|---|
| TITI JENO | 115 | `82508f76-37b9-43e1-9680-ee794c6b0e37` | admin_logistica | nu | #4 `inginer_izometrie` | editor |
| VICIU MARIUS ALEXANDRU | 177 | `133ab7a1-a9fc-4341-803d-4a4211ae86ee` | manager_santier | nu | #5 `inginer_izometrie` | editor |
| TOMA RAZVAN ALIN | 117 | `22145c33-66bb-4a46-9af4-485a34ecf2b8` | manager_santier | nu | #6 `manager_aprobator` | editor |

(Mai există TOMA LIVIU, emp 116. Nu e el.)

Janeta (CIOC JANETA, `70d6bb90-d920-4768-a758-1a0df99853b2`) are deja `magazie` editor și atribuirile de gestionar pe depozitele 9 / 10 / 11. **Pentru ea nu e nevoie de nimic nou.**

### 2.1 PREVIEW (read-only)

```sql
SELECT key FROM public.app_modules WHERE key='executie.izometrie';                 -- așteptat: 0 rânduri
SELECT p.id, e.name, p.is_owner,
  (SELECT count(*) FROM public.user_module_access u WHERE u.profile_id=p.id AND u.module='executie.izometrie') AS are_cheia
FROM public.profiles p JOIN public.employees e ON e.id=p.employee_id
WHERE p.id IN ('82508f76-37b9-43e1-9680-ee794c6b0e37','133ab7a1-a9fc-4341-803d-4a4211ae86ee','22145c33-66bb-4a46-9af4-485a34ecf2b8')
ORDER BY e.name;
-- așteptat: 3 rânduri (TITI JENO, TOMA RAZVAN ALIN, VICIU MARIUS ALEXANDRU), is_owner = f, are_cheia = 0
```

### 2.2 APPLY (doar după „da”: exact o cheie și trei rânduri, nimic în plus)

```sql
BEGIN;
INSERT INTO public.app_modules(key, parent_key, name, icon, color, description, is_active, display_order, show_on_homepage)
VALUES ('executie.izometrie', 'executie', 'Execuție — Izometrie teren', '📐', '#58A6FF',
        'Tabletă montaj · aprobare MP (E4)', true, NULL, false)
RETURNING key;
INSERT INTO public.user_module_access(profile_id, module, access_level, granted_by) VALUES
  ('82508f76-37b9-43e1-9680-ee794c6b0e37', 'executie.izometrie', 'editor', '01ab5a45-31f1-4868-81ec-c30fe05ab523'),  -- TITI JENO
  ('133ab7a1-a9fc-4341-803d-4a4211ae86ee', 'executie.izometrie', 'editor', '01ab5a45-31f1-4868-81ec-c30fe05ab523'),  -- VICIU MARIUS ALEXANDRU
  ('22145c33-66bb-4a46-9af4-485a34ecf2b8', 'executie.izometrie', 'editor', '01ab5a45-31f1-4868-81ec-c30fe05ab523')   -- TOMA RAZVAN ALIN
RETURNING id, profile_id, module, access_level;
COMMIT;
```

`granted_by` = profilul lui Răzvan (TRUSU RAZVAN MIHAIL, `01ab5a45-…`).

Fără `show_on_homepage`, cheia nu apare ca modul separat. Nu se dau alte module și nu se schimbă rolurile din `profiles` sau atribuirile.

### 2.3 Revenirea

```sql
BEGIN;
DELETE FROM public.user_module_access WHERE id IN (<cele 3 id-uri din RETURNING>) RETURNING id;
DELETE FROM public.app_modules WHERE key='executie.izometrie' RETURNING key;
COMMIT;
```

### Ce schimbă pentru cei trei

- Titi și Viciu pot folosi tableta (sesiune, front, declarații) **doar pe tronsoanele în flux ale proiectului 3**, unde au atribuirea de inginer.
- Toma poate vedea preview-ul, aproba, respinge, cere revizie și lămuri serii pe proiectul 3 și pe 37, unde e `manager_aprobator`. Nu își poate aproba propriile rânduri (patru ochi).
- Viciu nu e înlocuitor de aprobator (Q-E4-8 A). Răzvan rămâne rezerva, ca owner.

---

## 3. GPS — DECIS: varianta B, 60 de zile (Răzvan, 24.10)

**Decizia:** coordonatele GPS ale unei declarații se șterg la **60 de zile după decizia pe ea**. Asta înlocuiește Q-E4-15 A din design.

- **Ce se șterge:** rândul întreg din `izo_declaratii_gps` (rândul conține doar coordonatele). Se aplică declarațiilor aprobate, respinse sau șterse, după 60 de zile de la decizie (`decis_la`; la cele șterse, `updated_at`).
- **De ce și respinsele tot la 60 de zile, nu imediat:** aceeași fereastră de contestare pentru toate deciziile, apoi minimizarea datelor. Coordonatele din **repetiția din etapa 1** (toate respinse) se șterg deci la 60 de zile după respingere.
- **Ce nu se șterge:** declarațiile încă nedecise își păstrează coordonatele până la decizie.
- **Jurnalul:** fiecare ștergere lasă un rând în `izo_gps_stergeri` (declarația, versiunea, decizia, data), fără coordonate.
- **Cum:** funcția `fn_izo_gps_curata()` și jobul pg_cron `izo_gps_curatare_zilnic` (zilnic la 03:23), într-o migrare nouă `20261111a`. Migrarea trece prin harness prodlike, Copilot, DRY și „da”. Jobul se trece în `registru_automatizari` și în `automatizari`, cu fișa a–e.
- **Până la apply, coordonatele se păstrează** (comportamentul actual al E4b).

---

## 4. Scriptul pilotului (Titi pe tabletă, Toma pe laptop, Janeta)

**Înainte de pilot** (Izometrie, pe prod, după 1.2 și 2.2):
- un test de fum din contul owner-ului pe Vercel: cele trei taburi se deschid, iar „Pregătește” pe T15 întoarce frontul;
- tableta și browserul confirmate: Chrome actualizat (IndexedDB și Web Locks);
- **ecranul se deschide prima dată cu semnal.** Pornirea fără rețea (E6) nu există încă.

**Etapa 1 — repetiția (Toma respinge, nimic nu intră în registru):**

1. **Titi** se loghează pe tabletă (contul lui) → Execuție → Izometrie → tab-ul **„👷 Teren (tabletă)”**. Alege proiectul LOT 2 și tronsonul T15. Apasă **„Pregătește”** cu semnal.
   - Vede: „Front pregătit; instantaneu salvat.”
   - Raportează: timpul de încărcare și orice eroare roșie.
2. **„Deschide sesiune”** (ziua de azi). A doua tabletă pe T15 trebuie să vadă refuzul `alt_dispozitiv`; încercați o dată, cu Viciu.
3. **Montaj întreg:** „Caută seria” / „Alege seria și șarja” → alege o țeavă reală din depozit (de exemplu din depozitul 11) → confirmă lungimea → **„Salvează pe tabletă”**.
   - Vede: operația în coadă, „Cu semnal” / sincronizată.
   - Raportează: dacă seria căutată nu apare (vezi §5.1).
4. **„Țeavă tăiată + montaj”:** o altă țeavă, tăiată (de exemplu 8,00 m din 11,98) → punctul de tăiere în mm, copilul montat, restul spre depozit → salvează.
   - Vede: restul „declarat, neaprobat”.
5. **Sudură de cuplare** între cele două: cod sudură (formatul TR, de exemplu TR15S1) → salvează. Cod repetat → „Cod sudură deja folosit”.
6. **Offline:** modul avion 5–10 minute, cu pagina deschisă. Încă o declarație. Semnalul înapoi → coada pleacă singură, o singură dată.
   - Raportează: dacă apare vreo dublură.
7. **„Trimite sesiunea la MP”.**
   - Vede: sesiunea trimisă. După sincronizarea trimiterii, declarațiile nu se mai pot edita (doar pe calea reviziei cerute de MP). „Retrage trimiterea” există doar cât trimiterea e încă în coada tabletei, adică nesincronizată.
8. **Toma**, pe laptop → tab-ul **„✅ Aprobare teren (MP)”** → sesiunea lui Titi → preview-ul (simularea topologică: ce bucăți se nasc, ce rezervări se consumă). **Respinge**, cu motiv (minimum 3 caractere).
   - Vede: rezervările eliberate, iar țevile disponibile din nou în depozit.
   - Raportează: dacă preview-ul e de înțeles.
9. **Janeta**, în tab-ul **„📦 Gestionar (depozit)”**, verifică doar că nimic nu a ieșit din depozit (rezervări active: 0 după respingere). Tot aici frontul se eliberează la final.
10. **Raportul etapei** (Titi și Toma, către chat): ce a mers, ce a fost neclar, timpul pe operație, erorile (captură de ecran), plus „Exportă coada JSON” de pe tabletă dacă ceva a rămas în coadă.
    - Decizia următoare: oprim fluxul (§1.3) sau trecem la etapa 2.

**Etapa 2 — pilotul real:** pașii 1–7 pe o lucrare reală de pe T15, apoi **Toma aprobă**. Faptele intră în registru, iar stocul oficial scade. Aici se oprește repetiția; revenirea simplă nu mai există.

**Ce NU e încă implementat** (să nu se aștepte la ele în pilot):
- **serii necunoscute pe tabletă:** dacă țeava nu e în instantaneu, nu se poate declara. Se lucrează acum (§5.1);
- **corecțiile de lungime și reviziile cerute de MP**, văzute pe tabletă: serverul le are, UI-ul tabletei nu încă (§5.2);
- **repararea conflictelor din ecran** (alegerea altei țevi la un conflict de rezervare): azi apare doar codul, fără acțiune ghidată (§5.3);
- **sesiunile lăsate deschise** peste noapte nu au încă o tratare dedicată (§5.4);
- **logout-ul cu operații netrimise:** există doar avertismentul browserului la închiderea tab-ului, nu și blocarea butonului de ieșire (§5.5);
- **tăierea la ambele capete / cut-out-ul pe laptop** (ramura 2, §8.5) și primirea resturilor de către Janeta: nu încă;
- **pornirea aplicației fără rețea** (service worker, E6): pagina trebuie deschisă cu semnal;
- **fișa de tăiere semnată și raportul PDF** (E5 / Q-E4-16): nu încă.

---

## 5. Lipsurile, ordonate după impactul în pilot

Ce ia cdx, câte un run odată, cu PR draft pe `izometrie/...`, build și teste Node / Python. Dacă atinge SQL: harness PG (modul prodlike) plus o migrare **nouă** `20261111*+` cu DRY propriu (20261109a/b nu se rescriu).

| # | Lipsa | De ce contează în pilot | Unde | Cine / când |
|---|---|---|---|---|
| 5.1 | **Serii necunoscute** pe tabletă + lămurirea la MP | pe teren, prima țeavă fără serie lizibilă blochează declarația | UI tabletă + UI MP; serverul există (`fn_izo_serie_lamureste`) | **cdx E4c-1, pornit acum** |
| 5.2 | **Revizii și corecții de lungime** văzute și corectate pe tabletă | fără ele, o revizie cerută de Toma rămâne fără răspuns | UI tabletă; serverul există | cdx E4c-1 |
| 5.3 | **Repararea conflictelor** (carduri cu acțiune: altă țeavă, renunță, reîncearcă) | două tablete sau o rezervare pierdută → inginerul trebuie să știe ce face | UI + `izoTeren` / `izoCoada` | cdx E4c-1 |
| 5.4 | **Sesiuni abandonate** (deschise peste zi / noapte, front care expiră) | Titi uită o sesiune deschisă → a doua zi nu mai poate lucra pe T15 | probabil server (expirare / închidere) → migrare nouă 20261111* | cdx E4c-2 |
| 5.5 | **Blocarea logout-ului cu operații netrimise** | se pierd declarații dacă se iese din cont pe tabletă | App.jsx (logout) + `izoCoada` | cdx E4c-2 |
| 5.6 | Primirea resturilor de către Janeta (rest `in_tranzit` → `retur`) | relevant abia în etapa 2, la prima tăiere aprobată | UI gestionar (+ server de verificat) | cdx E4c-3 |
| 5.7 | Cut-out / tăiere la ambele capete pe laptop (ramura 2, §8.5) | rar la început; se poate ocoli | UI laptop + server | cdx E4c-3, dacă încape |
| 5.8 | Pornirea fără rețea (service worker, E6) | se ocolește: pagina se deschide cu semnal | E6 | după pilot |

Fiecare bucată se integrează aici: build, teste, harness unde e cazul, Copilot pe ce are miză (orice SQL nou și orice schimbare de drepturi sau gardă). Raportarea spre chat se face la predări și blocaje.
