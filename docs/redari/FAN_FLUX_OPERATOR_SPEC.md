# Redări FAN — fluxul simplu pentru operator: un singur buton, urmărire automată, arhiva AWB, comanda curierului (SPECIFICAȚIE)

Stare: 18.11.2026, după primul AWB real (Testul 1, lot de TEST cu un plic). **Doar document.** Nu există cod, migrare sau schimbare de date în
acest PR; migrările sunt DESCRISE (§13), nu scrise. Deciziile proprietarului D1–D7 (§0) sunt **luate** și nu se redeschid aici; ce rămâne cu
adevărat deschis e la §15. Orice migrare, RPC, automatizare sau drept propus aici **necesită acordul proprietarului** și se livrează în felii
separate (§13), fiecare cu review propriu (Jakarinos + Fable), după `docs/paw/LECTII_REVIEW.md` (§14).

Documentul are doi cititori. **Partea I (§1–§5)** e pentru proprietar: cum arată ziua operatorului, ce rămâne la el, ce se întâmplă singur,
ce NU face platforma. **Partea II (§6–§16)** e pentru recenzent și implementator. Proiectarea integrării (câmpuri, răspunsuri, cazurile
urâte, fișa de securitate a lanțului de azi) rămâne în `FANCOURIER_INTEGRARE.md`; procedura Testului 1 rămâne în `FAN_TEST1_PASI.md`. Acest
document NU le repetă: spune ce se schimbă față de ele și de ce.

Termeni: **operator** = coleg numit explicit de proprietar să trimită plicuri la curier (§7.1); **owner** = proprietarul (`is_owner`);
**lot** = lotul de plicuire din ✉️ Poștă (PV de plicuire semnat de doi colegi); **plic** = un deținător + un UAT, toate convocările lui;
**AWB** = numărul de expediere al curierului; **ridicat** = evenimentul curierului „preluat de la expeditor” (codul C0); **AR** = confirmarea
de primire; **oPOD** = opțiunea curierului prin care confirmarea semnată se întoarce fizic; **tiraj** = mulțimea tipărită odată (etichete +
pagina de control + documente), cu identificatorul ei; **curierul** = FAN Courier.

Cuprins: 0. Deciziile proprietarului · **I.** 1. Ziua operatorului · 2. Ce rămâne la proprietar · 3. Ce se întâmplă singur · 4. Ce NU face
platforma · 5. În ce ordine livrăm · **II.** 6. Starea de azi · 7. Modelul de drepturi și plafonul · 8. Butonul unic · 9. Urmărirea automată ·
10. Arhiva · 11. Comanda curierului · 12. De la test la real · 13. Feliile livrabile · 14. Lecțiile L01–L25 · 15. Întrebări deschise ·
16. Ce nu s-a putut stabili din cod.

---

## 0. Deciziile proprietarului (18.11.2026) — nu se redeschid

| # | Decizia | Unde o pune în practică documentul |
|---|---|---|
| D1 | Operatorul are UN buton: alege plicurile și apasă „Trimite la curier”; propunerea, aprobarea, generarea AWB-urilor și descărcarea etichetelor + paginii de control se fac în spate, cu un rezultat pe înțelesul lui. | §1, §8 |
| D2 | Butonul îl apasă DOAR operatorii numiți de proprietar (listă explicită, administrată de owner), fiecare din contul lui; evidența ține cine a trimis ce. NU un cont comun cu drept de owner. | §7.1 |
| D3 | Frâna pe bani = un PLAFON pus de owner (AWB-uri pe zi fără aprobare); peste plafon butonul se oprește și cere aprobarea owner-ului. | §7.2 |
| D4 | Urmărirea rulează automat de trei ori pe zi (08:00, 13:00, 18:00, ora României) și bifează singură, pe codurile limpezi: ridicat → „expediat” (AWB + data ridicării, de unde curg cele 10 zile); livrat → AR; refuzat / întors → retur. Codurile nelimpezi nu bifează nimic și intră într-o listă „de verificat”. Fiecare bifare rămâne în evidență cu codul și ora curierului. | §3, §9 |
| D5 | Eticheta (PDF) și dovada de livrare se salvează în dosarul plicului, lângă convocare și opis; arhiva ZIP a lotului le cuprinde (fișiere separate pe plic). | §10 |
| D6 | Comanda curierului din platformă; punctul de ridicare = punctul de lucru al contului de curier; persoana de contact implicită, configurabilă pe proiect. | §11 |
| D7 | Eticheta pe A6 — întrebare deschisă către curier. | §15.2 |

Există un cont de operator fără owner pentru probe (`redari@`, editor pe modulul Redări): cu el se probează fiecare felie pe `TEST-RAZVAN` (§12.3).

---

# Partea I — pe înțelesul proprietarului

## 1. Ziua operatorului

Operatorul intră în ✉️ Poștă, deschide lotul de plicuire pe care l-a pregătit (plicurile lipite, opisul la dosar, PV-ul de plicuire semnat de
doi colegi) și apasă **„📦 Trimite la curier”**. Ecranul îi arată lista plicurilor din lot, cu bifă pe fiecare (toate bifate implicit), și
lângă fiecare plic un semn: verde „gata” sau galben „lipsește telefonul / județul / strada”. Plicurile galbene nu pot fi bifate: le repară din
fișa deținătorului (telefonul, adresa), apoi revine. Sus scrie cât mai poate trimite azi fără aprobarea proprietarului („azi mai poți trimite
17 plicuri fără aprobare”).

Apasă **„Trimite la curier (12 plicuri)”** → o singură confirmare („Trimiți 12 plicuri la curier? Fiecare AWB costă.”) → așteaptă câteva
secunde → primește un singur mesaj, de exemplu:

> **12 AWB-uri generate, 1 respins: PL-HUS-0007 — lipsește telefonul.** Tarif: 326,40 lei fără TVA.
> S-au descărcat: etichetele (PDF, 12 poziții) și pagina de control (tirajul 7B2C91A0). Tipărește etichetele, lipește-le după pagina de
> control (poziția, numărul plicului, AWB-ul) și cheamă curierul.

În spate s-au întâmplat, fără să le vadă: propunerea, aprobarea sub plafon, rezervarea, apelul plătit către curier, scrierea rezultatului,
etichetele și pagina de control (§8). Dacă ceva nu e limpede (curierul n-a răspuns, răspunsul e ciudat), mesajul e unul singur și spune
exact ce are de făcut: **„Răspunsul curierului nu s-a confirmat pentru 12 plicuri. NU retrimite. Apasă «Verifică la curier» după 10 minute.”**
Nimic nu se retrimite singur — un AWB dublu costă dublu.

Apoi operatorul cheamă curierul (azi: din contul curierului, manual, §11), predă plicurile și **nu mai are nimic de făcut**: de trei ori pe zi
platforma întreabă curierul ce s-a întâmplat cu fiecare AWB și bifează singură ridicarea, livrarea și returul (§3). Ce nu e limpede apare la el
într-o listă scurtă „De verificat”, cu un buton „Verifică la curier” și cu ce să caute în contul curierului.

**Schița ecranului (text):**

