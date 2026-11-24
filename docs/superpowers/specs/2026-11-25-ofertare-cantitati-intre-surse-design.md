# Ofertare: aceeași cantitate, documente diferite — semnalare automată și propunere de clarificare (TKT-2026-0329) — specificație v2

Data: 25.11.2026 · Stare: v2 după review NO-GO (8 puncte) · Varianta A din `TKT-0329_variante.md`, **de ales de owner** înainte de plan.

## 1. De ce

Pe o licitație, lungimea țevii era 6.400 m în F3 și 3.995 m în ATR. ERP-ul n-a observat diferența și n-a propus o clarificare; a întrebat un alt ofertant. Avem nevoie ca diferențele mari între documentele aceleiași licitații să ajungă în fața echipei ca **ciornă** de clarificare, cu dovada din ambele surse, fără să plece nimic singur.

## 2. Ce există azi (și se refolosește)

- **`ofertare_cantitati`:** `cantitate`, `cantitate_plansa`, `diferenta_nota`, `obiect`, `lot_nr`, `cod_articol`, `um`, `surse_document_ids`.
- **`ofertare_documente_atribuire`:** `tip`, `revizie`, `text_extras` pe pagini; ATR-ul intră azi la `alta`.
- **Ciornele automate de clarificare** (mecanismul „planșe”):
  - cheie `auto_planse_*` (`ofertareClarificariBaza.js`), unică pe `(licitatie_id, cheie)`;
  - starea bazei verificată pe server în `v_ofertare_clarificari_baza` (`ok`, `identitate_contradictorie`, `marcaj_planse` = baza s-a schimbat după editare / aprobare);
  - exportul prin RPC-ul `ofertare_clarificari_export`;
  - stările permise: `propunere`, `de_trimis`, `trimisa`, `raspunsa`, `retrasa`.
- **Răspunsul Autorității** (`raspuns_clarificare`) se leagă de întrebări prin `raspuns_document_id`, ca **propunere confirmată de om** (`OfertareClarificari.jsx`).
- **Poarta pe cheltuială:** doar owner-ul sau responsabilul licitației pornesc o procesare plătită.

## 3. Ce se construiește

### 3.1 Măsura comparabilă (rezolvă potrivirile greșite)

O **măsură** = (licitație, lot, obiect / tronson, element, natura măsurii, UM canonică):
- **element** = țeavă (DN + material), robinet (DN + tip), branșament (tip), săpătură, refacere și altele, din lista închisă `ofertare_elemente_masura`;
- **natura** ∈ {`furnizare`, `montaj`, `proba`, `total_lucrare`}. O poziție F3 de furnizare se compară doar cu „furnizare” sau „total_lucrare” din alt document, nu cu montajul sau cu proba aceleiași țevi;
- **agregarea** se face doar pe aceeași măsură: suma pozițiilor F3 de furnizare pe obiect se compară cu totalul ATR pe același obiect. Un total pe toată lucrarea se compară doar cu suma tuturor obiectelor, nu cu un singur tronson. Fiecare valoare intră o singură dată în agregare (identitatea poziției).
- O potrivire incompletă (lot, obiect, natură sau element necunoscut) dă **„de verificat”**, cu ambele surse afișate. Nu e nici „diferență”, nici „în regulă”.

### 3.2 Dovada valorii (rezolvă citatele care nu dovedesc nimic)

Fiecare valoare comparată, **inclusiv cea din F3**, are o dovadă cu `document_id`, `revizie`, `pagina`, `rand` / `celula` (pentru tabele) sau `fragment` (pentru text), `antet_coloana`, `valoare_text`, `um_text`.

- **Verificarea pe server** (deterministă, fără AI): fragmentul există literal în `text_extras` la pagina dată. `valoare_text` se găsește în fragment pe poziția declarată, iar pentru tabele în celula de pe rândul și coloana cu antetul de cantitate. `um_text` apare în același rând sau antet.
- Orice verificare picată: măsurătoarea e respinsă și nu poate produce un semnal.
- AI-ul doar propune unde e valoarea; nu e sursa adevărului.

### 3.3 Regula de semnalare

- **Unitatea canonică** pe element: m pentru lungimi, buc, mc, mp. Conversii acceptate doar din tabelul închis (km→m, ml→m, t→kg numai pentru elementele cu masă). Orice altă UM înseamnă „neverificat: unitate incompatibilă”.
- **Numerele** se citesc în format românesc (punct pentru mii, virgulă pentru zecimale), cu verificare că rezultatul e unic: „1.234” nu poate însemna și 1,234. Ambiguu înseamnă „neverificat”.
- **Formula:** `|a − b| / max(|a|, |b|) > p`, unde `p` e pragul licitației (implicit 5%). Diferențele absolute sub o unitate canonică se ignoră.
  - `a = b = 0`: în regulă.
  - Una dintre valori 0 sau lipsă: „de verificat”, nu diferență.
- Pe fiecare măsură, rezultatul e unul dintre `in_regula`, `diferenta`, `de_verificat` sau `neverificat` (cu motivul). Ecranul arată explicit `neverificat`; lipsa unui semnal nu înseamnă „verificat în regulă”.

### 3.4 Identitate, versiuni, invalidare

- **Identitatea semnalului** = amprenta lui (licitație, măsura canonică de la 3.1, perechea de dovezi cu `document_id` + `revizie` + localizare).
  - Ciorna de clarificare are cheia `auto_surse_<amprentă>`, unică prin indexul existent `(licitatie_id, cheie)`.
  - Reluarea extragerii nu dublează nimic: `INSERT … ON CONFLICT DO NOTHING`, într-un RPC tranzacțional.
