# E9 pilot — OCR E3 server

Modificate: `supabase/functions/ocr-packing-list/index.ts` (dispatch separat, fluxul vechi păstrat), adăugate `avizE3.ts`, `avizE3Handler.ts`, cele două fișiere `_test.ts`, migrarea `20261105a_ai_plafon_lunar.sql`, revenirea corespunzătoare și `scripts/test_ai_plafon_lunar.sql`. Fără UI, modificări ale obiectelor izometriei sau salvare de documente.

## Contract implementat

POST cu JWT: `{tip:'aviz_e3', proiect_id:int pozitiv, depozit_id:int pozitiv, sablon:'aviz_teava'|'lista_curbe', pdf_base64:string, nume_fisier?:string}`. Numele este opțional, ignorat; niciun bucket. PDF brut base64, maximum 8 MiB decodați, început `%PDF`. Fără imagini directe/data URL. Doar owner sau magazie editor/admin + gestionar activ și valabil pe proiectul și depozitul exact, citit integral prin caller JWT/RLS. Schema E2a interzice gestionar cu depozit NULL. Ziua verificării: Europe/Bucharest; luna contabilă: UTC.

200: `{success:true, tip:'aviz_e3', sablon, antet, randuri, totaluri_tiparite:{total_metri,total_kg}, avertismente:string[], model, cost_usd, plafon:{cheie,luna,plafon_usd,consumat_usd,rezervat_usd}}`.

Antet comun: `furnizor,furnizor_cif,nr_document,data_document,observatii`. Aviz: `cumparator,transport_nr,nume_proiect,lot,loc_livrare,data_incarcare,data_descarcare,nr_camion,total_m,total_kg`. Curbe: `factura,importator,destinatar,referinta_client,referinta_furnizor,placa_camion_container,total_bucati,total_pachete,total_net_kg,total_brut_kg`.

Rând: `serie,sarja,lot,specificatie,standard,dimensiune,grad_otel,izolatie,cod,item,pachet_nr,dimensiuni_cm,motiv,observatie,nr_crt,lungime_doc,greutate_kg,perete_mm,diametru_mm,unghi_doc,cantitate,net_kg,brut_kg,pagina`. Text trim sau null; câmpuri numerice număr finit sau null. Serii/coduri primite numeric nu sunt convertite în text, deoarece zerourile pierdute nu pot fi recuperate. `lungime_doc` este în metri; fără conversie dedusă din alte unități. Cheile necunoscute și toate măsurătorile/decizia/`bucata_id` sunt eliminate. Totaluri exclusiv tipărite, fără însumare. API `lista_curbe` corespunde editorului `lista_ambalare_curbe`; frontend-ul va face această mapare. Datele sunt propuneri care necesită verificare umană.

Erori: `{success:false,eroare}`; 400 cerere invalidă, 403 `fara_drept`, 413 `pdf_prea_mare`, 422 PDF/AI invalid, refuz/trunchiere sau `pdf_prea_multi_tokeni`, 429 `plafon_depasit` cu `plafon`, 502 apel/transport AI, 503 configurare/registru indisponibil; 405 metodă incorectă. Fără retry automat.

## Cost și migrare

Model fix Haiku 5.5, max_tokens=10400. Rezervă conservatoare $0.05 calculată cu tarifele superioare din `haiku55.ts` și maximum 48000 tokeni de intrare. Limita în octeți a PDF-ului NU garantează limita de tokeni: după rezervare se apelează `/v1/messages/count_tokens` cu întregul prompt/document; lipsa numărării blochează generarea. Peste 48000 tokeni nu se face apelul plătit și se decontează zero. Nu se folosește cache. Reviewerul trebuie să confirme compatibilitatea endpointului de numărare cu modelul/PDF-ul; nu a fost apelat aici. Timeout numărare 30s, generare 90s.

Cheie `izo_e3_ocr:<proiect_id>`, plafon implicit $10/lună UTC. Funcțiile SQL serializează rezervările și decontările prin row locks, păstrează plafonul existent, decontează o singură dată în luna rezervării și rotunjesc conservator la microdolar. Cost necunoscut => rezervă consumată integral, `pastrat`; eroare de decontare => rezervă rămasă blocată, fără retry automat. `cost_usd` este costul raportat de usage sau rezerva întreagă dacă usage lipsește; registrul rotunjește în sus la 6 zecimale. Service role se folosește exclusiv pentru registrul generic. SELECT authenticated doar owner, cu helperul existent `egress_este_owner`, dacă există. Revenirea necesită armare explicită și oprește rezervările, păstrând datele și decontarea apelurilor deja în zbor.

## Verificare și limite

14 teste trecute offline sub Node 24.20.0, cu `globalThis.Deno.test` legat de `node:test`; importurile `.ts` se execută nativ, importul Supabase de tip este eliminat. Inclusiv paritate cu editorul real, 8 MiB/semnătură PDF, zerouri/virgulă, gunoi AI, drepturi RLS simulate, refuz plafon, timeout, cost necunoscut și eșec de decontare fără retry. Transportul este fals în toate testele; nu s-au citit credențiale și nu s-au făcut cereri externe.

Comandă PowerShell de reproducere din rădăcina repo:

```powershell
@'
import { test } from 'node:test';
globalThis.Deno = { test };
await import('./supabase/functions/ocr-packing-list/avizE3_test.ts');
await import('./supabase/functions/ocr-packing-list/avizE3Handler_test.ts');
'@ | & 'C:/Program Files/nodejs/node.exe' --input-type=module
```

Deno nu este disponibil în PATH; nu s-a executat Deno/typecheck. Pentru reviewer: `deno test -A --node-modules-dir=none supabase/functions/ocr-packing-list`. Testul SQL este scris, NEEXECUTAT: necesită PostgreSQL 16 local după migrare, include ACL, prag exact, refuz, cost necunoscut, idempotență, NaN și ID inexistent; scenariul de concurență în două conexiuni este descris la final. Nu s-au rulat migrarea, revenirea, API real, build/deploy sau Git.

## Revenire (observația Jak r1)
`supabase/revenire/20261105a_ai_plafon_lunar_ROLLBACK.sql` e o retragere conservatoare: oprește rezervările noi, dar păstrează tabelele, politicile și decontarea (audit + apeluri în zbor). Reactivarea NU se face reaplicând 20261105a (tabelele există deja), ci cu o migrare nouă care reface doar GRANT-urile / funcția de rezervare.
