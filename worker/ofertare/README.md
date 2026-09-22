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