- **Versiunile.** Măsurătorile sunt legate de `revizie` și de amprenta textului paginii.
  - O revizie nouă a documentului, o cantitate schimbată sau alt prag duce la recalcularea măsurilor afectate.
  - Semnalele care nu mai țin se marchează `invechit`.
- **Protecția muncii omului:**
  - o ciornă `propunere` **needitată** a unui semnal învechit trece în `retrasa`, cu motiv;
  - o ciornă editată, aprobată (`de_trimis`) sau trimisă **nu se atinge**. Primește marcajul „baza s-a schimbat — de reverificat”, prin același mecanism ca `marcaj_planse`, extins la `auto_surse_*`.

### 3.5 Integrarea cu fluxul de clarificări

- Ciorna intră ca `status = 'propunere'`, cu cheie `auto_surse_*` și `origine = 'automat'`, deci moștenește protecțiile de proveniență existente pentru ciornele automate.
- `eCiornaAutomata` se extinde la `^auto_(planse|surse)_`, iar `v_ofertare_clarificari_baza` primește ramura „surse”: starea bazei = dovezile de la 3.2 încă valide pe revizia curentă.
- `ofertare_clarificari_export` blochează o ciornă `auto_surse_*` cu baza nevalidă, ca la planșe.
- Trimiterea rămâne manuală, ca azi.

### 3.6 Răspunsul Autorității (rezolvă „acoperit” fals)

La urcarea unui `raspuns_clarificare`, sistemul propune doar **„răspuns posibil relevant”** pentru semnalele deschise care se referă la aceeași măsură. Omul confirmă, ca la legătura existentă `raspuns_document_id`. Abia după confirmare semnalul poate fi marcat `rezolvat_de_raspuns`, cu valoarea reținută aleasă de om. Corecturile ulterioare ale Autorității redeschid semnalul (revizie nouă, ca la 3.4).

### 3.7 Datele: integritate și drepturi

- **Tabel nou `ofertare_cantitati_masuratori`:**
  - `licitatie_id` obligatoriu;
  - FK spre cantitate și document;
  - trigger care verifică faptul că cantitatea, documentul și măsurătoarea sunt ale **aceleiași licitații**.
- **Scrierea:** doar prin RPC-ul de server (`SECURITY DEFINER`, cu drept `fn_are_acces_ofertare()` reverificat după lock-uri). Nicio scriere directă pentru `authenticated`: `REVOKE INSERT/UPDATE/DELETE`, iar coloanele de dovadă și verdictul de verificare sunt scrise doar de server.
- **Citirea:** RLS cu `auth.uid() IS NOT NULL AND fn_are_acces_ofertare()`, ca la cantități. Vizibilitatea pe licitație e verificată pentru fiecare referință.

### 3.8 Cost

- Comparația rulează **doar** în aceeași procesare plătită pornită de owner sau de responsabil (poarta existentă), și doar pe documentele de tip `lista_cantitati`, `formular` (F3), `alta` marcate ATR, `cs_volum` (memoriu) și `plansa`.
- **Plafonul:** număr maxim de pagini pe licitație pentru căutarea măsurilor (implicit 200), plus tokenii prin plafonul existent pe proiect. Rezervarea se face **înaintea** apelului, prin mecanismul existent.
- **Fără reîncercare automată** la cost necunoscut sau răspuns pierdut: starea devine `neverificat`, iar reluarea o pornește omul.
- **Urcarea unui răspuns al Autorității** nu declanșează apeluri plătite: potrivirea de la 3.6 e textuală (măsura canonică), fără AI.

## 4. Ce NU face

- Nu schimbă cantitățile validate.
- Nu trimite clarificări.
- Nu citește SEAP automat (asta e varianta B).
- Nu atinge prețuri.

## 5. Probe

1. **Cazul din tichet:** 6.400 față de 3.995, pe aceeași măsură, dă `diferenta`, cu ciornă și ambele dovezi.
2. **Negative:**
   - furnizare față de montaj, total față de tronson, două tronsoane cu același DN: fără semnal greșit;
   - citat autentic, dar valoarea de pe alt rând sau diametrul în loc de cantitate: măsurătoarea e respinsă;
   - unități incompatibile și număr ambiguu: `neverificat`;
   - răspunsul Autorității care doar pomenește rândul: rămâne „posibil relevant” până la confirmarea omului.
3. **Idempotență și concurență:** două rulări simultane ale extragerii dau o singură ciornă. O revizie nouă invalidează doar propunerile needitate.
4. **Acces:**
   - utilizator fără acces la Ofertare: nu citește și nu scrie;
   - scriere directă în tabel: refuzată;
   - asocierea a două licitații diferite: refuzată de trigger.
5. **Cost:** plafonul de pagini e respectat; un răspuns pierdut nu duce la a doua generare.
6. **Măsurarea:** pe 3 licitații reale, cu numărătoarea pentru fiecare: semnale corecte, false, diferențe reale ratate (verificate manual pe o mostră) și „neverificat”.

## 6. Livrare

- Spec → plan → Rocky: migrare (tabel + trigger + RPC + extinderea view-ului de bază și a exportului) + extragerea + ecrane.
- Review Jakarinos, probă pe clonă. Aplicarea doar cu „da”.
