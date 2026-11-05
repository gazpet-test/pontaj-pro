# Redări — utilizatori / arendași convocați (juridic#040)

Decizia lui Răzvan, 05.11.2026 (juridic#040):
- utilizatorii / arendașii **primesc convocare** acolo unde sunt alții decât proprietarul;
- au rol separat pe parcelă și **nu înlocuiesc** proprietarul;
- plic separat pe persoană și UAT, cu AR, opis și PV de plicuire, ca la proprietari;
- **PV A** îl poate semna proprietarul **sau** utilizatorul, iar pe PV se trece calitatea semnatarului;
- **PV B** se face doar dacă **nu răspunde nimeni**, nici proprietarul, nici utilizatorul;
- informarea GDPR v3.3 îi acoperă deja (#939). Convocarea pornește doar cu informarea publicată, regulă impusă deja de `trg_red_convocari_informare`.

Sursa datelor: fișierul TGZ „Despăgubiri LOT 1 – Date de contact utilizatori.xlsx” (NAS, `corespondenta la contract/pers.responsabil propietari teren`), coloanele 24–26 („Prenume și nume”, „Adresa”, „Telefon”). Fișierul acoperă toată conducta (24 UAT-uri). Doar cele 7 UAT-uri sunt Lot 1.

Rularea de probă pe Lot 1 (05.11): 411 rânduri, **156 de persoane distincte**, dintre care 48 sunt deja deținători pe aceeași parcelă. Rămân **~108 persoane noi**, cu 0 telefoane și toate cu adresă.

## Model
- Utilizatorii devin rânduri `red_detinatori` cu `calitate = 'utilizator'`. CHECK-ul permite deja `'utilizator'` și `'arendas'`, iar fișierul nu le deosebește.
- Ce merge fără schimbări: tokenul (trigger), formularul public și PV A per persoană (`fn_red_pv_creeaza`).
- Plicul se grupează pe persoană + UAT (`fn_red_cheie_persoana`), deci un utilizator primește plic separat de proprietar.
- Ce trebuie schimbat: regula PV B, starea parcelei, statisticile, convocatorul (alt text) și importul.

## Felierea
| PR | Conține | Migrare | Depinde de |
|---|---|---|---|
| **PR1 – regula PV** | `fn_red_parcela_acoperita_a(parcela)` = PV A semnat de un utilizator **sau** toți deținătorii de pe partea proprietarului cu PV A; o folosesc `fn_red_pv_creeaza('B')`, `fn_red_pv_b_semnare` și `red_v_tronson.tip_pv`. Coloana `red_procese_verbale.calitate_semnatar`, înghețată la semnare. Oglinda în `pv.js` / `ModalPv.jsx`. | da | Q1, Q2 |
| **PR2 – stare + UI** | Stare nouă „acoperit prin PV A pe parcelă” (`red_v_stare_parcela` + `stare.js`), centralizatorul (Q5), grup „Utilizatori” în Fișa parcelei, filtru de rol în Registru / Notificări / export, PV B cu secțiune pentru utilizatori. | da (vederi) | PR1, Q5 |
| **PR3a – poartă utilizatori (livrat în cod, neaplicat)** | `20261131c_redari_poarta_utilizatori.sql`: flag implicit false, doar owner cu proveniență; refuz în rezervarea atomică și trigger pentru regenerare / expediere. Filtrare și raport în lot; comutator owner cu confirmare. | da, fișiere + rollback + DRY | 30l + 30m |
| **PR3b – șablon utilizator (deschis)** | `convocator_utilizator.docx` (Model 1U, textul vine separat de la Juridic), selectat după calitate, doar cu poarta aprobată. **Nu cere avizul avocatului**, decizia Răzvan / claude_context #1920. | nu | textul Juridic + PR3a |
| **PR4 – import** | `importUtilizatori.js`, import dedicat (nu `parseazaTgz`, care ar transforma proprietarii unici în coproprietari). Parcela se ia după `cheie_sursa`; se sare cine e deja deținător (`nume_normalizat`); rând nou cu `calitate='utilizator'`, `sursa_date`, `versiune_lista_tgz` + contactul (adresa). Lotul în `red_import_loturi` (`sursa='TGZ_UTILIZATORI'`), plus raport CSV cu ce nu se potrivește. | nu | rulat în producție după PR1–PR3b (sau PR1 + poarta PR3a) |

**Ordinea de rulare în producție:**
- Utilizatorii importați intră **automat** în generarea în masă (`pregatesteLot` filtrează doar `'neidentificat'`).
- Ca atare, importul (PR4) nu se face în producție înainte de aplicarea și verificarea porții din PR3a. `IMPORT_UTILIZATORI_ACTIV=false` rămâne neschimbat.

## Întrebări deschise
1. **„A răspuns” = a semnat PV A?** Azi PV B se face și pentru cine a răspuns, dar nu semnează (`motiv_pv_b` = declarație / refuz). Propunere: PV B e blocat doar de un PV A semnat. Pentru Juridic.
2. **Coproprietari + utilizator:** dacă semnează doar utilizatorul, mai intră în PV B coproprietarii care n-au răspuns? Citită literal, decizia spune că nu. Regula din 20261129f spune că fiecare coproprietar fără PV A intră în PV B. Pentru Juridic.
3. O persoană care e proprietar pe o parcelă și utilizator pe alta, în același UAT, primește **un singur plic** cu două convocatoare, fiecare cu calitatea lui. **Acceptat** de Răzvan (claude_context #1920).
4. Convocatorul pentru utilizator (Model 1U) **nu cere avizul avocatului**, decizia Răzvan (claude_context #1920); textul Juridic vine separat în PR3b. PV B cu utilizatori rămâne pentru Juridic, în afara PR3a.
5. Procentul de parcele închise din centralizator: utilizatorii se numără ca rânduri separate sau parcela contează o singură dată? Pentru Răzvan.

## Locuri care trebuie să deosebească proprietarul de utilizator (inventar)
- `red_v_stare_parcela` / `stare.js` (`calculeazaStare`)
- `red_v_centralizator_uat` / Dashboard / `exportXlsx`
- `pv.js` (`detinatoriFaraPvA`, `verificaDatePvB`, `referintaPvA`, `genereazaPvB`)
- `ModalPv.jsx`
- `FisaParcela.jsx`
- `notificari.js` / NotificariEcran
- `convocatoareMasa.js` (`pregatesteLot`)
- `fn_red_convocare_rezerva`
- `docx.js` (alegerea șablonului)
- Fără schimbări: SMS (0 telefoane) și `importAnexa7.js`.

## PR3a — livrat (fișiere; fără aplicare în Supabase)

- `convocare_utilizatori_aprobata` este implicit false. Owner-ul o schimbă în Setări proiect cu confirmare și CAS pe versiune; BD verifică `auth.uid()` / `profiles.is_owner`. Cine/când a aprobat este pus de server și păstrat la OFF.
- `fn_red_convocare_rezerva` refuză `utilizator` și `arendas` sub lock-ul existent, înainte să consume numărul (`RD006`). Triggerul acoperă și PATCH, regenerare, reactivare, plicuire și expedierea propagată din plic; anularea simplă și AR/tracking rămân posibile. ACL/RLS existente rămân neschimbate.
- Lotul îi raportează distinct în `exclusi` / opis; refuzul serverului după verificare nu pornește fallback. Generatorul individual refuză inclusiv previzualizarea.
- **PR3b deschis:** adăugarea și verificarea șablonului juridic, selectarea lui în generator, teste de conținut și plic cu proprietar + utilizator în același UAT. Până atunci clientul refuză documentul utilizatorului și cu poarta aprobată, ca să nu folosească textul proprietarului.
- Verificarea SQL pe schema completă, concurența și apply → rollback → re-apply trebuie executate separat într-o bază izolată. PR3a nu activează importul.
