# Grafic de execuție: import MS Project / Primavera -> Execuție (📅 Grafic)

Pasul 1: graficele existente (`.mpp` MS Project, `.xer` Primavera, `.xml` MSPDI) se citesc cu [MPXJ](https://www.mpxj.org/),
fără MS Project și fără licență, și se afișează în Execuție -> proiect -> 📅 Grafic. Încărcarea din aplicație NU există încă.

## Fișiere
- `import_mpp.py` — fișier -> JSON `gazpet.grafic.v1` (+ opțional SQL de import). Nu scrie în baza de date.
- `requirements.txt` — `mpxj`, `JPype1`, `packaging`, cu hash-uri. Cere Java 17+.
- `fixture_sintetic.py` — graficul SINTETIC din `test-fixtures/grafic/` (datele reale nu intră în repo).
- `test_import_mpp.py` — testele scriptului (partea MPXJ e sărită vizibil fără Java).
- Schema: `supabase/migrations/20261202a_executie_grafic.sql` (+ revenirea din `supabase/revenire/`, harness `scripts/test_executie_grafic.sql`).

## Pregătire (o dată, pe calculatorul care rulează importul)
```
python -m venv <venv>
<venv>\Scripts\python -m pip install --require-hashes -r scripts/grafic/requirements.txt
```
Java: `JAVA_HOME`, `--java-home <dir JDK>` sau `java` în PATH.

## Import (rulat de chat, după „da”-ul lui Răzvan și după aplicarea migrării)
```
<venv>\Scripts\python -I -X utf8 scripts/grafic/import_mpp.py "<fișier.mpp>" --proiect-id <id ERP> --eticheta "LOT 2 R5 sep 2026" ^
    --iesire <grafic.json> --sql <import.sql> [--sursa-afisata "<calea de pe NAS>"] [--accepta-incerte]
```
1. Sursa se citește o singură dată, în memorie; sha256 se calculează pe aceiași octeți pe care îi parsează MPXJ. Fișierul nu se modifică.
2. Se verifică raportul tipărit (`OK …: N activități, niveluri …, complet=…`) și, în JSON, `avertismente` și `incerte`.
3. `import.sql` = o tranzacție cu un singur apel `fn_executie_grafic_importa(<json>, true)`; revizia nouă devine cea activă pe proiect.
   Reaplicarea aceluiași fișier pe același proiect nu dublează nimic.

## Reguli
- **Coloanele de raport** („% PLAN”, „% Complete” din tabelul de raport, scrise de om în câmpuri text): se iau automat doar dacă un
  tabel salvat în fișier le dă titlul; altfel `--camp-pct-plan TEXTn` / `--camp-pct-raportat TEXTn`, după confirmarea autorului graficului.
  `% realizat` rămâne mereu procentul nativ din MS Project.
- **Valori necitibile** (ex. `#DIV/0!` lipit din Excel): devin `incerte` (cu WBS-ul lor), `complet = false`; SQL-ul se generează doar cu
  `--accepta-incerte`, după ce le-a văzut un om. Valoarea rămâne goală în ERP, iar lista stă în revizie (`metadate.incerte`).
- **Abateri de structură** (proiecte multiple în același fișier, niveluri sărite, sub-proiecte legate): `avertismente`, fără SQL.
- **Valori invalide** (procent în afara 0–100, UniqueID dublat, finish înaintea start-ului): importul se oprește, fără JSON.
- Rândurile goale din MS Project se numără (`randuri_goale`), nu se importă.
