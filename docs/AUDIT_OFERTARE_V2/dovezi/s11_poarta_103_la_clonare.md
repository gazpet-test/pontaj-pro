# S11 — starea porților pe clona 103 imediat după clonare (28.09.2026, SELECT-only)

| Control server | Lic 5 (reală, depusă manual 18.09) | Clona 103 |
|---|---|---|
| `v_ofertare_seap_completitudine.blocaj` | „nu putem verifica completitudinea: documentația din SEAP nu a fost încă enumerată" (`din_seap=true`, `enumerare=nerulata`) | „1 document(e) esențiale … necitite sau citite parțial" (`din_seap=false`, `enumerare=n/a`) |
| `esentiale / esentiale_necitite` | 10 / 1 | 10 / 1 |
| `ofertare_r5_blocaj_sursa()` | „cantități de verificat: lista_f3_nevalidate = 62" | identic (62) |
| pachete `ofertare_pt_pachet` | 0 | 0 |

Observații:
1. Documentul „esențial necitit" e **1286 `LISTE CANTITATI FARA VALORI.zip`** (`tip='lista_cantitati'`, `status_procesare='ignorat'`) — containerul zip, al cărui conținut (C6…F3, docs 1288–1294) e integral `procesat`. CTE-ul `ess` din vedere nu exclude arhivele (CTE-ul `ign` le exclude prin regex). Consecință: pe 103 aprobarea pachetului e blocată de un zip deja despachetat, iar pe 5 același zip ar fi devenit blocaj imediat după enumerarea SEAP. Candidat de constatare (WRONG_SEMANTICS / fals-roșu) — de confruntat cu inventarul S11 înainte de a-l adăuga.
2. Licitația reală 5 n-ar fi trecut niciodată poarta de aprobare a pachetului (enumerarea SEAP nerulată) — depunerea din 18.09 s-a făcut în afara platformei (vezi S08-02).
3. r5: 62 poziții F3 nevalidate — P2 pasul 6 (validare cantități) trebuie să le închidă prin UI; testul „diferență blochează" pornește de aici.
