# ofertare-worker — extragerea cerințelor pe NAS Terra

Consumă `ofertare_extragere_coada` cu același cod ca edge function-ul `ofertare-cerinte` (`core.ts`), fără limita
de 150 s a gateway-ului. Scrie heartbeat în `worker_heartbeat`; cât e proaspăt (< 10 min), `ofertare_extragere_tick`
(pg_cron) nu lansează nimic — dacă workerul cade, tick-ul reia singur. Doar conexiuni de ieșire.

Deploy pe NAS (o singură dată):
```
mkdir -p /Volume1/docker/gazpet-ofertare-worker && cd /Volume1/docker/gazpet-ofertare-worker
curl -fsSLO https://raw.githubusercontent.com/gazpet-test/pontaj-pro/main/worker/ofertare/{Dockerfile,docker-compose.yml,entrypoint.sh}
cp .env.example .env && chmod 600 .env   # completează cheile
docker-compose -p gazpet-ofertare-worker up -d --build
docker logs -f gazpet-ofertare-worker
```
Actualizare: nimic de făcut — containerul face `git pull` la 5 minute și repornește la commit nou pe `REPO_BRANCH`.

## Citirea documentelor (ingest.ts) și PDF-urile mari (citire_mare.ts, R6 / doc 770)
PDF cu strat de text → `pdftotext` gratuit; scanurile → edge `ofertare-ingest-doc` (AI). Peste **60 MB** (pragul edge-ului,
care le marchează `ignorat` „prea mare pentru citirea automată…”) workerul le citește singur, fără AI și fără să le țină
în memorie: descărcare în flux pe disc (URL semnat, plafon 200 MB, SHA-256 din mers) → `pdfinfo` (plafon 3.000 pagini) →
`pdftotext -f/-l` pe felii de 25 de pagini (felia care pică se înjumătățește până la o pagină) → aceleași coloane ca un PDF
normal + urma în `analiza.citire_mare` (încercări, felii, SHA-256, comparația cu `ofertare_seap_manifest`).
Anti-buclă: încercarea se numără în BD înainte de muncă (CAS pe `analiza->citire_mare->>rev`), max. 3, apoi `eroare`
definitiv cu motiv; `pdfinfo` oprit la timeout / nepornit = eșec trecător (se reia, plafon 60/120/180 s), definitiv doar
când răspunde fără „Pages:”. Pe drumul cu AI, orice răspuns al edge-ului fără `ok:true` (ex. 546 WORKER_LIMIT) e eroare
cu motivul real (cauza celor 5421 de treceri pe 770); în `proceseazaIngest`, un document care revine candidat după o
trecere în aceeași tură e oprit, iar `ofertare_ingest_coada.activ` se recitește înainte de fiecare document („Oprește”
din UI / rollback-ul oprește tura la documentul următor; citirea deja pornită se termină — un PDF mare poate ține
rândul de citire ~85 min pe încercare).
Nu cere rebuild (`--allow-run=git,pdftotext,pdfinfo` e deja în `entrypoint.sh`). Detalii: `docs/R6_770_CITIRE_PDF_MARE.md`.
Teste (`--no-lock`: altfel deno rescrie `deno.lock` din rădăcina repo-ului):
`deno test --node-modules-dir=none --no-lock --allow-read --allow-write --allow-run=pdftotext,pdfinfo,sleep worker/ofertare/citire_mare_test.ts`
și `deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-write=/tmp --allow-run=pdftotext,pdfinfo worker/ofertare/ingest_mare_test.ts`.

## Documentația SEAP și extractorul izolat (24.09.2026)
`seap.ts` descarcă din SEAP, desface `.p7s`, dar **nu despachetează singur**: arhivele merg la containerul
`gazpet-seap-extractor` (`extractor/`), singurul cu 7-Zip. Acesta rulează fără rețea, fără `.env`/chei,
non-root, cu FS read-only și 1 GB RAM; vede doar volumul Docker `seap-work` (montat `/seap-work` în worker, `/work` în extractor; NU un folder din share-ul NAS — cotă + ACL).
Protocolul e pe fișiere (vezi antetul `extractor/extractor.sh`): workerul cere listarea, o verifică
(`verificaListare`, `verificaVolume`), apoi cere extragerea; extractorul impune limitele efective
(spațiu, număr de fișiere, mărime pe fișier, timp, symlinkuri, adâncime) și șterge tot la depășire.
`extractor.sh` e copiat în imagine → după o schimbare: `docker-compose -p gazpet-ofertare-worker up -d --build seap-extractor`.
Teste: `bash test-fixtures/seap_terra/run.sh` (include `extractor_test.sh`, arhive malițioase).

### Cum sunt impuse limitele (precizare cerută de Copilot)
- **Mărime pe fișier (2 GB)** și **listare (50 MB text)**: `ulimit -f` — plafon strict impus de kernel.
- **CPU listare (120 s)**: `ulimit -t` — strict.
- **Memorie (1 GB), procese (64)**: `mem_limit` / `pids_limit` ale containerului — stricte.
- **Spațiu total (6 GB), număr de fișiere (5.000), timp (20 min)**: MONITORIZARE o dată pe secundă + `kill -KILL`
  (7zz nu creează subprocese, deci oprirea lui oprește tot arborele) + o verificare finală după ieșire. NU e plafon
  absolut: se poate depăși cu cât scrie 7-Zip într-o secundă (de ordinul sutelor de MB / miilor de fișiere mici).
  Rezultatul tot eșec e, iar `out/` se golește; intrările și diagnosticul (`rasp/`) rămân până curăță workerul.
- **Separare per job**: folderul jobului, `in/`, `cerere` și `prima` sunt ale workerului (root, 755) — extractorul
  (uid 10001) le poate doar citi; scrie numai în `out/` și `rasp/` (chown 10001, 700). Joburile rulează secvențial.
- **Replay de acceptare** pe un set real: `docker exec gazpet-ofertare-worker deno run -A /app/worker/ofertare/replay_seap.ts <licitatie>`
  (fără urcare/BD; CRC per fișier vs. antetul arhivei, SHA-256, nume+mărimi vs. documentele urcate, intrări neatinse).
