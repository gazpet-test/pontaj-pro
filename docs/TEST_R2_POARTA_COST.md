# TEST R2 — poarta pe cheltuială (server) — 25.09.2026

Funcții: `ofertare-plansa-citeste` (Opus pe imagini), `ofertare-cantitati-extrage` (OpenAI/Gemini/Anthropic).

## a) Ordinea în cod (repo)
### ofertare-plansa-citeste/index.ts
- 405-406: fără Bearer -> 401. 408-413: `getUser(jwt)` -> 401 dacă invalid.
- 421-423: citește doc (DB, gratuit) -> 404 dacă nu există.
- 426-433: `is_owner` sau `responsabil_id === uid`, altfel 403.
- Primul cost: 439 `storage.list`, 457/519 `storage.download`, 101/353 `fetch api.anthropic.com` — toate DUPĂ poartă.
- Observații:
  - 402: verificarea `ANTHROPIC_API_KEY` e înaintea auth (doar 500 informativ, fără cost).
  - 408: `jwt === SERVICE` sare poarta (uidApelant=null) — intenționat pt. apel intern; cheia service nu iese din server. OK.
  - `responsabil_id` null -> nimeni în afară de owner (condiția `lic?.responsabil_id &&`). OK.
  - Doc inexistent -> 404 înainte de poartă: permite unui user logat să afle dacă un id există (enumerare, fără cost). Minor.
  - Licitație ștearsă (lic null) -> 403 pt. non-owner. OK.
### ofertare-cantitati-extrage/index.ts
- 176: `x-radar-secret` valid (RPC `fn_verifica_radar_secret`) -> sare JWT ȘI poarta (by design, worker). Secret greșit -> cade pe JWT.
- 177-182: fără Bearer 401, token invalid 401.
- 198-205: poarta owner/responsabil pe `licitatie_id` din body, 403.
- Primul cost: fetch AI la 68/89/107, apelat după 206+ — după poartă.
- Observații:
  - `dry_run:true` NU e gratuit: sare doar scrierea (346), apelurile AI rulează. Doar `max_felii` limitează.
  - `furnizor` din body alege modelul (inclusiv `anthropic` = mai scump) — ok, tot după poartă.
  - Riscul real = cine știe radar-secret (worker) ocolește poarta; secretul trebuie ținut doar pe server.
- Nicio cale prin care un body să sară verificarea.

## b) Test live (fără cost) — doc_id 470 (licitatie 95)
```
U=https://dxczwkbciseqniprspcu.supabase.co/functions/v1
curl -X POST $U/ofertare-plansa-citeste -H 'Content-Type: application/json' [-H "Authorization: Bearer <ANON>" | <JWT_FALS>] -d '{"doc_id":470}'
curl -X POST $U/ofertare-cantitati-extrage -H 'Content-Type: application/json' [...] -d '{"licitatie_id":95,"dry_run":true,"max_felii":1}'
```
JWT fals = header HS256 + payload {sub:000..., role:authenticated} + semnătură „fake".

| Caz | plansa-citeste | cantitati-extrage |
|---|---|---|
| fără Authorization | 401 `UNAUTHORIZED_NO_AUTH_HEADER` (gateway, verify_jwt=on) | 401 `fără autentificare` (cod) |
| Bearer <ANON> | 401 `unauthorized` (cod: getUser fără user) | 401 `token invalid` |
| JWT fals | 401 `UNAUTHORIZED_LEGACY_JWT` (gateway) | 401 `token invalid` |
| apikey <ANON> + JWT fals | 401 gateway | 401 `token invalid` |
| x-radar-secret greșit, fără JWT | — | 401 `fără autentificare` |

Notă: cantitati-extrage are verify_jwt dezactivat la gateway (răspunsurile vin din cod) — poarta de cod e singura; e corectă.

## c) Nicio scriere
Înainte/după: `md5(analiza)` doc 470 = `032b9a44a342670f7bc75fed63c12905` (identic); `ofertare_cantitati` lic 95 = 0 rânduri (identic).

## d) Calea 403 (user logat fără drept) — netestată live
Lipsește un JWT de utilizator real non-owner, non-responsabil. Opțiuni (cer acordul lui Razvan):
- A) cont de test dedicat, fără module, nesetat responsabil pe nicio licitație -> curl cu tokenul lui: așteptat 403 fără cost.
- B) test Deno offline: necesită extragerea porții într-o funcție pură (ex. `poartaCost(isOwner, responsabilId, uid)`) — refactor mic, dar logica de azi e o singură expresie (431 / 203), verificată prin citire.
Neverificat: că versiunea DEPLOYATĂ conține poarta 403 (comparat doar repo; de confirmat cu get_edge_function).

## Concluzie
Toate căile neautentificate/false refuză cu 401 înainte de orice storage/AI; nicio scriere în DB. În cod, poarta 403 precede orice cost în ambele funcții. Ocoliri doar prin chei de server (SERVICE_ROLE, radar-secret). Atenție: `dry_run` costă.
