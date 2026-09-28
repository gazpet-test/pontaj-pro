# JAK_verifica_manifest — verificarea săptămânală SEAP ↔ Storage rulată ÎN PROCES (varianta B, Răzvan 27.09)

Citește întâi: `AGENTS.md` („Când scrii cod”), `worker/ofertare/verifica_manifest.ts`, `worker/ofertare/seap.ts`
(funcția `verificarePeriodica`, L~412–440), `worker/ofertare/entrypoint.sh`.

## Problema
`verificarePeriodica` (seap.ts) pornește `verifica_manifest.ts` ca proces copil: `new Deno.Command(Deno.execPath(), { args: ['run','-A', …] })`.
Workerul rulează cu `--allow-run=git,pdftotext,pdfinfo`, deci pornirea lui `deno` e refuzată și verificarea n-a rulat NICIODATĂ
de la #484 (log Terra: `verificare oprită — Requires run access to "/bin/deno"`). Varianta A (a da workerului `--allow-run=deno`)
e respinsă: copilul ar rula cu `-A`, deci toate drepturile.

## Ce faci
1. Mută logica din `verifica_manifest.ts` într-o funcție exportată, de ex. în `worker/ofertare/verifica_manifest_lib.ts`:
   `export async function verificaManifest(supa, licId: number, opt: { uscat?: boolean, semnal?: AbortSignal }): Promise<Raport>`
   unde `Raport` = exact câmpurile din JSON-ul de azi (licitatie, seap_documente, fisiere, identice, diferite, lipsa_in_platforma,
   ignorate, manifest_scrise, uscat, platforma_fara_seap, erori). Comportamentul (ce citește, ce scrie, curățenia din /seap-work)
   rămâne IDENTIC. Fără top-level await, fără `Deno.exit` în lib.
2. `verifica_manifest.ts` rămâne scriptul manual (aceeași linie de comandă, același JSON la stdout): doar parsează argumentele,
   creează clientul și cheamă `verificaManifest`.
3. `verificarePeriodica` cheamă `verificaManifest(supa, a.id, { semnal })` direct, în proces, cu plafonul de 30 min prin
   `AbortSignal` (verificat între documente — nu lăsa un fetch agățat să blocheze bucla; dacă `descarca`/`listaSeap` nu primesc
   semnal, verifică semnalul între pași și nu porni un document nou după expirare). Logul rămâne pe același format
   (`verificare ok — identice X, diferite Y, lipsă Z` / `EȘEC …`).
4. NU schimba `entrypoint.sh` și NU adăuga `deno` în `--allow-run`. Verifică că lib-ul folosește doar permisiunile pe care
   workerul le are deja (net, env, read /app,/deno-dir,/tmp,/packs,/seap-work, write /deno-dir,/tmp,/packs,/seap-work,
   run git/pdftotext/pdfinfo). Extractorul izolat e apelat prin fișiere în /seap-work, ca azi — nu prin `docker`.

## Teste obligatorii
- `worker/ofertare/verifica_manifest_test.ts` (Deno), cu supabase și SEAP simulate (fetch/obiect fals):
  1. licitație cu 2 documente identice + 1 diferit + 1 lipsă → raportul are exact contoarele corecte și rândurile de manifest corecte;
  2. `uscat: true` → nicio scriere în `ofertare_seap_manifest`;
  3. semnal expirat înainte de al doilea document → oprire curată, raport parțial marcat (eroare „oprit la plafon”), /seap-work curățat;
  4. un test care rulează `verificaManifest` cu permisiunile workerului (`deno test --allow-net --allow-env --allow-read=… --allow-write=…
     --allow-run=git,pdftotext,pdfinfo`) și dovedește că NU cere `run` pentru `deno`.
- `worker/ofertare/plansa_test.ts` și restul suitei worker rămân verzi.

## Limite
Nu rulezi git, nu atingi producția. Fără migrări. Nu modifici logica de import SEAP, doar mutarea verificării în proces.

## La final
Raport `docs/JAK_verifica_manifest_raport.md`: ce ai schimbat, teste, ce n-ai putut rula.
