# JAK_D4 — Citirea planșelor pe abonament (pilotul `claude -p`), DOAR pentru teste/recitiri pornite de om

Decizia D4 (Răzvan, 27.09.2026, claude_context 1466): coada automată `ofertare_plansa_coada` rămâne pe cheia API.
Testele, citirile și recitirile din dezvoltare, **pornite manual de owner**, pot rula pe abonament prin pilotul
`worker/claude-cli`. Tiparul e cel din B1/B2: **CLI citește, workerul scrie** (containerul CLI nu are chei și nu atinge BD).

Citește întâi: `AGENTS.md` (secțiunea „Când scrii cod”), `worker/claude-cli/README.md`, `worker/claude-cli/launcher.sh`,
`worker/ofertare/plansa.ts`, `supabase/functions/ofertare-plansa-citeste/handler.ts` (citesteFelie, lipestePereche, Deps, handler).

## Ce construim (3 bucăți)

### 1. Pregătire (worker Deno, service_role) — `worker/ofertare/plansa_cli_pregateste.ts`
Comandă manuală: `deno run -A worker/ofertare/plansa_cli_pregateste.ts <doc_id> <dir_iesire>`.
- Citește documentul (`ofertare_documente_atribuire`): `analiza.plansa.cale_felii`, `taiat_la`, lista feliilor.
- Descarcă feliile JPEG din Storage în `<dir_iesire>/felii/` cu numele etichetei (ex. `r1c2.jpg`).
- Scrie `<dir_iesire>/manifest.json`: `{doc_id, licitatie_id, fisier_path, taiat_la, cale_felii, felii:[{eticheta, fisier, sha256}], perechi_lipire:[[a,b],…], generat_la}`.
- Scrie `<dir_iesire>/INSTRUCTIUNI.md` și `INSTRUCTIUNI_LIPIRE.md` exportate DIN handler (exportă constantele din handler.ts; nu le copia de mână, ca promptul să nu divergă).
- Poarta: rulează doar dacă `CERUT_DE` (uuid din env) e owner (`profiles.is_owner`). Altfel iese cu eroare, fără descărcare.

### 2. Citire (containerul CLI, fără chei) — sarcina nouă `plansa_felii`
- `worker/claude-cli/prompts/plansa_felii.md`: pentru FIECARE felie din `manifest.json`, citește imaginea cu `Read` și
  scrie răspunsul ca JSON conform `INSTRUCTIUNI.md`; pentru fiecare pereche din `perechi_lipire`, conform `INSTRUCTIUNI_LIPIRE.md`.
  Ieșire: un singur fișier `out/<stamp>_plansa_felii.json` = `{doc_id, taiat_la, felii:{<eticheta>:{sha256, text}}, lipiri:{"a+b":{text}}}`,
  unde `text` e răspunsul brut al modelului (JSON-ul ca text). Modelul: `opus` (ca în handler), `TASK_MAX_TURNS` suficient pentru N felii.
- `launcher.sh`: pentru `plansa_felii` NU se face pre-extragere text; se verifică doar că `/data/manifest.json` există.
  Rămân toate garanțiile: fără cheie API, doar `Read, Glob, Grep`, `/data` :ro, timeout, jurnal fără secrete.
- `run_pilot.sh`: acceptă `plansa_felii` cu folderul produs la pasul 1.

### 3. Import (worker Deno, service_role) — `worker/ofertare/plansa_cli_importa.ts`
Comandă manuală: `deno run -A worker/ofertare/plansa_cli_importa.ts <fisier_plansa_felii.json> <dir_pregatire>`.
- Verifică: `doc_id` și `taiat_la` din fișier = manifest = documentul curent din BD; `sha256` al fiecărei felii = manifest.
  Orice neconcordanță → oprire, nimic scris.
- Rulează **același `handler`** (ca `plansa.ts`) cu `deps.fetch = fetchDinCli(...)`: un adaptor care NU face niciodată
  rețea. Pentru o cerere spre `api.anthropic.com` ia imaginea din body, calculează sha256, caută textul CLI corespunzător
  (felie sau pereche de lipire) și întoarce un `Response` 200 în forma Messages API
  (`{content:[{type:'text',text}], usage:{input_tokens:0,output_tokens:0}, stop_reason:'end_turn'}`).
  Negăsit → răspuns 422 cu mesaj clar (felia rămâne eroare în citire, se poate relua). Orice alt URL → excepție.
- `deps.API_KEY` = un marcaj nenul (ex. `'cli-abonament'`), NU cheia reală; cheia reală nu se încarcă deloc în proces.
- Proveniența: citirea trebuie marcată ca venind de pe CLI, ca să NU se amestece cu o citire API (regula existentă
  `versiuneIncompatibila`). Adaugă în `Deps` un câmp opțional `modelEticheta` (implicit `MODEL`) folosit în
  `versiuneCur.model` și `citireAi.model`; importul îl setează `'cli:opus'`. Fără alte schimbări în handler.
- Costul: 0 în `ai_usage_log` (tokenii 0). NU se folosește `ofertare_plansa_coada` / `ofertare_plansa_buget`.
- Poarta: ca la pasul 1 (`CERUT_DE` = owner), iar apelul către handler se face cu SERVICE (ca în `plansa.ts`).

## Teste obligatorii (fiecare reparație cu testul ei)
- `worker/ofertare/plansa_cli_test.ts` (Deno):
  1. adaptorul nu face niciodată rețea (orice URL necunoscut → throw; `globalThis.fetch` înlocuit cu unul care pică testul);
  2. felie cu sha diferit de manifest → import oprit, zero scrieri;
  3. `taiat_la` diferit între fișier și BD → oprit;
  4. felie lipsă din ieșirea CLI → felia apare ca eroare, restul se scrie;
  5. citirea rezultată are `model = 'cli:opus'` și o citire API existentă pe aceeași tăiere NU se amestecă (409/versiune incompatibilă);
  6. non-owner → refuz la pregătire și la import;
  7. `deps.modelEticheta` absent → comportament identic cu azi (suita handler 240/240 rămâne verde).
- `launcher.sh` pentru `plansa_felii`: test de fum în `test-fixtures/` (manifest lipsă → cod 2, motiv în jurnal).

## Limite (nu le încălca)
- Nu rulezi git, nu atingi producția, nu ceri secrete. Fără migrări (nu e nevoie de schemă nouă).
- Nu modifici `plansa.ts` (coada API) în afară de a extrage, dacă e nevoie, o funcție comună.
- Nimic automat: fără cron, fără coadă, fără buton în UI. Pornire doar din linia de comandă, de către owner.

## La final
Raport scurt `docs/JAK_D4_raport.md`: ce ai schimbat, unde, ce teste, ce NU ai putut rula (spune explicit dacă Deno nu merge la tine).
