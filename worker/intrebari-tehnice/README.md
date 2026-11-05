# ❓ Întreabă echipa — worker pe serverul AI

Decizie Răzvan 05.11.2026 („da 1-2-3-4”): spețe tehnice puse din ERP (`/intrebari`) → răspuns AI **informativ**, vizibil doar
autorului (și ownerului). Primul utilizator: Silviu Stănescu (Director Tehnic). Limită 5 întrebări/zi (owner 20), în BD.

## Piese
| Piesă | Unde |
|---|---|
| Tabel + RLS + bucket + RPC-uri | `supabase/migrations/20261105a_intrebari_tehnice.sql` (livrare: `scripts/livrare_migrare.sh`) |
| Canal worker ↔ ERP | edge `intrebari-tehnice-worker` (verify_jwt = false; poarta: Vault `INTREBARI_WORKER_SECRET`, antet `x-intrebari-secret`) |
| Worker | `intrebari_worker.py` (acest folder), Task Scheduler „Intrebari tehnice worker (Gazpet)”, la 2 minute |
| Ecran | `src/IntrebariTehnice.jsx`, cheia de modul `intrebari_tehnice` |

## Identitate
- Claude prin **API** (cheia din Credential Manager `anthropic-claude-code` / `api`, workspace-ul cu plafon lunar), NU abonamentul:
  abonamentul nu devine backend ERP pentru alți utilizatori (vezi `worker/claude-cli/README.md`).
- Secretul workerului: `C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` (64 hex, același cu Vault). Nu se pune în repo, chat sau log.
- Modelul: `INTREBARI_MODEL` (implicit `claude-sonnet-5-5`), fără unelte: fără web, fără fișiere, fără BD.

## Instalare (o singură dată, pe Gazpet-Claude)
1. Migrarea, prin `livrare_migrare.sh` (după „da”).
2. Secretul: generat în BD (`vault.create_secret(encode(gen_random_bytes(32),'hex'), 'INTREBARI_WORKER_SECRET')`), apoi citit
   cu `psql -At … -o C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` — valoarea nu trece prin chat.
3. Deploy edge `intrebari-tehnice-worker` cu verify_jwt = false.
4. Copia scriptului din `main` în `C:\Users\Public\intrebari_worker\intrebari_worker.py` (nu rulează din clona de lucru, care își
   schimbă branch-ul), apoi Task Scheduler (fără .ps1/.cmd ad-hoc — Bitdefender):
   `schtasks /Create /TN "Intrebari tehnice worker (Gazpet)" /SC MINUTE /MO 2 /TR "\"C:\Program Files\Python313\pythonw.exe\" -B C:\Users\Public\intrebari_worker\intrebari_worker.py" /F`
5. Acces: rând în `user_module_access` (`intrebari_tehnice`, editor) — doar cu acordul lui Răzvan.

## Funcționare și erori
- O rulare preia max 3 întrebări; lock `C:\Users\Public\intrebari_worker\worker.lock`.
- Jurnal: `C:\Users\Public\intrebari_worker\jurnal.jsonl` — doar id, stare, tokeni, durată (fără conținut, fără secrete).
- API supraîncărcat / limită de rată → întrebarea rămâne „în lucru”, BD o redă după 30 min (max 3 încercări, apoi „eroare”).
  Fără bucle de reîncercare.
- Credit API terminat → „eroare” cu mesaj clar pentru utilizator.

## Ce NU face
Nu caută pe web (regula 27.10.2026: web doar Claude cu omul în buclă), nu trimite mail, nu scrie în alte tabele, nu vede ERP-ul,
nu folosește Copilot / Jakarinos (ar expune contextul intern al echipei Paw).
