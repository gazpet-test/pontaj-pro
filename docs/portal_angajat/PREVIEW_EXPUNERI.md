# Preview: repararea celor 3 expuneri existente (plan portal §1)

Data: 26.10.2026. „Da” Răzvan, cu regula preview → confirmare → apply, rollback, fără DROP ireversibil.

Toate cifrele de mai jos vin din SELECT-uri read-only pe prod, pe 26.10. **Nimic nu e aplicat.**

## Expunerea A: `magazie_inventar_angajat` deschis tuturor utilizatorilor logați

**Azi**, 4 politici, toate `TO authenticated`, permisive:

| politică | comandă | condiție |
|---|---|---|
| `mia_select` | SELECT | `true` → oricine e logat citește tot |
| `mia_insert` | INSERT | `auth.uid() IS NOT NULL` → oricine e logat adaugă |
| `mia_update` | UPDATE | `auth.uid() IS NOT NULL` → oricine e logat modifică |
| `mia_delete` | DELETE | `auth.uid() IS NOT NULL` → oricine e logat șterge |

Mai grav decât ce scria planul: **și scrierea e deschisă**, nu doar citirea.

**Date:** 166 de rânduri (129 active, 68 de angajați), cu mărimi de îmbrăcăminte și încălțăminte.

**Cine folosește tabela:**
- din UI, doar `Magazie.jsx`, rută protejată deja de modulul `magazie`;
- view-urile dependente `v_magazie_inventar_activ`, `v_magazie_echipamente`, `v_eip_stoc` sunt toate security_invoker și sunt citite tot doar din Magazie;
- funcțiile EIP `fn_eip_muta` și `fn_eip_corectie` sunt SECURITY DEFINER, deci nu sunt afectate.

**Propunere** (migrarea `20261116a_sec_inventar_hr_anon.sql`):
- citirea: owner + oricine are modulul `magazie` / `magazie.*` / `hr` / `hr.*`;
- scrierea: owner + modulul `magazie` / `magazie.*` cu `editor` / `admin`.

**Breakdown pe cei 33 de utilizatori (profiles):**
- **Păstrează citirea și scrierea (21):**
  - 2 owner: TRUSU RAZVAN MIHAIL, TUDORACHE MARILENA CLAUDIA;
  - 19 cu `magazie` editor sau admin: GANEA AMALIA CRISTIANA (admin), APOSTOL ANDRUT, CIOC JANETA, MITRACHE ALEXANDRU, OANCEA IONUT DANIEL, ROSU MIRELA, TITI JENO, TOMA LIVIU, TOMA RAZVAN ALIN, TSIATSIOS KONSTANTINOS, VICIU MARIUS ALEXANDRU, dragos.burdea@adromevolution.ro, claudetest@gazpet.ro, DUMITRESCU ELENA CRISTINA, NICA OANA ADRIANA, OLARU MIOARA, POPESCU GEORGIANA MIRELA, STANESCU SILVIU, TANASE ELENA MADALINA. Ultimii 7 au și `hr`.
- **Păstrează doar citirea (2, doar `hr`):** UDREA NATALIA ELENA (hr:admin), claude@gazpet.ro (hr:editor). Nu au oricum acces la pagina Magazie, deci nu pierd nimic în UI.
- **Pierd orice acces la tabelă (10, fără magazie / hr, non-owner):** BREHUI RAMONA ALINA, IOAN SORIN ALEXANDRU, MANAILA MARIAN, MILEA ANCA MARIA, NICA EUGEN, PANTEA CONSTANTIN, acarpenaru@gmail.com, razvantrusuhome@gmail.com, test.fara.modul@gazpet.ro, test.ofertare@gazpet.ro. Niciunul nu poate deschide pagina Magazie, deci nu pierd nimic în UI; pierd doar accesul direct prin API.

  `razvantrusuhome@gmail.com` pare al doilea cont al lui Răzvan, fără owner. Dacă trebuie să vadă Magazie, primește modulul cu „da” separat.

Total: 21 + 2 + 10 = 33.

## Expunerea B: granturile `anon` pe tabelele HR / inventar

`anon` (nelogat) are SELECT / INSERT / UPDATE / DELETE / REFERENCES / TRIGGER pe 4 tabele:

| tabel | RLS | politici pentru anon / public |
|---|---|---|
| `hr_aprobatori` | da | 0 |
| `hr_cereri_concediu` | da | 0 |
| `hr_concediu_rute` | da | 0 |
| `magazie_inventar_angajat` | da | 0 |

Azi RLS-ul le blochează (nicio politică pentru anon), deci **nu e o scurgere activă**. E apărare în adâncime: o politică viitoare scrisă greșit „TO public” le-ar deschide.

**Propunere:** `REVOKE ALL … FROM anon` pe cele 4 tabele, în aceeași migrare. Nicio cale publică nu le folosește cu anon: `/co` trece prin edge cu service_role.

**De știut (nu intră în această reparație):** **424 de tabele din `public` au granturi pentru `anon`**. E comportamentul implicit al Supabase, iar protecția stă în RLS. O curățare pe tot proiectul e o temă separată, mai mare, cu risc de a strica pagini publice (`/co`, `/q`, recrutare).

## Expunerea C: tokenurile `/co` în clar