```
┌ 📦 Trimite la curier — lotul PP-0012 (UAT HUS) ──────────────────────────────────────────────┐
│ Azi mai poți trimite 17 plicuri fără aprobarea proprietarului (plafon 20/zi; 3 trimise).   │
│                                                                                              │
│ [x] PL-HUS-0005  POPESCU I.   Str. …, Băbeni, Vâlcea     ✓ gata                              │
│ [x] PL-HUS-0006  IONESCU M.   Str. …, Băbeni, Vâlcea     ✓ gata                              │
│ [ ] PL-HUS-0007  GEORGESCU A. Str. …, Băbeni, Vâlcea     ⚠ lipsește telefonul (fișa deținătorului) │
│ …                                                                                            │
│ Selectate: 12 din 13 plicuri.                                                                │
│                                                                                              │
│ [ Trimite la curier (12 plicuri) ]   [ Retipărește etichetele ]   [ Verifică la curier ]     │
│                                                                                              │
│ Ultimul rezultat: 12 AWB-uri generate, 1 respins (PL-HUS-0007 — lipsește telefonul).        │
│ Tarif 326,40 lei fără TVA. Tirajul 7B2C91A0: etichete + pagina de control descărcate.        │
│                                                                                              │
│ De verificat (2): PL-HUS-0002 — curierul a dat două date de ridicare; PL-HUS-0003 — cod S65 │
│ „în așteptare”. Deschide contul curierului și verifică; proprietarul / adminul soluționează. │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Butoanele vechi (1. Propune … 7. Confirmări) nu dispar: rămân într-o casetă „Pași detaliați (owner)”, strânsă implicit, pentru
proprietar și pentru situațiile rare (reconciliere, tiraj nou, anulare, soluționare).

## 2. Ce rămâne la proprietar

- **Lista operatorilor** (§7.1): din ecranul Redări → „Operatori curier”: adaugi / retragi un coleg; fiecare trimitere poartă numele lui.
  Un coleg care nu e pe listă vede butonul, dar dezactivat, cu motivul „doar operatorii numiți de proprietar”.
- **Plafonul zilnic** (§7.2): câte AWB-uri se pot aproba într-o zi (ora României) fără tine, pentru tot modulul; implicit mic (20), îl
  schimbi din ecran. Rămâne și plafonul pe lot de azi (câte plicuri pe un lot).
- **Cererile peste plafon**: când un operator cere mai mult decât permite plafonul zilei, plicurile lui așteaptă într-o casetă „Cereri de
  aprobare” pe care o vezi în Poștă (și pe lotul respectiv); apeși „Aprobă” sau „Respinge”, cu motiv; după „Aprobă”, operatorul (sau tu)
  apasă din nou „Trimite” și plicurile pleacă, fără să mai consume din plafon.
- **Excepțiile**: marcarea unui lot ca TEST pe un proiect real (ca să probezi fără efect juridic), „Tiraj nou” (când foile tipărite
  trebuie distruse și refăcute), confirmarea că un AWB **nu există** la curier (deschide drumul unui al doilea AWB, deci cost), soluționarea
  unei contradicții a urmăririi (azi: tu sau un admin Redări).
- **Întrerupătoarele**: urmărirea automată pornită / oprită; arhivarea automată pornită / oprită; plafonul zilei pe 0 = totul cere aprobarea ta.

## 3. Ce se întâmplă singur

De trei ori pe zi (08:00, 13:00, 18:00, ora României), pentru fiecare AWB neîncheiat:

| Ce spune curierul | Ce bifează platforma, singură | Ce vede operatorul |
|---|---|---|
| ridicat de curier (codul C0), o singură dată | pe un lot REAL: plicul devine „expediat” cu AWB-ul și **data ridicării** (ora României) — de aici curg cele 10 zile; pe un lot de TEST: doar evidența | plicul trece în registru ca expediat |
| livrat (codul S2) | plicul primește faptul „livrat de curier la <data/ora>”; AR-ul (confirmarea de primire) se bifează **doar când dovada curierului e arhivată** în dosarul plicului (§10) — altfel rămâne „livrat, dovada în așteptare” | „livrat · dovada arhivată” sau „livrat · dovada în așteptare” |
| refuzat / adresă greșită / mutat / întors (codurile de retur) | plicul primește faptul „retur semnalat de curier (<motiv>) la <data>”; returul **definitiv** (cel din PV B) rămâne cu scanul plicului întors, ca azi (§9.4; §15.1 Q5) | „retur semnalat · plicul se întoarce” + buton „Înregistrează returul…” când sosește plicul |
| în tranzit / avizat / contactat / „AWB înregistrat” | nimic pe plic; se vede starea | „în drum”, „avizat”, „neridicat încă” |
| orice cod nelimpede, două date diferite pentru acelaşi fapt, livrat ȘI retur, dată imposibilă | **nimic**; plicul intră în „De verificat” | lista „De verificat”, cu codul și ora curierului |

Fiecare bifare automată rămâne în jurnal cu codul și ora primite de la curier, cu rularea care a făcut-o, și se vede pe plic („bifat automat
din urmărirea curierului, C0 din 19.11.2026 09:12”). Dacă mai târziu curierul contrazice ce a spus (altă dată de ridicare), platforma NU
înlocuiește singură: păstrează ce știa, pune noua valoare alături și cere omului să aleagă (ca azi).

Arhiva (§10): eticheta fiecărui AWB și dovada de livrare (în forma în care o dă curierul) se salvează singure în dosarul plicului, lângă opis
și convocare; „Documente lot (ZIP)” le cuprinde, ca fișiere separate pe plic.

## 4. Ce NU face platforma

- Nu trimite nimic la curier fără apăsarea unui operator numit; nu retrimite niciodată singură un plic al cărui rezultat nu s-a confirmat.
- Nu cheamă curierul singură (nici după ce comanda din platformă va exista: fiecare comandă e un apăsat de om, §11).
- Nu înregistrează singură un retur definitiv și nu bifează AR fără o dovadă arhivată; nu scrie nimic pe plic la codurile nelimpezi.
- Nu schimbă singură un fapt deja bifat (data ridicării) — o contradicție o soluționează un om.
- Nu trimite mailuri, SMS-uri sau mesaje colegilor; nu dă drepturi; nu șterge fișiere.
- Nu pune date personale în fișierele de lucru (pagina de control are destinatarul mascat; borderoul CSV n-are nume / telefoane).
- Nu bifează nimic pe proiectele reale cât timp garda „doar proiecte de TEST” e pornită (§12).

## 5. În ce ordine livrăm (detaliile la §13)

1. **F1 — Operatorii numiți + butonul unic** (încă pe proiecte de TEST): cea mai mare ușurare pentru operator (șapte pași → unul), cu riscul
   ținut de garda „doar TEST”, de plafonul zilei și de plafonul pe lot.
2. **F2 — Urmărirea automată** (trei rulări pe zi; pe loturile de TEST scrie doar evidența, deci se probează fără efect juridic).
3. **F3 — Arhiva** (eticheta pe plic, dovada de livrare, AR-ul automat doar cu dovadă).
4. **F4 — Trecerea la proiectul real** (garda „doar TEST” cade; cere „da”-ul juridic, §12).
5. **F5 — Comanda curierului din platformă** (după răspunsul curierului la întrebările din §15.2).
6. **F6 — Eticheta A6** (depinde de curier; poate fi zero cod).

Ce ne trebuie de la tine înainte de F1: răspunsurile la cele șase întrebări din §15.1 (fiecare cu variante și recomandare).

---

# Partea II — pentru recenzent și implementator

## 6. Starea de azi (ce există și ce se refolosește)

Lanțul de azi (`FANCOURIER_INTEGRARE.md` §3–§6) are tot ce îi trebuie fluxului nou ca **primitive**; ce lipsește e orchestrarea, poarta de
operator, plafonul zilnic, cronul, arhiva și comanda curierului.

| Există azi (se refolosește neschimbat sau cu poarta lărgită) | Unde |
|---|---|
| corpul expedierii, hash-ul aprobat, amprenta surselor, bucățile de ≤ 100, interpretarea răspunsurilor, manifestul comun, cheia de tiraj | `supabase/functions/_shared/redariFan.mjs` |
| calea reală: login, creare în loturi cu claim → POST → rezultate (L04/L05/L22), urmărire / confirmări în bucăți, etichete pe manifest cu tiraj, reconciliere, ștergere | `redariFanTransport.mjs` |
| poarta funcției edge: JWT → utilizator → **owner** → cerere → lot (RLS) → flag → garda „doar TEST” → abia apoi secretele | `redariFanHandler.mjs`, `redari-fan-awb/index.ts` |
| tabelele `red_fan_awb` (un rând viu pe plic, stări, fapte + contradicții, versiune CAS), `red_fan_loturi` (marcaj TEST / real imuabil, tiraj + oprire), `red_fan_setari` (plafonul pe lot); 19 funcții `fn_red_fan_*`; RLS citire admin / editor; scrieri doar prin RPC | `20261212a_redari_fan_awb.sql` (aplicată 17.11.2026) |
| ecranul cu cei 7 pași + operațiile; simulatorul procedurii; testele | `src/redari/fanLot.js`, `ui/FanAwbPrevizualizare.jsx`, `fanCourier*.test.js` |
| bucket-ul privat `redari`, politici admin / editor (SELECT, INSERT; fără UPDATE / DELETE), calea plicului `plicuri/<plic_id>/…`, scanul AR / retur verificat în Storage de trigger | `20261126a`, `20261129i` |
| tiparul cron → edge cu poartă internă: pg_cron (postgres) → `net.http_post` cu antetul `x-intern-secret` din Vault → edge verifică prin `fn_verifica_secret` (EXECUTE doar `service_role`), fail-closed | `20261011a_sec_edge_poarta_intern.sql`, `cleanup-recycle-bin`, `api-consum-extern` |
| registrul automatizărilor (fișa a–e pe coloane) | `public.automatizari` (`20261010a`) |

Ce se schimbă la primitive: **poarta** RPC-urilor de pe drumul butonului (propune → aprobă → claim → rezultate → tiraj → etichete) devine
„operator numit SAU owner” (§7.1), cu identitatea celui care apasă în coloanele de autor; restul porților owner rămân (§2).

## 7. Modelul de drepturi și plafonul

### 7.1 Operatorii numiți (D2)

**Unde se ține lista**: tabel nou `red_fan_operatori`, nu nivelul de acces existent. De ce: (1) nivelul `editor` pe modulul Redări e dat
multor colegi pentru alte lucrări (fișe, convocări, PV-uri) — a-l face „drept de a cheltui” ar lărgi tacit drepturi existente; (2) un nivel
nou în `user_module_access` ar schimba CHECK-ul unui tabel **comun** tuturor modulelor (CLAUDE.md pct. 6: nu se atinge fără cerere); (3) owner-ul
a cerut o listă explicită, cu istoric (cine a numit, când, cine a retras). Nivelul pe modul rămâne **precondiție**: un operator trebuie să fie
și admin / editor Redări (altfel RLS-ul nu îl lasă să citească plicurile și contactele) — două chei, nu una.

```
red_fan_operatori (
  profile_id uuid PRIMARY KEY,                -- contul colegului (fără FK spre profiles: ar cere lock la aplicare, ca în 20261212a)
  numit_de uuid NOT NULL, numit_la timestamptz NOT NULL DEFAULT now(),
  retras_de uuid, retras_la timestamptz,       -- retragerea NU șterge rândul (istoric); re-numire = rând nou? NU: același rând, retras_* golite, cu jurnal
  nota text CHECK (nota IS NULL OR length(nota) <= 200),
  CONSTRAINT red_fan_operatori_retras CHECK ((retras_de IS NULL) = (retras_la IS NULL))
)
```
- RLS: SELECT pentru `authenticated` cu `auth.uid() IS NOT NULL AND fn_red_nivel() IN ('admin','editor')` (operatorul își vede starea, ecranul
  afișează lista owner-ului); fără INSERT / UPDATE / DELETE pentru nimeni; scrieri doar prin RPC.
- `fn_red_fan_operator_seteaza(p_profile uuid, p_activ boolean, p_nota text)` — SECURITY DEFINER, `SET search_path = public, pg_temp`, EXECUTE
  doar `authenticated`, poarta în corp: `fn_red_fan_e_owner()`; refuză un profil fără nivel Redări admin / editor (verificare internă pe
  `user_module_access`, într-o funcție internă fără EXECUTE pentru roluri; nu sondează alte conturi din UI); refuză `p_profile = auth.uid()`?
  NU — owner-ul se poate numi și pe el (e oricum peste poartă); fiecare schimbare = rând în `red_jurnal` (tabela `red_fan_operatori`,
  `user_id = auth.uid()`). Coloanele de autor le pune serverul (L08).
- `fn_red_fan_e_operator()` — SECURITY DEFINER, STABLE, EXECUTE pentru `authenticated` (ecranul o cheamă ca să afișeze butonul):
  `fn_red_fan_e_owner() OR (auth.uid() IS NOT NULL AND fn_red_nivel() IN ('admin','editor') AND EXISTS (rând activ pentru auth.uid()))`.
  O SINGURĂ definiție (L19): o cheamă RPC-urile, funcția edge (`deps.operator()` în locul lui `deps.owner()` pe acțiunea `trimite`) și ecranul.
- **Pe server, niciodată din client**: identitatea = `auth.uid()` din JWT-ul omului (L08); funcția edge NU primește rolul în corp; RPC-urile
  verifică poarta în corp, nu doar prin EXECUTE. Testul negativ: contul `redari@` fără rând în listă → 403 pe `trimite`, 42501 pe RPC-uri;
  cu rândul retras → la fel; viewer cu rând → refuz (nivelul e precondiție).
- **Ce se întâmplă cu poarta owner de azi**: rămâne owner pe `fn_red_fan_setari_seteaza` (plafoanele, întrerupătoarele), `fn_red_fan_lot_marcheaza`
  (marcajul manual TEST / real — excepțiile), înlocuirea tirajului, `fn_red_fan_reconciliaza` cu `p_awb NULL` (confirmarea absenței = drum spre
  al doilea AWB), `fn_red_fan_cerere_decide` (§7.2), lista operatorilor. Devine „operator sau owner”: propunere (azi admin / editor → devine
  operator; propunerea singură nu costă, dar e un pas al butonului), aprobare sub plafon, claim, rezultate, tiraj (începere / confirmare),
  urmărire / confirmări la cerere, confirmarea ridicării, reconcilierea cu `p_awb` găsit (nu costă), anularea unui AWB neridicat (nu costă;
  §15.1 Q3). Soluționarea contradicțiilor rămâne owner / admin Redări (existent).

### 7.2 Plafonul (D3)

**Unitatea recomandată: AWB-uri aprobate pe ZI (ora României), pe tot modulul** — nu pe lot (lotul e unitatea de tipărire, nu de cost) și
nu pe proiect (în primul val e un singur proiect). Plafonul pe lot de azi (`limita_lot`) rămâne ca a doua frână (un lot aberant de 1.400 de
plicuri nu trece oricum). Alternativa „pe săptămână” e în §15.1 Q1.

- `red_fan_setari` primește: `limita_zi integer NOT NULL DEFAULT 20 CHECK (limita_zi BETWEEN 0 AND 5000)` (0 = orice trimitere cere
  aprobarea owner-ului), `urmarire_auto_activa boolean NOT NULL DEFAULT false`, `arhivare_auto_activa boolean NOT NULL DEFAULT false`;
  scrise doar prin `fn_red_fan_setari_seteaza` extinsă (owner), fiecare schimbare în `red_jurnal`.
- **Numărarea atomică** (L01: lock înainte de verificare, fără insert-apoi-count): tabel `red_fan_zi (zi_ro date PRIMARY KEY, aprobate integer
  NOT NULL DEFAULT 0 CHECK (aprobate >= 0))`. RPC-ul butonului (§8) ia ÎNTÂI `SELECT … FROM red_fan_setari WHERE id FOR UPDATE` (un singur rând →
  serializează toate aprobările din modul; tranzacția e scurtă: doar scrieri în BD, apelul plătit e în afara ei), apoi
  `INSERT INTO red_fan_zi (zi_ro, aprobate) VALUES (azi_ro, n) ON CONFLICT (zi_ro) DO UPDATE SET aprobate = red_fan_zi.aprobate + EXCLUDED.aprobate
  WHERE red_fan_zi.aprobate + EXCLUDED.aprobate <= v_limita RETURNING aprobate` — zero rânduri = peste plafon, nimic aprobat. Ziua =
  `(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date` (L17; `CURRENT_DATE` e UTC). Postcondiție de paritate în probe: `aprobate` =
  numărul rândurilor `red_fan_awb` cu `aprobat_la` în ziua respectivă și fără aprobare owner.
- Doi operatori deodată: al doilea așteaptă lock-ul rândului de setări (milisecunde), apoi vede contorul actualizat; nu pot trece amândoi
  „pe muchie” (probă cu două sesiuni, §13 F1).
- **Peste plafon**: tot clickul așteaptă (recomandat; alternativa „se trimit câte intră” e §15.1 Q2) — rândurile intră în starea nouă
  `de_aprobat` (adăugată în CHECK-ul `red_fan_awb.stare`; nu intră în manifest, nu se tipăresc, nu se rezervă), legate de un rând nou
  `red_fan_cereri_aprobare (id, lot_id, proiect_id, cerut_de, cerut_la, n, zi_ro, stare CHECK IN ('deschisa','aprobata','respinsa'), decis_de,
  decis_la, motiv ≤ 500)` cu `red_fan_awb.cerere_aprobare_id`. Owner-ul vede cererile deschise (casetă în Poștă + pe lot) și apasă „Aprobă” /
  „Respinge” → `fn_red_fan_cerere_decide(p_id, p_aproba boolean, p_motiv)` (owner; lot FOR UPDATE → rânduri ORDER BY id FOR UPDATE → cererea;
  aprobare = rândurile → `aprobat` cu `aprobat_de = auth.uid()` (owner) și `aprobare_owner_la = now()` — **nu consumă plafonul zilei**; respingere =
  rândurile → `propus`, cererea `respinsa`; CAS pe `stare = 'deschisa'`). După aprobare, trimiterea efectivă (claim → POST) se face la următorul
  apăsat pe „Trimite” (operator sau owner), care găsește rânduri `aprobat` și NU le mai numără. Ecranul spune înainte de apăsare cât mai încape
  azi, ca operatorul să poată alege mai puține plicuri.
- Plafonul pe lot rămâne în `fn_red_fan_aproba` / în RPC-ul nou, neschimbat ca regulă (deja aprobate / trimise + cele de acum ≤ `limita_lot`).

## 8. Butonul unic: orchestrarea peste lanțul existent

### 8.1 Ce refolosește, ce e nou

| Pas al butonului | Azi | În fluxul nou |
|---|---|---|
| citirea plicurilor, contactelor, corpului, hash-ului, amprentei surselor | ecran + funcția edge (`pregatestePlicuriFan`, `amprenteSurse`) | neschimbat, în funcția edge |
| propunere | `fn_red_fan_propune` (un plic pe apel, admin / editor) | logica ei devine funcție internă (fără EXECUTE), chemată din RPC-ul nou pentru fiecare plic |
| marcaj TEST / real | owner, manual, înainte de aprobare | **automat** la prima trimitere: `test = proiectul e TEST-` dacă lotul nu are marcaj; un marcaj pus de owner înainte (excepție) se respectă; după prima aprobare rămâne imuabil (trigger existent) |
| aprobare | `fn_red_fan_aproba` (owner, pe hash-urile văzute în ecran, plafon pe lot) | aceleași verificări + plafonul zilei (§7.2), în RPC-ul nou, autor = operatorul |
| rezervare → apel plătit → rezultate | `fn_red_fan_claim_lot` → `POST /intern-awb` → `fn_red_fan_rezultate` (owner) | neschimbat, poarta „operator sau owner” |
| etichete + pagina de control | acțiunea `eticheta` pe fiecare parte, apăsată de owner; tiraj | chemată **automat** de funcția edge pentru toate părțile, în același răspuns; pagina de control o face ecranul ca azi (`controlLotFan`) |
| rezultatul | mesajul tehnic („Generate: 1; respinse: 0; necunoscute: 0…”) | un mesaj pe înțelesul operatorului (§8.5) |

**RPC nou `fn_red_fan_comanda(p_lot_id uuid, p_intentie uuid, p_plicuri jsonb, p_hash_cerere text)`** — SECURITY DEFINER, `search_path` fix,
EXECUTE `authenticated`, poarta în corp `fn_red_fan_e_operator()`. `p_plicuri` = `[{plic_id, hash}]` (hash-ul corpului calculat de funcția edge
din citirile ei — același cu cel pe care l-ar fi aprobat owner-ul azi); `p_hash_cerere` = sha256 pe lista canonică a plicurilor (idempotență,
L04). Într-O tranzacție (L02): (1) intenția (§8.3); (2) `red_loturi_plicuire FOR UPDATE` → marcajul automat → plicurile `ORDER BY id FOR UPDATE` →
rândurile FAN `ORDER BY id FOR UPDATE` → `red_fan_setari FOR UPDATE` → `red_fan_zi` (ordinea L06, scrisă în comentariul funcției; `red_fan_loturi`
după plicuri ca azi); (3) pentru fiecare plic: verificările din `fn_red_fan_propune` + `fn_red_fan_aproba` (activ, neexpediat, fără AWB, în
lot; un rând viu `propus` / `aprobat` se refolosește, altul = refuz pe acel plic cu motiv, nu pe toată cererea — plicul intră la „excluse”);
(4) plafonul pe lot; (5) plafonul zilei: dacă încape → `aprobat` (autor = `auth.uid()`), altfel toate → `de_aprobat` + cerere; (6) întoarce
`{aprobate: [id…], de_aprobat: n, cerere_id, excluse: [{nr_plic, motiv_cod}]}`. Rândurile `aprobat` rămase dintr-o trimitere anterioară
întreruptă (§8.2) sau dintr-o cerere aprobată de owner intră în lista de trimis fără să fie numărate din nou.

**Acțiune nouă în funcția edge: `trimite`** (`ACTIUNI_FAN` + `raspundeFan`): corp `{actiune:'trimite', lot_id, plic_ids:[uuid…] (1…2000),
intentie: uuid}`. Ordinea porților neschimbată: JWT → utilizator → **operator** (nou: `deps.operator()` = `fn_red_fan_e_operator`) → cerere →
lot (RLS) → flag → garda „doar TEST” → secretele. Apoi: citiri → `fn_red_fan_comanda` → bucla existentă claim → POST → rezultate (oprire la
primul „necunoscut”, L05) → dacă nimic „necunoscut” și cel puțin un AWB: etichetele pe toate părțile (logica `eticheta`, tiraj început /
confirmat / reverificat după PDF) → `fn_red_fan_intentie_incheie` (§8.3) → răspuns `{rezultat, pdf_parti:[base64…], tiraj, manifest_cheie,
ramase, tarif_total, respinse:[{nr_plic, motiv_cod}], excluse, necunoscute, oprit}`. Fără etichete când există „necunoscut” (manifestul nu e
sigur). Dacă etichetele pică (502) după AWB-uri generate, răspunsul spune că AWB-urile există și că etichetele se descarcă cu „Retipărește
etichetele” (același tiraj).

### 8.2 Atomicitate și reluare

- **Fiecare pas durabil e în BD înaintea pasului plătit** (L22): aprobarea (`fn_red_fan_comanda`) și rezervarea (`fn_red_fan_claim_lot`) sunt
  tranzacții separate; apelul plătit e între rezervare și rezultate; rezultatele unei solicitări se scriu toate odată (`fn_red_fan_rezultate`).
- **Întrerupere între aprobare și generare** (funcția edge moare, rețea): rândurile rămân `aprobat`, nimic plătit. Următorul apăsat pe
  „Trimite” (orice intenție) le găsește și le trimite fără să le numere din nou (plafonul s-a consumat la aprobare). Ecranul arată „12 plicuri
  aprobate, netrimise” și butonul spune „Trimite (12 aprobate + 3 noi)”.
- **Întrerupere între rezervare și rezultate** (rândurile `in_curs`) sau răspuns „necunoscut”: **niciodată regenerare** (L05). Ecranul arată
  „trimitere neîncheiată: N plicuri cu rezultat necunoscut” și butonul „Trimite” e dezactivat pe acel lot până la reconciliere. „Verifică la
  curier” (operator) = acțiunea `reconciliaza` existentă pe ziua trimiterii: propunerile „găsit: AWB …” le poate confirma operatorul
  (`fn_red_fan_reconciliaza` cu `p_awb` — nu costă); „nu apare în borderoul complet” o confirmă DOAR owner-ul (deschide un al doilea AWB);
  „de verificat în selfAWB” n-are buton. Fereastra de 10 minute pentru `in_curs` rămâne (ceasul efectiv, ca azi).
- **Rezultate scrise, etichete nedescărcate**: AWB-urile există; „Retipărește etichetele” cere același tiraj (cheia manifestului curent =
  tirajul început → aceleași fișiere; altă cheie → refuz „tirajul s-a schimbat”, drumul „Tiraj nou” al owner-ului, ca azi).

### 8.3 Idempotență: dublu-click și două taburi (L04 / L05, lecția „L05 în UI”)

- **Cheia intenției**: ecranul generează un UUID la fiecare apăsare pe „Trimite” și îl scrie într-un **registru local** (`localStorage`, o
  intrare pe cheie, `{lot_id, plic_ids, hash_cerere, inceput_la}`) ÎNAINTE de apel; scrierea se verifică prin recitire (eșec = nu trimite).
  Intrarea iese din registru DOAR la rezultat dovedit (răspuns `ok`, sau refuz determinist 4xx cu cod cunoscut); un 42501 / 5xx / timeout nu
  dovedește nimic → intrarea rămâne, iar la redeschiderea ecranului se caută în BD (`red_fan_intentii`) starea cheii și se afișează.
- **În BD**: `red_fan_intentii (cheie uuid PRIMARY KEY, lot_id, proiect_id, operator uuid NOT NULL, hash_cerere text NOT NULL, stare CHECK IN
  ('in_curs','incheiata','neincheiata'), rezultat jsonb, inceput_la timestamptz NOT NULL, incheiata_la timestamptz)`. `fn_red_fan_comanda` face
  `INSERT … ON CONFLICT (cheie) DO NOTHING RETURNING`; fără rând întors → recitește: aceeași cheie + același hash + `incheiata` → întoarce
  rezultatul memorat (**replay**, nimic nou trimis); aceeași cheie + `in_curs` → `RD030` „trimiterea e în curs în alt tab; așteaptă”; aceeași
  cheie + alt hash → `22023` (cerere coruptă). Al doilea tab cu o cheie **nouă** pe același lot, cât primul e `in_curs`: lotul e sub
  `FOR UPDATE` doar cât durează tranzacția RPC-ului; de aceea RPC-ul refuză și cu `RD030` dacă există o intenție `in_curs` pe lot mai nouă de 10
  minute (ceasul efectiv). Rândurile `aprobat` ale primului tab nu pot fi oricum rezervate de două ori (claim-ul cere `aprobat`).
- `fn_red_fan_intentie_incheie(p_cheie, p_rezultat jsonb)` (operator / owner; CAS pe `stare = 'in_curs'` și `operator = auth.uid()` SAU owner):
  scrie `incheiata` + rezultatul (fără PII: numere de plic, AWB-uri, coduri de motiv, sume). O intenție `in_curs` de peste 10 minute pe care
  nimeni n-o încheie devine `neincheiata` la reconciliere (operatorul apasă „Verifică la curier”, care o închide după ce rândurile nu mai sunt
  `in_curs` / `necunoscut`).
- **Dublu-click în același tab**: `ocupat` (ref) + butonul dezactivat cât `lucru` + registrul local (a doua apăsare cu intenție nouă e refuzată
  local cât prima e în registru pe același lot).

### 8.4 Tirajul și retipărirea

Neschimbate ca reguli (`FANCOURIER_INTEGRARE.md` §3 pasul 4, §5): prima descărcare fixează tirajul; toate părțile + arhiva cer aceeași cheie;
„Tiraj nou” în trei pași, owner. Ce se schimbă: (1) prima descărcare o face funcția edge imediat după generare, în aceeași apăsare; (2)
operatorul are „Retipărește etichetele” (același tiraj; refuz limpede dacă s-a schimbat); (3) **recomandare**: un lot se trimite o singură
dată, întreg; plicurile respinse și corectate se mută într-un lot nou de plicuire (azi plicul poate schimba lotul înainte de expediere) ca să
nu schimbe manifestul lotului deja tipărit — altfel orice trimitere ulterioară pe același lot schimbă manifestul și cere „Tiraj nou” (owner,
cu distrugerea foilor). Varianta e la §15.1 Q6.

### 8.5 Mesajele pentru operator (o singură definiție în `fanLot.js`, L19; motivul în BD rămâne codul, nu textul)

| Ce s-a întâmplat (codul din răspuns / din rând) | Ce vede operatorul | Ce are de făcut |
|---|---|---|
| `generat` | „N AWB-uri generate” + tarif total (fără TVA) | tipărește, lipește după pagina de control, cheamă curierul |
| respins de curier, câmp `phone` | „PL-… — telefonul lipsește sau e greșit” | completează telefonul în fișa deținătorului, apoi „Trimite” din nou (plicul singur) |
| respins, câmpuri `county` / `locality` / `street` / `zipCode` | „PL-… — adresa nu e recunoscută de curier (județ / localitate / stradă)” | corectează adresa în fișă (localitatea ca în nomenclatorul curierului), apoi „Trimite” |
| respins, câmp `name` / fără câmp recunoscut | „PL-… — curierul a respins expedierea; detalii în contul curierului” | anunță proprietarul / adminul |
| exclus: „datele s-au schimbat după aprobare” | „PL-… — datele s-au schimbat între timp; nimic trimis pentru el” | „Trimite” din nou (se recalculează) |
| exclus: plic anulat / expediat manual / mutat din lot | „PL-… — plicul nu mai e în lot sau are deja expediere” | nimic |
| `de_aprobat` (peste plafon) | „N plicuri așteaptă aprobarea proprietarului (plafonul zilei: X)” | așteaptă; după aprobare, „Trimite” din nou |
| `necunoscut` / `in_curs` rămas | „Răspunsul curierului nu s-a confirmat pentru N plicuri. NU retrimite.” | „Verifică la curier” după 10 minute |
| 429 | „Curierul a cerut o pauză; restul se trimite mai târziu” | „Trimite” din nou peste câteva minute (doar rândurile rămase `aprobat`) |
| `oprit` = limita de 5 solicitări pe apăsat | „S-au trimis 500; mai sunt N” | „Trimite” din nou |
| 423 `transport_real_doar_test` | „Transportul e permis doar pe proiecte de TEST (Testul 1)” | nimic (anunță proprietarul) |
| 503 `transport_neconfigurat` / `autentificare_fan_neconfirmata` | „Legătura cu curierul nu e configurată / nu răspunde; nimic trimis” | anunță proprietarul |
| 403 `non_operator` (cod nou) | „Doar operatorii numiți de proprietar pot trimite” | — |
| etichete 502 după AWB-uri generate | „AWB-urile există; etichetele nu s-au putut descărca acum” | „Retipărește etichetele” |

## 9. Urmărirea automată (D4)

### 9.1 Cine o pornește, cu ce identitate și de ce

- **Pornirea**: un job pg_cron **orar** `redari_fan_urmarire_tick` (`5 * * * *`, ca `postgres`) → `SELECT public.fn_red_fan_urmarire_tick()`.
  Funcția calculează ora României (`clock_timestamp() AT TIME ZONE 'Europe/Bucharest'`), și DOAR dacă ora e 8, 13 sau 18 și sloturile zilei
  nu au rulat (`red_fan_rulari`, UNIQUE `(zi_ro, slot)`, `INSERT … ON CONFLICT DO NOTHING RETURNING` = revendicare atomică, L04) → cheamă
  funcția edge cu `net.http_post` și antetul `x-intern-secret` citit din Vault (`REDARI_FAN_INTERN_SECRET`, generat în BD, valoarea nu iese
  niciodată — tiparul `20261011a`). De ce orar și nu trei intrări cron: pg_cron e în UTC, iar România schimbă ora de două ori pe an (L17);
  tick-ul orar cu decizia în ora României nu are nevoie de reprogramare. Dacă un slot e ratat (întrerupere), rulează la următorul tick al orei
  (nu se recuperează retroactiv mai mult de un slot: nu are rost).
- **Funcția edge nouă `redari-fan-urmarire`**: publicată în lista `NO_JWT` (nu are JWT de om); PRIMA verificare: antetul `x-intern-secret` prin
  `fn_verifica_secret('REDARI_FAN_INTERN_SECRET', antet)` cu clientul `service_role` — fail-closed (lipsă / greșit / eroare = 401, nimic
  altceva); apoi întrerupătorul `red_fan_setari.urmarire_auto_activa` (oprit → rularea `oprita`, return). Acțiunile de la ecran rămân în
  `redari-fan-awb` (JWT-ul omului): cele două funcții nu se amestecă.
- **Identitatea: `service_role`, cu justificare explicită.** Nu există un om: rularea pornește din cron. RLS-ul tabelelor FAN cere
  `fn_red_nivel()` admin / editor pe `auth.uid()`, iar RPC-urile de azi cer owner-ul — un cron nu are niciuna. Alternativa „un cont tehnic cu JWT”
  ar fi exact „contul comun cu drept de owner” pe care D2 îl interzice. De aceea: `service_role` **doar** în această funcție edge, folosit DOAR
  pentru (a) `fn_verifica_secret`, (b) citirile FAN de urmărit, (c) două RPC-uri noi cu EXECUTE **exclusiv** pentru `service_role`
  (`REVOKE … FROM PUBLIC, anon, authenticated`): `fn_red_fan_urmarire_auto(p_rulare, p_randuri)` și `fn_red_fan_bifeaza_auto(p_rulare, p_ids)`.
  Dreptul EXECUTE restrâns E poarta de rol („cale server cu rol verificat explicit”, L08); în corp funcțiile verifică și `auth.uid() IS NULL`
  (un JWT de om pe această cale = refuz) și existența rândului de rulare `in_curs` cu id-ul primit (o cheie pe rulare). Fără alte drepturi:
  nicio scriere directă pe tabele (service_role are doar SELECT pe tabelele FAN, ca azi), niciun apel către altă funcție.
- **Ce citește din afară**: răspunsurile curierului la `GET /reports/awb/tracking` și `GET /reports/awb/confirmations` — **date**, nu
  instrucțiuni: coduri pe listă albă (`EVENIMENTE_FAN`), AWB numeric, date cu formă fixă; textele curierului nu se stochează; forma necunoscută =
  „de verificat de om” (ca azi, `interpreteazaUrmarire`).
- **Ce scrie**: `red_fan_awb` (câmpurile de urmărire + confirmare, cu CAS pe `versiune_urmarire` — logica `fn_red_fan_urmarire` /
  `fn_red_fan_confirmari` neschimbată, mutată într-un corp intern comun celor două porți: om și cron, L19), `red_fan_rulari` (jurnalul
  rulării), `red_jurnal` (câte un rând pe bifare automată) și, DOAR pe loturi reale și DOAR pe codurile limpezi, `red_plicuri` (§9.2).

### 9.2 Tabelul cod → efect în registru

Faptele se derivă ca azi (`rezumatUrmarireFan`): C0 = ridicat, S2 = livrat, categoriile `retur` / `refuz` / `adresa` / `mutat` = retur semnalat,
`avizat` / `neutru` / `tranzit` / `inregistrat` = nimic pe fapte, `de_verificat` + necunoscut + S50 = de verificat. Bifarea automată pe plic
(`fn_red_fan_bifeaza_auto`) se face DOAR din faptele **necontrazise** ale rândului, după scrierea urmăririi, în aceeași rulare:

| Codul / situația (ultimul eveniment + faptele) | Efect pe `red_fan_awb` | Efect pe `red_plicuri` (DOAR lot real) | Jurnal |
|---|---|---|---|
| **C0** ridicat, o singură dată, dată validă, rândul `generat` | `ridicat_propus` = data C0; stare → `ridicat`, `ridicat_la` | `awb` + `data_expediere` = **data C0 în ora României** (trigger-ele existente: convocările → expediate, termenul de 10 zile) — exact ce face azi `fn_red_fan_ridicat` apăsat de owner | `red_jurnal`: `ridicare_auto`, cod C0, `ultim_eveniment_la`, `rulare_id`, `user_id NULL` |
| **S2** livrat, cu C0 cunoscut (sau bifat în aceeași rulare) | `livrat_la` = ora S2 | coloană nouă `curier_livrat_la timestamptz` + `curier_livrat_cod text` (fapt, nu AR); AR-ul (`data_ar`, `ar_scan_path`, `ar_primit_de`) se completează DOAR de arhivarea dovezii (§10.3) | `livrare_auto`, cod S2 |
| **S2 fără C0** (livrat, dar curierul n-a dat ridicarea) | stare `livrat`, `ridicat_propus` NULL | **nimic** (data expedierii nu se poate deriva); în „De verificat” cu motivul „livrat fără ridicare: data expedierii lipsește” | — |
| **S16 / S33 / S43** retur, **S6** refuz, **S4/S10/S19/S20/S25/S27/S28/S42** adresă, **S5** mutat (ca ultim semnal), `returnAwbNumber` | `retur_cunoscut`, `retur_propus` = motivul din categorie (`refuz` / `adresa_incompleta` / `mutat` / `avizat_neridicat`) | coloane noi `curier_retur_semnalat_la timestamptz`, `curier_retur_motiv text` (aceleași coduri ca `red_plicuri.retur`), **fără** `retur` / `retur_data` / `retur_scan_path` (cer scanul plicului întors, CHECK `red_plicuri_retur_complet`; §9.4) | `retur_semnalat_auto`, codul |
| retur după **livrat** (ambele fapte) | contradicție (CHECK `red_fan_awb_fapte`) → `de_verificat` | nimic | — |
| **S3 / S11 / S21 / S22 / S24** avizat, **S30 / S12** contact, **tranzit** (C1, H*, S1, S35), **S98** înregistrat | doar `ultim_eveniment` / stare afișată | nimic | — |
| **S50** confirmare refuzată | `de_verificat` (judecată umană, ca azi) | nimic | — |
| **S7, S8, S9, S14, S15, S37, S38, S46, S47, S49, S54, S55, S56, S64, S65, S67, S69, S99** și orice cod necunoscut ca ultim eveniment | `de_verificat` | nimic | — |
| a doua dată de C0 diferită / altă oră S2 / alt motiv de retur | faptul cunoscut rămâne, valoarea nouă în `*_contrazis`, `de_verificat` (ca azi); **plicul nu se atinge** (data expedierii e imuabilă prin trigger-ul plicului odată scrisă) | nimic | — |
| dată **în viitor** (peste ora curentă RO + 60 min) sau **înainte de `generat_la`**, sau formă necunoscută | `de_verificat`, motiv „dată imposibilă” | nimic | — |
| C0 pe un rând al cărui plic nu mai e activ / are deja expediere manuală | `ridicat_propus` scris, dar plicul **nu**; „De verificat” cu motivul (ca refuzul de azi din `fn_red_fan_ridicat`) | nimic | — |
| răspuns fără evenimente / AWB absent / listă de formă necunoscută | ca azi: „păstrat” / `de_verificat`; nimic pe plic | nimic | — |

- **Corecții ulterioare ale curierului**: faptul bifat rămâne; contradicția se vede și o soluționează owner-ul / un admin
  (`fn_red_fan_urmarire_solutioneaza`, existent). Dacă soluționarea alege „nou” pentru ridicare pe un plic deja expediat, **plicul nu se schimbă
  automat** (trigger-ul `red_plicuri` refuză schimbarea `data_expediere`); ecranul spune „data expedierii de pe plic rămâne X; corectarea pe plic
  e o operație separată a proprietarului” (§15.3, juridic: care dată contează).
- **Loturi de TEST**: urmărirea scrie evidența FAN (inclusiv `ridicat`), niciodată plicul — ca azi.
- Bifarea e **o singură definiție** (L19): `fn_red_fan_ridicat` (om) și `fn_red_fan_bifeaza_auto` (cron) cheamă același corp intern, cu autorul
  diferit (`auth.uid()` vs `NULL` + `rulare_id`).

### 9.3 Limite de apeluri, pauze, oprire la erori, întrerupător, jurnal

- Limita curierului pe minut e **necunoscută** (întrebare trimisă 15.11.2026, fără răspuns): bucăți de ≤ 100 (limita documentată), **pauză
  2 s**, cel mult **30 de solicitări pe rulare** la urmărire + 30 la confirmări (= 3.000 de AWB-uri pe rulare, 9.000 pe zi — peste primul val);
  rândurile neatinse (cursor pe `urmarit_la ASC, id`) vin în slotul următor. **Oprire la primul 429 / 5xx / timeout / formă necunoscută a
  listei**: rularea se închide `oprita_eroare` cu codul, fără reîncercare în aceeași rulare (L05); următorul slot reia.
- Ce se urmărește: rândurile `generat` / `ridicat` cu AWB, pe loturi marcate, **fără** AWB-urile încheiate (livrat cu dovada arhivată; retur
  definitiv înregistrat pe plic; anulat) și **fără** AWB-urile mai vechi de 60 de zile de la generare (plafon; peste el → „De verificat: AWB
  vechi neîncheiat”, o singură dată).
- **Întrerupătorul**: `red_fan_setari.urmarire_auto_activa` (owner, din ecran; implicit `false`; schimbarea în `red_jurnal`); în plus, chat-ul
  poate opri jobul cron (`cron.unschedule`) și poate șterge secretul din Vault (funcția refuză 401). Nicio rulare nu pornește cât e `false`.
  O rulare deja pornită se termină (cel mult ~2 minute); oprirea nu e instantanee (ca la generare, `FAN_TEST1_PASI.md` §13).
- **Jurnalul**: `red_fan_rulari (id uuid, zi_ro date, slot smallint CHECK IN (8,13,18), pornita_la, incheiata_la, stare CHECK IN
  ('in_curs','incheiata','oprita','oprita_eroare'), solicitari int, randuri int, scrise int, pastrate int, depasite int, bifari_expediat int,
  bifari_livrat int, bifari_retur int, de_verificat int, eroare_cod text, UNIQUE (zi_ro, slot))`; RLS SELECT admin / editor; scris doar de
  funcțiile cronului. Ecranul: „Ultima urmărire: 19.11.2026 13:02 — 212 AWB-uri, 3 bifări expediat, 1 de verificat”. Fiecare bifare = rând în
  `red_jurnal` (tabela `red_plicuri` / `red_fan_awb`, `date_noi` cu `eveniment`, `cod`, `eveniment_la`, `rulare_id`; fără date personale).

### 9.4 Fișa de securitate a–e (CLAUDE.md pct. 7) și regula tare

- **(a) Conținut extern**: răspunsurile curierului la urmărire și confirmări. Date, nu instrucțiuni: listă albă de coduri, AWB numeric, date cu
  formă fixă, listele acceptate doar în formele cunoscute; textele curierului nu se păstrează și nu se afișează; forma necunoscută = de verificat.
- **(b) Ce scrie / face**: `red_fan_awb` (urmărire, CAS), `red_fan_rulari`, `red_jurnal`, și pe loturi REALE `red_plicuri.awb + data_expediere`
  (efect juridic: termenul de 10 zile), `curier_livrat_*`, `curier_retur_*`. **Nu** cheltuie bani (apelurile de urmărire sunt gratuite), nu
  trimite mail / SMS, nu atinge drepturi, nu șterge, nu scrie AR-ul fără dovadă arhivată, nu scrie returul definitiv.
- **(c) Identitate**: `service_role` în funcția edge `redari-fan-urmarire` — justificat la §9.1 (fără om; RLS pe nivel de om; D2 interzice
  contul tehnic cu owner). Perimetru minim: `fn_verifica_secret`, SELECT pe tabelele FAN + plicurile legate, cele două RPC-uri cu EXECUTE
  exclusiv `service_role`. Secretele curierului: aceleași trei (Edge Secrets), citite după poarta secretului intern și după întrerupător.
- **(d) Cine pornește**: DOAR pg_cron (`postgres`) cu `x-intern-secret` din Vault; `verify_jwt` nu e folosit (funcția e în `NO_JWT`) și NU ar fi
  suficient oricum (cheia anon e un JWT valid); un apel fără / cu alt secret = 401, nimic citit, nimic chemat la curier. Testele negative: fără
  antet, antet greșit, antet `_VECHI`, JWT de owner fără antet → 401.
- **(e) Confirmare umană**: tot ce nu e în lista albă a bifărilor: coduri nelimpezi, contradicții, livrat fără ridicat, AR fără dovadă, retur
  definitiv, AWB-uri vechi, corectarea datei de pe plic, anularea. Pornirea automatizării cere „da”-ul proprietarului (întrerupătorul) și, pe
  loturi reale, „da”-ul juridic (§12).
- **Regula tare (a)+(b)**: citește conținut extern ȘI scrie → **poarta** = (1) cine pornește: cron + secret în Vault (nimeni din afară nu poate
  declanșa o rulare, iar conținutul extern nu poate porni nimic — curierul răspunde doar la întrebările noastre); (2) ce poate scrie: o listă
  ÎNCHISĂ de tranziții, înainte-numai (neexpediat → expediat la C0; + livrat; + retur semnalat), fiecare derivată dintr-un cod pe listă albă, cu
  CAS pe versiune și fără suprascrierea unui fapt (contradicția → om); (3) niciun ban, niciun mesaj, niciun drept, nicio ștergere. **De ce
  bifarea pe coduri limpezi e acceptabilă fără om**: efectul e consemnarea unui fapt raportat de curier (ridicarea), exact cel pe care azi
  owner-ul îl confirmă rând cu rând fără altă informație decât același cod — confirmarea umană nu adaugă cunoaștere, doar întârziere; faptul
  rămâne verificabil (codul + ora curierului + rularea în jurnal) și corectabil de om (soluționare); iar efectul juridic (termenul curge de la
  ridicare) e același pe care îl cere D4 și pe care juridicul trebuie să-l confirme o dată, pentru regulă, nu pentru fiecare plic. Rămân la
  om, explicit: AR-ul (dovada) și returul definitiv (plicul fizic), pentru că acolo codul singur NU e dovada cerută de procedură (§15.3).
- La activare (F2): rând în `public.automatizari` (tip `edge_function` + `cron_bd`, `referinta` = `redari_fan_urmarire_tick` / `redari-fan-urmarire`,
  `secrete_nume` = `REDARI_FAN_INTERN_SECRET (Vault)`, `FAN_SELFAWB_USERNAME / FAN_SELFAWB_PASSWORD / FAN_CLIENT_ID (Edge Secrets)`) + secțiunea din
  `registru_automatizari` — de chat, în aceeași sesiune cu aplicarea.

## 10. Arhiva (D5)

### 10.1 Unde și cum

Bucket-ul privat `redari`, în dosarul plicului (aceeași rădăcină ca opisul și scanurile: `plicuri/<plic_id>/`), nume fără date personale:

| Fișier | Calea | Cine îl scrie, când |
|---|---|---|
| eticheta AWB-ului (PDF, un AWB) | `plicuri/<plic_id>/awb_<awb>_eticheta_T<tiraj>.pdf` | rularea automată (§9) la prima rulare după generare, `GET /awb/label?awbs[]=<un AWB>` (un apel pe AWB, cu pauză; nu se poate tăia PDF-ul lotului fără librărie nouă) — **pe loturile reale și de TEST** |
| etichetele lotului, pe părți (PDF, ≤ 100 AWB-uri) | `loturi/<lot_id>/tiraj_<ID>_etichete_parteNN.pdf` | funcția edge `trimite`, imediat, cu JWT-ul operatorului (politica `red_storage_ins`, admin / editor): rezerva dacă curierul nu mai întoarce eticheta pe AWB mai târziu |
| dovada de livrare | `plicuri/<plic_id>/awb_<awb>_dovada_livrare_<AAAALLZZ>.<ext>` (+ `.json` cu câmpurile primite) | rularea automată, la prima confirmare pentru AWB (forma: §10.3) |
| pagina de control | există în arhiva ZIP; opțional `loturi/<lot_id>/tiraj_<ID>_pagina_de_control.docx` | funcția edge `trimite` (același moment ca etichetele lotului) |

- Pe `red_fan_awb`: `eticheta_path`, `eticheta_sha256`, `eticheta_la`, `dovada_path`, `dovada_sha256`, `dovada_forma CHECK IN
  ('imagine','pdf','json_text','lipsa')`, `dovada_la`; scrise DOAR de RPC-ul cronului, după ce obiectul există în Storage (verificat ca la
  `opis_path`: `storage.objects` + eTag; fișier imutabil = o versiune nouă = altă cale). Pe un rând **anulat** nu se arhivează nimic.
- **Politici**: scrierea din cron se face cu `service_role` (sare peste RLS pe `storage.objects` — justificat de §9.1, perimetru: doar căile
  `plicuri/<plic_id>/awb_*` și `loturi/<lot_id>/tiraj_*`, verificate în RPC-ul care înregistrează calea); citirea rămâne admin / editor
  (`red_storage_sel`); fără UPDATE / DELETE pentru nimeni (ca azi).
- **Arhiva ZIP a lotului** („Documente lot”, `plicuri.js::planPachetPlicuire`): pe fiecare plic, după opis (`000`) și convocări (`001…`), vin
  `PPPP_<nr_plic>_900_awb_eticheta_T<ID>.pdf` și `PPPP_<nr_plic>_901_awb_dovada_livrare.<ext>` când există — sortarea rămâne ordinea de tipărire;
  pagina de control primește o coloană „etichetă arhivată / dovadă arhivată” (da / nu). Fișierele lipsă NU opresc arhiva (sunt informative, nu
  exemplare de la dosar), dar sunt numite.

### 10.2 Dacă curierul nu mai întoarce eticheta

Eticheta pe AWB se cere în prima rulare după generare; dacă 502 / formă non-PDF / 404, se reîncearcă la următoarele două rulări, apoi rândul
primește `eticheta_forma = 'lipsa'` și rămâne PDF-ul lotului (`loturi/…`) ca dovadă a ce s-a tipărit, cu poziția din pagina de control. Nimic
nu se cere la curier în bucle.

### 10.3 Dovada de livrare: forma e NECUNOSCUTĂ (se află la prima livrare reală)

Codul acceptă azi un element pe AWB în `GET /reports/awb/confirmations` → „primită, de verificat”. Variantele și ce am arhiva:

| Varianta | Ce arhivăm | AR automat? |
|---|---|---|
| (a) element cu URL (semnat) către imaginea confirmării | imaginea descărcată (`.jpg` / `.png` / `.pdf`), `sha256`, + `.json` cu câmpurile (nume primitor, data) | **da**, dacă numele primitorului = destinatarul plicului (normalizat: majuscule, fără diacritice, ordinea cuvintelor liberă) → `data_ar` = data confirmării, `ar_scan_path` = imaginea, `ar_primit_de = 'destinatar'`; altfel „livrat · dovada arhivată · AR de înregistrat” (omul alege `alta_persoana` + mențiunea) |
| (b) element cu imaginea inline (base64) | la fel ca (a) | la fel |
| (c) element doar cu text (nume, dată, fără imagine) | `.json` cu câmpurile; `dovada_forma = 'json_text'` | **nu** (CHECK-ul `red_plicuri_ar_scan` cere scanul; procedura cere confirmarea semnată) → „livrat · dovada doar text · AR de înregistrat” |
| (d) nimic la API; cartonașul oPOD vine fizic | nimic automat; omul scanează cartonașul ca azi | nu |

Decizia între (a)/(b) automat și „întotdeauna omul” e §15.1 Q5 (bifări cu efect juridic) și §15.3 (juridic). **Date personale**: imaginea
confirmării poartă numele și semnătura primitorului; stă în bucket-ul privat, lângă scanurile AR de azi, cu aceleași drepturi (admin / editor);
păstrarea = cât dosarul proiectului (durata o spune juridicul, §15.3); nimic nu se șterge automat; numele din `.json` nu intră în `red_jurnal`.

## 11. Comanda curierului (D6)

**Ce se știe** (observat în aplicația web a curierului la Testul 1 și în documentație): formularul „Cheamă curier” cere numele expeditorului,
persoana de contact (≤ 25), telefon, e-mail, județ / localitate / stradă / număr / cod poștal (precompletate din punctul de lucru al contului),
tipul comenzii (Standard), data preluării, intervalul (început / sfârșit, din 15 în 15 minute, sfârșitul la cel puțin o oră după început în
formular; documentația API spune interval ≥ 2 ore), nr. plicuri / colete, greutate, observații (afișate tăiate la 50 de caractere în listă).
Reguli: **o comandă pe punct de lucru pe zi**; orele disponibile depind de localitate și de zi (în afara Bucureștiului L–V 09–17, S 09–14);
anularea `DELETE /order?clientId=&id=`. **Punctul de ridicare = punctul de lucru al contului** (D6): la Testul 1 eticheta a arătat ca expeditor
punctul de lucru al contului de TEST, nu sediul — pe contul real trebuie verificat că `FAN_CLIENT_ID` e punctul de unde pleacă plicurile.

**Ce NU se știe despre `POST /order`** (întrebări pentru curier, §15.2): câmpurile corpului (clientId e destul? adresa separată? interval în ce
format? greutatea?), forma răspunsului (id-ul comenzii, starea), ce întoarce la a doua comandă în aceeași zi (eroare / înlocuire), dacă se
leagă de AWB-uri sau doar de punct, dacă există citirea comenzilor zilei (reconciliere), fusul orar.

**Propunerea (felia F5, după răspunsuri)**: buton **„Cheamă curierul azi”** (operator sau owner), activ doar dacă pe punctul de lucru există
AWB-uri generate neridicate și nu există comandă vie azi; ecranul propune intervalul implicit (ora curentă rotunjită la sfert + 2 h → sfârșitul
programului localității; configurabil pe proiect) și contactul implicit al proiectului; confirmare cu ziua, intervalul, punctul, numărul de
plicuri; după răspuns: „Comanda nr. … pentru azi, 14:00–16:30” + „Anulează comanda” (doar înainte de început, cu motiv). Gărzi: tabel
`red_fan_comenzi (id, punct_client_id text, zi_ro, interval_start, interval_sfarsit, plicuri int, contact_nume, contact_telefon, fan_id, stare
CHECK IN ('in_curs','plasata','necunoscuta','anulata','refuzata'), cerut_de, cerut_la, motiv_anulare)` cu UNIQUE parțial `(punct_client_id, zi_ro)
WHERE stare IN ('in_curs','plasata','necunoscuta')` (L16) + claim atomic ÎNAINTE de apel (L04 / L22), timeout / 5xx = `necunoscuta` fără retry
(L05; reconciliere cu lista comenzilor dacă apelul există), intervalul calculat în ora României (L17), refuz local înainte de apel pe reguli
(interval, program). **Contactul implicit pe proiect** (D6): tabel nou `red_fan_proiect_setari (proiect_id PRIMARY KEY, contact_nume ≤ 50,
contact_telefon, interval_implicit_start time, interval_implicit_sfarsit time, observatii_sablon ≤ 200)` scris prin RPC (owner / admin Redări),
nu coloane noi pe `red_proiecte` (`contact_nume` / `contact_telefon` de acolo sunt contactul de pe convocator, alt rol). Datele personale ale
colegului de contact: nume + telefon de serviciu, vizibile admin / editor.

**Până la răspuns rămâne manual**, dar ecranul ajută: „Pregătește comanda” arată textul de copiat (numărul de plicuri, AWB-urile, contactul,
intervalul propus) și linkul spre contul curierului; comanda se consemnează în ecran („comandă dată manual azi, 14:00–16:30, de <operator>”) ca
să nu se dea de două ori (același tabel, `stare = 'manuala'`).

## 12. De la forma de test la proiectul real

### 12.1 Ce gărzi cad și în ce ordine

1. Azi: `TRANSPORT_REAL_ACTIV = true`, **`DOAR_PROIECTE_TEST = true`** (lot pe proiect `TEST-` + marcat TEST; restul 423). F1 și F2 se livrează
   și se probează **cu garda pornită** (nimic pe proiecte reale).
2. **„Da”-urile** (§12.2) — fără ele garda nu cade.
3. PR separat, revizuit: `DOAR_PROIECTE_TEST = false`. Rămân: marcajul automat real / TEST, plafonul zilei (mic la început: 20), plafonul pe
   lot (20 până după Testul 2), lista operatorilor, aprobarea pe hash (recalculat la generare), claim-ul atomic.
4. Testul 2 (`FANCOURIER_INTEGRARE.md` §11) pe un lot real de 10–20 de plicuri, cu butonul unic, de un operator numit (nu de owner), cu
   urmărirea automată pornită doar după ce ridicarea reală a fost văzută o dată și comparată cu contul curierului.
5. Abia apoi plafoanele cresc (din ecran, owner).

### 12.2 „Da”-urile necesare

- **Juridic**: (1) expedierea convocărilor prin curier cu oPOD = „scrisoare recomandată cu confirmare de primire” (deschisă de la 09.11.2026);
  (2) **data ridicării din sistemul curierului (C0) = data expedierii** pentru termenul de 10 zile, înregistrată automat; (3) AR-ul din dovada
  electronică a curierului (imagine) vs cartonașul oPOD fizic; (4) returul: codul curierului vs plicul fizic întors cu mențiune.
- **Proprietar**: răspunsurile din §15.1; „da” la pornirea urmăririi automate pe loturi reale; lista operatorilor; plafonul inițial.
- **Curier**: contul real pe API, punctul de lucru corect, A6, limita pe minut, forma dovezii.

### 12.3 Cum se probează înainte, pe `TEST-RAZVAN`, cu contul de operator fără owner

Fiecare felie se probează cu contul `redari@` (editor Redări, fără owner), după un document de pași în stilul `FAN_TEST1_PASI.md` (coloana
„Acțiune” stabilă, simulatorul procedurii extins): (1) fără rând în lista operatorilor → butonul dezactivat + 403 / 42501 la apel direct; (2)
owner-ul îl numește (jurnal); (3) lot de TEST cu 3 plicuri (unul cu localitate inexistentă, ca la Testul 1) → un apăsat → „2 AWB-uri generate,
1 respins: adresa”, etichete + pagina de control, tarif; (4) plafonul zilei pus pe 1 de owner → al doilea lot → „așteaptă aprobarea” → owner
aprobă → operatorul trimite; (5) dublu-click și două taburi (cheia intenției; al doilea primește replay / „în curs”); (6) întreruperea simulată
(secretele șterse între aprobare și generare → 503; rândurile `aprobat` rămân; repunere → trimiterea reia fără a renumăra); (7) comanda
curierului manual; (8) urmărirea automată pornită de owner → la 13:00 rularea bifează `ridicat` în evidență, **nu** pe plic (lot de TEST), jurnalul
rulării; (9) arhiva: eticheta pe plic + ZIP-ul lotului. Toate cu garda de rețea a probelor (scrieri doar pe entitatea de test) și cu
inventarul de închidere (AWB-uri anulate înainte de ridicare dacă nu se vrea transport).

## 13. Feliile livrabile (în ordinea recomandată)

Reguli comune ale fiecărei migrări (CLAUDE.md pct. 4, lecțiile D): forma livrării L15 v2 (garda legată de nume + tranzacție, plafon, amprentă
globală, allow-list-ul complet din 31d înainte și după, bugetul de lock, ordinea fixă a lock-urilor la aplicare), tabele noi cu RLS + GRANT
explicit (`REVOKE ALL`, apoi doar ce trebuie; politici cu `auth.uid() IS NOT NULL`), funcții `SECURITY DEFINER SET search_path = public,
pg_temp` cu `REVOKE EXECUTE FROM PUBLIC, anon` și EXECUTE doar rolului care le cheamă, postcondiții pe fiecare drept în parte (nu
`has_table_privilege` cu listă), revenire în `supabase/revenire/` care refuză cu date (LOCK NOWAIT înainte de verificarea „fără date”), probe
PGlite + două sesiuni pe clonă (de chat). Numărul migrării se alege după `git ls-tree` pe toate branch-urile (ciocniri).

### F1 — Operatorii numiți + butonul unic „Trimite la curier” (garda „doar TEST” rămâne)
- **Conține**: `red_fan_operatori`, `fn_red_fan_operator_seteaza`, `fn_red_fan_e_operator`; `red_fan_setari.limita_zi` (+ cele două întrerupătoare,
  inerte până la F2/F3), `red_fan_zi`, `red_fan_cereri_aprobare`, starea `de_aprobat`, coloanele `cerere_aprobare_id` / `aprobare_owner_la` pe
  `red_fan_awb`; `red_fan_intentii`, `fn_red_fan_comanda`, `fn_red_fan_intentie_incheie`, `fn_red_fan_cerere_decide`; poarta „operator sau owner”
  pe `fn_red_fan_propune` (corpul devine intern), `fn_red_fan_aproba` (rămâne pentru calea detaliată a owner-ului), `fn_red_fan_claim_lot`,
  `fn_red_fan_rezultate`, `fn_red_fan_tiraj` (începere / confirmare), `fn_red_fan_urmarire`, `fn_red_fan_confirmari`, `fn_red_fan_ridicat`,
  `fn_red_fan_reconciliaza` (doar cu `p_awb`; absența rămâne owner), `fn_red_fan_anulat` (după Q3). Edge: acțiunea `trimite` + `deps.operator()`;
  codul `non_operator`. UI: ecranul operatorului (§1), caseta „Cereri de aprobare” (owner), „Operatori curier” (owner), pașii vechi strânși.
  Toate cu `DOAR_PROIECTE_TEST = true`.
- **Migrare descrisă** (`2026121Xa_redari_fan_operator`): tabelele de mai sus cu CHECK-uri (§7, §8.3), index unic `red_fan_zi (zi_ro)`,
  parțial pe cererile deschise pe lot (`(lot_id) WHERE stare = 'deschisa'`), RLS SELECT admin / editor pe toate, fără scriere directă; funcțiile
  noi + `CREATE OR REPLACE` pe cele cu poarta schimbată (amprenta md5 a corpului vechi verificată ÎNAINTE, ca la `fn_red_corespondenta_reguli`
  în 20261130e); ordinea lock-urilor scrisă în fiecare funcție (lot → plicuri → rânduri FAN → `red_fan_loturi` → setări → `red_fan_zi` →
  cereri → intenții → jurnal); jurnal pe operatori / setări / cereri; postcondiții (numărul funcțiilor `fn_red_fan_*`, EXECUTE exact, RLS,
  CHECK-ul stărilor). Revenire: refuză cu operatori numiți, cereri, intenții sau rânduri `de_aprobat`; readuce textual corpurile vechi.
- **Probe**: vitest (handler: 403 `non_operator`, ordinea porților neschimbată; `fn` pure: mesajele §8.5, registrul local al intenției —
  „scris și verificat înainte de apel”, „iese doar la rezultat dovedit”; simulatorul procedurii operatorului), PGlite (plafonul zilei pe
  muchie, replay-ul intenției, `RD030`, cererea aprobată nu consumă plafonul, revenirea), două sesiuni pe clonă (doi operatori pe același
  plafon: unul trece, celălalt `de_aprobat`; două intenții pe același lot), proba live §12.3 pașii 1–7.
- **Risc**: bani — ținut de garda „doar TEST”, plafonul zilei (implicit 20, în Testul 1: 1 / 3), plafonul pe lot, aprobarea pe hash și claim-ul
  atomic. Risc de drept: un editor numit greșit — lista e owner-only, cu jurnal; nivelul rămâne precondiție.

### F2 — Urmărirea automată
- **Conține**: `red_fan_rulari`, `fn_red_fan_urmarire_tick` (postgres / pg_cron), secretul Vault `REDARI_FAN_INTERN_SECRET` (generat în BD),
  `fn_red_fan_urmarire_auto`, `fn_red_fan_bifeaza_auto` (EXECUTE doar `service_role`; corp comun cu `fn_red_fan_urmarire` / `fn_red_fan_ridicat`),
  coloanele `red_plicuri.curier_livrat_la / curier_livrat_cod / curier_retur_semnalat_la / curier_retur_motiv` (+ CHECK: motivul în lista de
  retur; trigger-ul plicului lasă aceste coloane scrise DOAR de funcția internă — proveniență, L08), jobul cron (`cron.schedule`, idempotent pe
  nume), funcția edge `redari-fan-urmarire` (în `NO_JWT`), întrerupătorul activ din ecran (owner), lista „De verificat” și „Ultima urmărire” în
  ecran, rândul `automatizari` + registrul (chat).
- **Migrare descrisă** (`…b_redari_fan_urmarire_auto`): precondiții fail-closed ca în 20261011a (`fn_verifica_secret` pinuită, extensiile
  `pg_cron` / `pg_net` / Vault prezente, secretul inexistent și fără `_VECHI`), tabelul rulărilor, coloanele pe plic (ALTER cu lock SHARE ROW
  EXCLUSIVE pe `red_plicuri` în setul fix), funcțiile, trigger-ul plicului extins (amprenta corpului vechi verificată), jobul cron; postcondiții:
  EXECUTE exact (nimic pentru `authenticated` pe cele două funcții auto), jobul exact (nume, program, utilizator, activ), secretul o dată.
  Revenire: `cron.unschedule`, funcțiile, coloanele doar dacă sunt goale, secretul șters; refuză cu rulări sau bifări în jurnal.
- **Probe**: vitest pe handler-ul cronului (401 fără secret / secret greșit / JWT fără secret; întrerupătorul oprit = nimic chemat; oprirea la
  429; tabelul §9.2 ca tabel de cazuri cu paritate SQL ↔ JS, L19), PGlite (bifarea pe lot real vs TEST; CAS; contradicția nu atinge plicul; data
  în viitor; revendicarea slotului o singură dată), pe clonă două sesiuni (rulare + soluționare concurentă, ca C1 / C2), live pe `TEST-RAZVAN`
  (§12.3 pasul 8) cu un AWB ridicat real de curier pe un lot de TEST.
- **Risc**: `service_role` (perimetru minim, poarta pe secret, EXECUTE exclusiv); scriere cu efect juridic pe loturi reale — inertă până la F4
  și la „da”-ul juridic; întrerupătorul implicit oprit.

### F3 — Arhiva (etichete pe plic, PDF-ul lotului, dovada de livrare, AR automat doar cu dovadă)
- **Conține**: coloanele `eticheta_* / dovada_*` pe `red_fan_awb`, RPC `fn_red_fan_arhiva_scrie` (EXECUTE `service_role`, verifică obiectul în
  Storage + eTag, calea pe listă albă), pasul de arhivare în rularea automată (după urmărire; max 30 de apeluri de etichetă pe rulare), scrierea
  PDF-ului lotului din `trimite` (JWT-ul operatorului), AR-ul automat (varianta (a)/(b), după Q5 și juridic), ZIP-ul lotului cu fișierele noi,
  coloana paginii de control, `arhivare_auto_activa`.
- **Migrare descrisă** (`…c_redari_fan_arhiva`): coloane + CHECK-uri (path pe forma `^plicuri/<uuid>/awb_[0-9]{6,20}_…$`, sha256 hex, forma),
  funcția, politica Storage nouă NU e necesară (service_role + politicile existente admin / editor); postcondiții pe verificatorul politicilor
  storage (`fn_red_storage_verifica_redari`, existent) — nimic nou expus.
- **Probe**: vitest (numele fișierelor, planul ZIP cu `900` / `901`, variantele dovezii (a)–(d) ca tabel de cazuri, potrivirea numelui
  normalizat), PGlite (RPC-ul refuză o cale în afara listei / un obiect lipsă), live (eticheta apare în dosarul plicului de test și în ZIP).
- **Risc**: PII în Storage (același bucket, aceleași drepturi ca scanurile de azi); apeluri în plus la curier (limitate, cu pauză).

### F4 — Trecerea la proiectul real
- PR fără migrare: `DOAR_PROIECTE_TEST = false`, testele mutate, procedura Testului 2 cu butonul unic (document de pași + simulator), rândurile
  `automatizari` / registrul la zi (chat), plafoanele recitite din BD. Cere §12.2. Risc: cel real — ținut de plafonul zilei mic, de lista
  operatorilor și de urmărirea cu întrerupător.

### F5 — Comanda curierului din platformă (după răspunsurile curierului)
- `red_fan_comenzi`, `red_fan_proiect_setari`, `fn_red_fan_comanda_curier_claim / _rezultat / _anuleaza`, acțiunile `comanda_curier` /
  `anuleaza_comanda` în funcția edge, ecranul §11; până atunci „Pregătește comanda” + consemnarea manuală (`stare = 'manuala'`), care poate
  intra deja în F1 ca UI fără apel.

### F6 — Eticheta A6
- Depinde de răspunsul curierului (§15.2): poate fi doar o setare a contului (zero cod) sau un parametru (o constantă + un test).

## 14. Lecțiile L01–L25: cum le respectă implementarea descrisă

- **L01** lock înainte de verificare: `fn_red_fan_comanda` ia lotul, plicurile, rândurile, setările (un rând = serializarea plafonului) și abia
  apoi verifică; `red_fan_zi` cu `ON CONFLICT … WHERE` atomic; revendicarea slotului cron prin `INSERT … ON CONFLICT DO NOTHING RETURNING`.
- **L02** atomic: propunere + aprobare + plafon + cerere + intenție într-UN RPC; rezultatele unei solicitări într-un RPC (existent); bifarea pe
  plic + evidența FAN + jurnalul într-o tranzacție; Storage scris înainte, înregistrarea căii doar după verificarea obiectului.
- **L03** rezultat vechi: CAS pe `versiune_urmarire` (existent) și la cron; tirajul (existent); intenția încheiată cu CAS pe `in_curs`.
- **L04** idempotență: cheia intenției UUID + hash-ul cererii (`UNIQUE`, aceeași cheie + alt hash = eroare); cheia solicitării (existent); o
  rulare = un rând unic `(zi_ro, slot)`.
- **L05** ambiguu = necunoscut: fără retry la `necunoscut` / `in_curs`, butonul blocat până la reconciliere, registrul local nu iese la 5xx /
  42501, replay-ul intenției întoarce rezultatul memorat, cronul se oprește la primul 429 / 5xx.
- **L06** deadlock: ordinea scrisă în fiecare RPC (lot → plicuri → rânduri FAN → `red_fan_loturi` → setări → `red_fan_zi` → cereri → intenții →
  jurnal); cronul: rânduri FAN `ORDER BY id` → plic → jurnal, fără lock pe lot (nu schimbă marcaj / tiraj).
- **L07** toate căile: `de_aprobat` și contorul zilei impuse în RPC (fără GRANT de scriere); coloanele `curier_*` pe plic scrise doar de
  funcția internă (trigger BEFORE pe OLD / NEW); operatorii doar prin RPC.
- **L08** identitate: `auth.uid()` peste tot; funcția edge nu primește rolul; calea cron = EXECUTE exclusiv `service_role` + `auth.uid() IS NULL`
  + secret în Vault (rol verificat explicit, nu claims); autorii puși de server.
- **L09** entitatea țintă: lotul citit cu JWT-ul omului (RLS); fiecare plic verificat pe lotul lui; căile Storage pe listă albă legate de plicul
  rândului.
- **L10** secrete: secret propriu pentru poarta cronului (fără fallback, fără `_VECHI` în afara rotației), secretele curierului neschimbate,
  nimic în loguri / răspunsuri.
- **L12 / L13**: forma necunoscută = „de verificat”, nimic nu dispare (rândurile „depășite” / „păstrate” numărate); listele de coduri pe listă
  albă, regex-urile ancorate (existente).
- **L14 / L15**: migrări în forma L15 v2, cu preflight pe date, postcondiții, revenire testată apply → rollback → re-apply; allow-list-ul din 31d.
- **L16** unicitate: `red_fan_zi (zi_ro)`, `red_fan_rulari (zi_ro, slot)`, `red_fan_intentii (cheie)`, cererile deschise pe lot, comenzile vii pe
  punct / zi; hash-ul cererii pe lista canonică.
- **L17** timp: ziua și orele în `Europe/Bucharest` (contorul zilei, sloturile, data expedierii = data C0 locală); tick orar în loc de cron fix
  (ora de vară).
- **L18** fail-open: eroare ≠ gol (RPC eșuat = mesaj, nu „nimic de trimis”); „azi mai poți trimite N” doar din citire reușită; necunoscut ≠ 0;
  tarif gol = „necunoscut”.
- **L19** o definiție: `fn_red_fan_e_operator` (RPC + edge + ecran), corpul comun al urmăririi / bifării (om + cron), mesajele §8.5 în `fanLot.js`,
  tabelul cod → efect ca tabel de cazuri cu paritate JS ↔ SQL.
- **L20** garda nouă testată și pe căile legitime: owner-ul fără rând de operator trece; cererea aprobată se trimite; retragerea unui operator cu
  intenție `in_curs` nu rupe încheierea (owner-ul o poate încheia); întrerupătorul oprește doar rulările noi; refuzul local (plafon) raportat
  distinct de eșecul extern.
- **L21 / L22**: nu e AI; pasul durabil înaintea apelului plătit (existent) + aprobarea / plafonul înaintea rezervării.
- **L23** paginare: citirile cronului cu keyset (`urmarit_la, id`), id-uri în bucăți de 100 (`citesteToate`, existent).
- **L24** async: generația + lotul la fiecare acțiune (existent); descărcările multiple după `await` reverifică generația; registrul local pe
  cheie.
- **L25** teste reale: așteptările din documentele curierului și din acest document, nu din codul testat; RLS / EXECUTE ca `authenticated` /
  `service_role` non-owner pe PGlite și pe clonă; două sesiuni reale cu barieră.

## 15. Întrebările deschise

### 15.1 Către proprietar (maximum 6; recomandarea e marcată)

**Q1. Unitatea plafonului.** A) **AWB-uri pe zi (ora României), pe tot modulul**, cu plafonul pe lot păstrat ca a doua frână — *recomandat*;
B) doar pe lot (azi); C) pe săptămână. Valoarea inițială propusă: 20 pe zi până după Testul 2, apoi cât îți convine (ex. 200).

**Q2. Când o trimitere nu încape în plafon.** A) **tot clickul așteaptă aprobarea ta**, iar ecranul îi spune operatorului dinainte cât mai
încape, ca să poată alege mai puține plicuri — *recomandat* (lotul se tipărește întreg, o singură dată); B) se trimit câte încap, restul
așteaptă (două tiraje pe același lot); C) refuz sec, fără cerere.

**Q3. Ce poate face operatorul în afara butonului.** A) nimic (tot restul owner); B) **operatorul poate anula un AWB neridicat (nu costă) și
poate confirma „găsit” la reconciliere; confirmarea că un AWB NU există (deschide drumul unui al doilea AWB) și „Tiraj nou” rămân la tine** —
*recomandat*; C) operatorul poate și confirma absența.

**Q4. Lista operatorilor.** A) **o listă pe modul (globală), administrată de tine, cu jurnal** — *recomandat*; B) câte o listă pe proiect;
C) orice editor Redări = operator (fără listă; nerecomandat: lărgește tacit drepturi existente).

**Q5. Bifările cu efect juridic fără document fizic.** Azi AR-ul cere scanul confirmării, iar returul cere scanul plicului întors (regula
procedurii, în BD). A) **ridicarea se bifează automat (C0); livrarea se bifează ca fapt, AR-ul doar când dovada curierului (imagine) e arhivată
și numele primitorului = destinatarul; returul definitiv rămâne cu plicul fizic, automat doar „retur semnalat”** — *recomandat, până la
răspunsul juridic*; B) AR și retur definitive din codul curierului, fără document (schimbă regula procedurii; cere „da” juridic explicit);
C) doar ridicarea automat, restul la om.

**Q6. Plicurile respinse și corectate.** A) **se mută într-un lot nou de plicuire și se trimit ca lot nou** (lotul tipărit nu se mai atinge;
fără „Tiraj nou”) — *recomandat*; B) se trimit pe același lot, iar tu faci „Tiraj nou” (distrugerea foilor, retipărirea întregului lot);
C) operatorul poate face „Tiraj nou” singur.

### 15.2 Către curier

1. **Formatul A6**: cererea `GET /awb/label?…&pdf=1&format=A6` a întors A4; `format` e luat în seamă la `pdf=1`? Formatul depinde de o setare a
   contului / punctului de lucru? Există altă valoare / alt parametru?
2. **`POST /order`**: câmpurile corpului (clientId, adresa de ridicare, data, interval, nr. plicuri / colete, greutate, contact, observații),
   forma răspunsului (id, stare), ce întoarce la a doua comandă pe zi pe același punct, dacă se leagă de AWB-uri, dacă există citirea comenzilor
   zilei, fusul orar al orelor, lungimea maximă a observației.
3. **Limita de solicitări pe minut / pe zi** la creare, urmărire, confirmări, etichete (întrebare trimisă 15.11.2026, fără răspuns).
4. **Forma dovezii de livrare** în `GET /reports/awb/confirmations`: câmpurile fiecărui element; imaginea confirmării vine ca URL, inline sau
   deloc; cum se obține cartonașul oPOD; când apare confirmarea față de evenimentul S2.
5. **Tariful**: tariful din răspunsul creării (fără TVA, cu `vat` separat) a diferit de oferta comercială pe primul AWB — de ce (opțiunea oPOD?
   punctul de lucru? contul de test)? Tariful contractual pe plic (1 kg, 32×24×1 cm, oPOD).
6. **Punctul de lucru**: `clientId`-ul contului real = punctul de unde pleacă plicurile? Un singur punct sau unul pe proiect?
7. **Eticheta pe un singur AWB**: `GET /awb/label` cu un AWB întoarce același PDF ca în lot (pentru arhiva pe plic)? Limita de AWB-uri pe apel;
   ordinea paginilor = ordinea `awbs[]`?

### 15.3 Către juridic

1. Convocarea trimisă prin curier cu oPOD = „scrisoare recomandată cu confirmare de primire” (deschisă din 09.11.2026)?
2. **Data expedierii = data ridicării de către curier** (evenimentul C0 din sistemul curierului), înregistrată automat; termenul de 10 zile
   curge de la ea? Dacă curierul corectează ulterior data ridicării, care dată contează și cum se consemnează corectarea?
3. **AR-ul**: dovada electronică a curierului (imaginea confirmării semnate, descărcată din API) ține locul cartonașului oPOD fizic? Dacă
   numele primitorului diferă de destinatar, ce mențiune se cere?
4. **Returul**: codul curierului (refuz / adresă / mutat / neridicat) e suficient pentru a consemna returul în PV B, sau rămâne obligatoriu
   plicul fizic întors cu mențiunea curierului (scanat)?
5. **Păstrarea** etichetelor și dovezilor (date personale) în dosarul plicului: cât timp, cine le vede, ce se șterge la închiderea proiectului.
6. Numele colegului de contact (persoana de la predare) și telefonul lui ajung în sistemul curierului: e nevoie de informarea lui / acordul lui?

## 16. Ce nu s-a putut stabili din cod (presupuneri marcate, de verificat la implementare)

- Forma reală a răspunsurilor curierului la urmărire / confirmări / borderou (deschisele 7, 10, 16 din `FANCOURIER_INTEGRARE.md` §8) — codul e
  defensiv; tabelul §9.2 se verifică pe răspunsuri reale la Testul 1 (ridicarea reală a primului AWB).
- Că `GET /awb/label` pe un singur AWB întoarce o etichetă echivalentă și că apelurile repetate nu au limită (§10.1, §15.2 pct. 7).
- Că pe mediul real există `pg_cron`, `pg_net` și Vault în forma folosită de `20261011a` (migrările de acolo le verifică fail-closed; pe clonă
  se probează) și că workflow-ul de publicare acceptă funcția nouă în lista `NO_JWT` (precedent: `cleanup-recycle-bin`).
- Că `service_role` poate scrie în `storage.objects` fără politică nouă (în Supabase sare peste RLS) — de confirmat pe clonă; altfel o
  politică restrânsă la căile `plicuri/<uuid>/awb_*`.
- Corpul exact al CHECK-ului `red_plicuri_retur_complet` / `red_plicuri_ar_scan` pe mediul real = cel din `20261129i` (coloanele `curier_*` noi
  nu îl ating; se verifică prin amprentă la aplicare).
- Că trigger-ul plicului (`20261129i`) acceptă scrierea coloanelor noi `curier_*` dintr-o funcție DEFINER fără să le trateze ca „AR / retur
  deja înregistrat” — se extinde explicit în F2, cu amprenta corpului vechi.
- Durata unei rulări de urmărire cu 3.000 de AWB-uri (30 de solicitări × timeout 30 s + pauze) față de limita de execuție a funcției edge:
  plafonul de 30 se poate reduce la 15 dacă proba pe clonă o cere.
- Existența unui ecran de setări pe proiect în Redări în care să intre contactul implicit (§11); altfel caseta se pune în ecranul proiectului.
