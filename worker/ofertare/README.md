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

## Documentația SEAP și extractorul izolat (24.09.2026)
`seap.ts` descarcă din SEAP, desface `.p7s`, dar **nu despachetează singur**: arhivele merg la containerul
`gazpet-seap-extractor` (`extractor/`), singurul cu 7-Zip. Acesta rulează fără rețea, fără `.env`/chei,
non-root, cu FS read-only și 1 GB RAM; vede doar `./seap-work` (montat `/seap-work` în worker, `/work` în extractor).
Protocolul e pe fișiere (vezi antetul `extractor/extractor.sh`): workerul cere listarea, o verifică
(`verificaListare`, `verificaVolume`), apoi cere extragerea; extractorul impune limitele efective
(spațiu, număr de fișiere, mărime pe fișier, timp, symlinkuri, adâncime) și șterge tot la depășire.
`extractor.sh` e copiat în imagine → după o schimbare: `docker-compose -p gazpet-ofertare-worker up -d --build seap-extractor`.
Teste: `bash test-fixtures/seap_terra/run.sh` (include `extractor_test.sh`, arhive malițioase).