| ce | număr |
|---|---|
| tokenuri în `hr_concediu_tokens` | 117 |
| active | 105 |
| active ale unor angajați inactivi / cu dată de încetare | 0 / 0 |
| angajați activi fără token activ | 18 |
| cereri depuse prin `/co` în ultimele 90 de zile | **0** (2 în total, de la lansare) |

Citirea tabelei e restrânsă deja (migrarea `20261003d`: owner + modulul `hr`), dar tokenurile **nu au fost rotite** după expunerea istorică. Un token scurs atunci încă funcționează.

**Nu ștergem nimic.** Variante (recomandarea: **C1**):

- **C1, dezactivarea tuturor celor 105 acum** (`activ = false`), reversibilă cu lista de id-uri.
  - `/co` nu e folosit (0 cereri în 90 de zile), iar portalul îl înlocuiește (decizia 4A).
  - Un token scurs nu mai merge.
  - Plaintext-ul rămâne în tabel (citit doar de HR / owner) până la lansarea portalului, când se golește odată cu închiderea `/co`.
  - Cine are nevoie între timp de `/co` primește din nou `activ = true` pe rândul lui, cu „da”.
- **C2, hash pe loc + edge `concediu-mobil` v20** care compară `sha256`.
  - Linkurile rămân valabile.
  - Dar butonul HR „copiază linkul” din ERP nu mai poate reconstrui linkul.
  - Cere deploy de edge (cu „da”) și modificarea `TabConcedii.jsx` (zona HR).
- **C3, nimic acum**, doar trecerea pe angajat la portal (deja în plan).
  - Lasă tokenurile istorice valabile până la lansare.

### C1: preview, apply și revenire (date reale, doar după „da”)

```sql
-- PREVIEW
SELECT count(*) FILTER (WHERE activ) AS active, count(*) AS total FROM public.hr_concediu_tokens;   -- așteptat: 105 | 117

-- APPLY
BEGIN;
UPDATE public.hr_concediu_tokens SET activ = false WHERE activ
RETURNING employee_id;                               -- se păstrează lista celor 105 employee_id pentru revenire
COMMIT;

-- VERIFICARE
SELECT count(*) FILTER (WHERE activ) FROM public.hr_concediu_tokens;                                 -- așteptat: 0

-- REVENIRE
UPDATE public.hr_concediu_tokens SET activ = true WHERE employee_id = ANY('{<lista din RETURNING>}');
```

## A + B: apply și revenire

- **Apply:** `supabase/migrations/20261116a_sec_inventar_hr_anon.sql`, prin `apply_migration` sau prin runner.
  - Are precondiții: politicile trebuie să fie exact cele de mai sus, altfel se oprește.
  - La final verifică: 0 granturi anon pe cele 4 tabele, 4 politici.
  - Nu șterge date.
- **Revenire:** `supabase/revenire/20261116a_sec_inventar_hr_anon_ROLLBACK.sql` recreează exact politicile și granturile vechi.
- **DRY recomandat** (chat): `BEGIN` + migrarea + un test ca `authenticated` pentru un profil fără modul (0 rânduri vizibile) și un profil cu `magazie` editor (166 de rânduri) + revenirea + `ROLLBACK`.

## Test local (26.10)

`scripts/sec/test_20261116a.sh` rulează pe PG16 local (WSL, ca utilizatorul postgres, cu `postgres` NOSUPERUSER, ca pe prod). Scheletul reproduce exact politicile de pe prod: amprenta e identică, `668a7e22…`. Rezultatul: **PASS**.
- apply-ul fără marcajul runner-ului e refuzat;
- profilul fără modul vede 0 rânduri;
- magazie editor, hr admin și owner văd tot;
- hr / magazie viewer nu poate modifica și nici insera; fără modul nu poate șterge; magazie editor modifică;
- granturile anon dispar;
- reaplicarea e refuzată de amprentă;
- revenirea restaurează exact amprenta și granturile.

Garda runner-ului și amprenta exactă a celor 4 politici sunt adăugate după review-ul Copilot (NO-GO, 2 P1).

## DRY pe prod, 26.10 (Izometrie, o singură tranzacție, `ROLLBACK` la final)

Migrarea `20261116a_sec_inventar_hr_anon.sql`: sha256 `5096c9a57561a6d18f419939eb819c9ab35fef87f971af69dc25bc689caf1ca5` (6654 octeți). Revenirea: `efaca4cf9471b02ef0deae283e5fd02b37abb6ffd2fa0b6818d0dc6412233c2f` (2593 octeți). Ambele blob LF.

| pas | rezultat |
|---|---|
| înainte | 166 de rânduri, amprenta politicilor `668a7e22…` |
| apply cu marcajul runner-ului (`20261116a_sec_inventar_hr_anon:txid`) | OK, precondiții + post-check trecute |
| fără modul (test.fara.modul) vede | **0** |
| magazie editor (CIOC JANETA) vede | 166 |
| doar hr (UDREA NATALIA) vede | 166 |
| owner (TRUSU RAZVAN) vede | 166 |
| granturi anon rămase pe cele 4 tabele | **0** |
| `control_0e` | 0 rânduri |
| revenirea armată în aceeași tranzacție | OK: 4 tabele cu anon, amprenta `668a7e22…` restaurată exact |
| după `ROLLBACK` | prod neschimbat (amprenta `668a7e22…`), migrarea neînregistrată |

Apply-ul real (runner, `--versiune 20261116120000`) se face doar după „da”-ul lui Răzvan.
