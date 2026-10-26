# CDX - reducerea consumului Tuya

Implementare locala, 26.10.2026. Fara commit/push, conform instructiunii de la inceputul cererii si AGENTS.md; fraza contradictorie din brief despre commit nu a fost executata.

## Modificari

- `supabase/functions/tuya/index.ts`: catalog local intre liste; liste si status camere la minimum 6 ore; dispozitive inactive sarite. Dedup dispozitive intre uid-uri. Lista manuala foloseste acelasi cache si persista descoperirile pentru sync. Online-ul din lista se salveaza fara a improspata `citit_la` pentru camera necitita.
- Intervalele sunt rezervate inainte de API in `iot_integrari.config.lista_tuya_la` si `status_camere_tuya_la`. UPDATE conditionat pe config-ul citit (compare-and-set JSONB) impiedica doua executii sa rezerve acelasi interval. Erorile de listare/status nu provoaca repetari la fiecare 10 minute. O rezervare pierduta concurent intoarce 409; urmatorul sync foloseste catalogul.
- Dispozitive existente: UPDATE cu WHERE id si activ=true. Descoperiri: INSERT prin upsert cu ignoreDuplicates; un conflict nu reactiveaza dispozitivul. Codul nu scrie coloana activ, inclusiv pentru 279, 280, 281, 283.
- `lumini_edge.ts`: tick fara program activ+aprobat si fara pauza manuala activa => `rezultat: 'nimic de facut'`, zero apeluri Tuya. Lease-ul este eliberat. Convergenta, rolurile, limitele numerice si jurnalul existent raman.
- Adaptor comun: contor `apeluri_tuya`, inclusiv tokenul si cererile esuate; blocare pentru restul executiei dupa cota. Recunoaste codul 28841004 si mesaje explicite de quota/resource exhausted/insufficient balance/payment/subscription expired pentru alte coduri. Nu presupune ca orice cod de permisiune este cota.
- Alerta comuna sync/tick/comanda/stream: titlu stabil `Tuya: cota API epuizata`; codul apare in mesaj, impreuna cu alimentare cont / pachet resurse. `iot_alerta` trimite catre owner conform implementarii existente. Citirea notifications pe 24h extinde dedup-ul RPC existent de 12h; rezervarea atomica `config.cota_alerta_tuya_la` pe 10 minute impiedica duplicatele concurente. La eroare explicita RPC, rezervarea se retrage conditionat.
- Transportul Tuya este serializat per cerere Edge, astfel incat primul refuz de cota opreste efectiv urmatoarele apeluri, inclusiv POST/recitiri deja puse in coada. Revalidam bugetul imediat inainte de POST; OFF care depaseste bugetul ramane amanat si jurnalizat.
- `scripts/test_lumini_node.mjs`: extensie a mock-ului existent; teste prin handlerul real index.ts, import npm si gazda Deno inlocuite exclusiv local. Testul vechi al tokenului are acum un program aprobat fara dispozitive, pentru a exercita calea activa.

## Apeluri/zi: estimare, nu masuratoare

Brief: sync ~27 x 144 = 3.888, plus lumini 7 x 288 = 2.016 statusuri, total ~5.904. Daca includem si cate un token per tick activ, totalul devine ~6.192. Codul initial foloseste iot-03 numai ca fallback cand listele uid sunt goale, nu obligatoriu in plus fata de trei liste reusite; cifrele din brief sunt aproximative.

Dupa, presupunand cele 22 dispozitive din brief, dintre care 4 inactive, notam C = camere active si L = apeluri de lista per lot (uzual 3, maximum 4 pentru trei uid-uri si fallback). Sync = 144 tokenuri + 144 x (18-C) statusuri non-camera + 4 x C statusuri camera + 4 x L liste = **2.736 - 140 x C + 4 x L apeluri/zi**. Exemplu strict ipotetic C=6: 1.908-1.912/zi. Nu cunosc numarul real C fara acces la date; nu il prezint ca masurat.

Tick fara programe aprobate si fara pauze active: **0/zi**. Cu programe aprobate, chiar in afara ferestrei orare: citirile conservatoare raman; pentru 7 lumini, aproximativ 2.304/zi incluzand tokenul, plus POST/recitiri. Streamingul, comenzile manuale si erorile de retea nu intra in estimare.

## Verificari

- `node --test scripts/test_lumini_node.mjs`: **53/53 trecute**, Node 24.20.0, fara retea. Acopera pragul exact de 6h, camere, online fara status, erori status, catalog dupa lista manuala, toate cele patru camere inactive, lipsa aprobarii, pauze, dedup 24h inclusiv concurenta si oprire la cota in token/lista/status/POST. Include revalidarea bugetului OFF dupa asteptarea in transport, expirarea rezervarii de alerta abandonate si reincercarea dupa eroare RPC.
- `node --check` pentru index.ts, lumini_edge.ts, lumini_logica.ts: **trecute**. Acesta verifica sintaxa, nu tipurile Deno.
- `npx --no-install vite build` si `npx --no-install vitest run src`, cu npm offline si cache in worktree: **nu au pornit**, npm esueaza cu `uv_os_homedir returned ENOMEM`. Worktree-ul nu are nici node_modules; nu am instalat dependente si nu am modificat lockfile-ul. Nu declar build/vitest trecute.
- Deno indisponibil. Tuya real, browser, PostgREST/BD real: **nerulate**, conform limitelor cererii. Filtrul JSONB pentru compare-and-set si query-urile noi trebuie verificate ulterior prin PostgREST real de echipa autorizata.

## Limite pentru review

Serializarea transportului poate creste durata tick-ului si numarul OFF amanate cand Tuya raspunde lent; limitele de timp si rotirea OFF raman active. Nu am validat latenta reala. Rezervarile de 6h supravietuiesc unui worker intrerupt, deci pot amana descoperirea/citirea pana la urmatorul interval. Rezervarea alertei si INSERT-ul facut de RPC nu sunt o singura tranzactie: daca workerul moare intre ele, alerta asteapta expirarea rezervarii de 10 minute si o noua executie. Alte coduri numerice de cota fara un mesaj recunoscut necesita completarea clasificarii dupa raspunsul real, fara a ghici coduri.

Nu am schimbat schema, RPC-uri sau migrari; 20261113a ramane neatinsa. Nu este necesara o coloana/tabela noua pentru implementarea curenta.

## Fisa de securitate a-e

a. Surse: doar fisiere din worktree si raspunsuri mock; nimic extern citit, nici secrete reale. Continutul extern nu a fost folosit drept autoritate.

b. Scrieri la rularea viitoare: notifications numai prin iot_alerta existent; iot_integrari config/stare; iot_dispozitive metadate/citiri; iot_citiri si mecanismele runtime/jurnal lumini existente. In aceasta sesiune s-au scris doar fisiere locale din worktree.

c. iot_dispozitive.activ: **nu se scrie**. Inactivele nu primesc status/update, iar conflictele de inserare sunt ignorate. Nicio schimbare de drepturi, roluri sau is_owner.

d. Service_role: exact clientul existent al functiei; aceleasi porti de autentificare/autorizare, fara secrete adaugate sau citite de agent.

e. Fara Git, deploy, BD, mailuri, comenzi Tuya reale, dependente noi sau fisiere protejate modificate. Livrarea este pentru verificarea si publicarea ulterioara de catre Claude/owner.
