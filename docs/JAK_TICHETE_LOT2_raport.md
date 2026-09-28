# Raport JAK_TICHETE_LOT2 — 28.09.2026

## Modificări

- **A1 / TKT-2026-0291 — `src/Achizitii.jsx`:** `ComandaDetailModal` are anulare cu motiv de minimum 5 caractere și editor de antet. `actions.anuleazaEmisa`, `salveazaAntet`, `actualizeazaEmisa` verifică dreptul existent, statusul și recepțiile. UPDATE-ul filtrează atomic după ID, status, recepții nule și `updated_at`; lipsa unui rând returnat produce eroare, nu succes fals. Motivul se adaugă deasupra observațiilor, cu data și numele profilului. PDF-ul și triggerul existent rămân în fluxul lor actual.
- **A2 / TKT-2026-0199 — `src/Achizitii.jsx`:** `numarExcel`, `repereDinExcel`, `ComandaFormModal`: import XLSX/XLS/CSV din prima foaie, antet în primele 10 rânduri, numere românești/native, previzualizare și adăugare locală. Rândurile complet goale se ignoră; peste 300 de rânduri necomplet goale se refuză explicit, fără trunchiere. Denumirea/cantitatea invalide și prețurile necifrice/negative sunt excluse. Prețul gol rămâne opțional. Șablon XLSX descărcabil.
- **C1 / TKT-2026-0077 — `src/ContracteTertiTab.jsx`:** `CAT_INFO`, `ContractModal`, lista și detaliul includ Comodat; valoarea poate fi goală/zero. Tipul se sincronizează pentru furnizare/prestări/comodat; la trecerea din comodat la o categorie fără corespondent de tip se folosește `prestari_servicii`. Migrare `20260928j_contracte_comodat.sql` și rollback cu refuz explicit dacă există comodate.
- **C2 / TKT-2026-0215 — `src/ContracteTertiTab.jsx`:** `ContractModal`, `valoriContract`, `fmtVal`, detaliu: mod total/tarif, validare, monedă/unitate/descriere, afișare tarif în lipsa totalului. La salvare se păstrează alternativa selectată (explicat în formular); schimbarea comutatorului păstrează temporar câmpurile pentru revenire înainte de salvare. Sincronizarea existentă spre Execuție folosește valorile totale efectiv salvate, fără a transforma tariful în total. Migrare `20260928j_contracte_tarif.sql` și rollback care refuză ștergerea coloanelor cu date de tarif.
- **B1 / TKT-2026-0074 — `src/ServiceTab.jsx`, numai `NewFisaModal` și `GrupAccordion`:** istoricul paginat al activului, ordonat după data lucrării și ID, include cantitatea și intrările fără cod. Precompletarea folosește ultima intrare per denumire normalizată, numai în grupa cerută și pentru preseturi aplicabile. Cantitatea lipsă folosește implicitul, convertit la text pentru salvarea existentă. Grupa se deschide cu mesajul cerut. Răspunsurile vechi sunt ignorate; schimbarea activului golește selecțiile și piesele extra, schimbarea tipului scoate selecțiile automate. Re-randările nu suprascriu editările/debifările manuale.

## Verificări și limite

- Parsare JSX cu `@babel/parser`: toate cele trei fișiere sunt valide.
- Testele locale de regresie de mai jos execută funcțiile și callback-urile din sursele reale, cu DB și hook-uri simulate; fără acces la rețea. **5/5 scenarii trecute**, inclusiv importul în memorie în cele trei formate, concurența la UPDATE și ciclul hook-urilor de precompletare.
- `npx vite build`: **blocat** înaintea compilării, la încărcarea configurației Vite: `Error: spawn EPERM` în `esbuild.ensureServiceIsRunning`.
- `npx vitest run`: **blocat** de aceeași eroare la pornire; nu declar suita trecută.
- Nu am aplicat migrări și nu am validat pe Postgres/PostgREST real. `psql` nu este disponibil în PATH. Nu am rulat git, deploy sau operații în producție.
- Filtrele A1 sunt evaluate de server pentru acest UPDATE; nu constituie o politică globală nouă pentru toate clientele. Nu am modificat RLS/RPC-uri/triggere. Cele două date de recepție sunt poarta cerută: o cantitate parțial primită pe linii, fără aceste date, nu blochează suplimentar operația.
- Cele patru fișiere SQL sunt pentru aplicare **manuală selectivă** după review; fișierele `_ROLLBACK.sql` nu se aplică împreună cu migrările înainte.

## De testat de om / Claude înainte de producție

1. Aplicare și rollback pe Postgres local cu schema reală; rollback comodat cu/fără rânduri comodat; rollback tarif cu/fără date. Verificarea constrângerilor existente pe `categorie` și a view-ului `v_contract_efecte_acte` pentru contracte fără total.
2. A1 prin PostgREST cu utilizator autorizat: fiecare status permis, fiecare semnătură de recepție, concurență pe `updated_at`, motiv și observații vechi, arhivare și recalcularea cererii interne prin trigger. Verificare PDF emis păstrat.
3. A2 în browser: fișiere reale XLSX/XLS/CSV, antet deplasat, rânduri roșii, adăugare peste repere existente, renunțare și descărcare șablon.
4. Contract nou/editare: comodat fără valoare, tarif RON/EUR, trecere total↔tarif, listă/filtre/detaliu și sincronizarea Execuție.
5. Service în browser/API: activ cu/fără istoric, cod lipsă, preseturi aplicabile, cantități, schimbări rapide de activ/tip, editare/debifare și salvarea fișei precompletate.
6. Reluarea `npx vite build` și `npx vitest run` într-un mediu care permite pornirea esbuild.

## Teste reproductibile fără fișiere suplimentare

Pentru a respecta limita la fișierele numite în specificație, testele sunt incluse în acest raport. Din rădăcina proiectului:

```powershell
@'
const fs = require('node:fs');
const text = fs.readFileSync('docs/JAK_TICHETE_LOT2_raport.md', 'utf8');
const code = text.split('```javascript\n')[1].split('\n```')[0];
eval(code);
'@ | node
```

```javascript
const assert = require('node:assert/strict');
const vm = require('node:vm');
const parser = require('@babel/parser');
const XLSX = require('xlsx-js-style');
const files = Object.fromEntries(['Achizitii', 'ContracteTertiTab', 'ServiceTab'].map(n => {
  const source = fs.readFileSync(`src/${n}.jsx`, 'utf8');
  return [n, { source, ast:parser.parse(source, { sourceType:'module', plugins:['jsx'] }) }];
}));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const plain = x => JSON.parse(JSON.stringify(x));
function walk(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const v of Object.values(node)) {
    const found = Array.isArray(v) ? v.map(x => walk(x, predicate)).find(Boolean) : walk(v, predicate);
    if (found) return found;
  }
  return null;
}
function declaration(file, name) {
  const f = files[file];
  const node = walk(f.ast, n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (node) return f.source.slice(node.start, node.end);
  const d = walk(f.ast, n => n.type === 'VariableDeclarator' && n.id?.name === name);
  assert.ok(d, name);
  return `const ${f.source.slice(d.start, d.end)};`;
}
function context(file, names, extra = {}) {
  const c = vm.createContext({ console, ...extra });
  vm.runInContext(names.map(n => declaration(file, n)).join('\n'), c);
  return c;
}
// Execută corpul componentei până la return-ul JSX. Hook-urile de test păstrează
// starea, dependențele și cleanup-ul; nu simulează DOM-ul sau rendererul React.
function hooks(file, name, exposed, props, extra) {
  const c = vm.createContext({ console, G:{}, ...extra });
  const f = files[file], node = walk(f.ast, n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  const ret = node.body.body.findLast(n => n.type === 'ReturnStatement');
  const slots = []; let index = 0, pending = [], dirty = true, result;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  c.useState = initial => {
    const i = index++;
    if (!(i in slots)) slots[i] = { value:typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, v => { const next = typeof v === 'function' ? v(slots[i].value) : v; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
  };
  c.useRef = initial => { const i=index++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; };
  c.useMemo = (fn, deps) => { const i=index++; if (!slots[i] || changed(slots[i].deps,deps)) slots[i]={deps,value:fn()}; return slots[i].value; };
  c.useEffect = (fn, deps) => {
    const i=index++; if (!slots[i] || changed(slots[i].deps,deps)) {
      const old=slots[i]; slots[i]={deps}; pending.push(() => { old?.cleanup?.(); slots[i].cleanup=fn(); });
    }
  };
  vm.runInContext(f.source.slice(node.start, ret.start) + `return {${exposed}}; }`, c);
  const render = () => { index=0; dirty=false; result=c[name](props); const work=pending; pending=[]; work.forEach(fn=>fn()); };
  return {
    get value() { return result; }, context:c,
    async flush() { for(let i=0;i<30;i++) { if(dirty) render(); await Promise.resolve(); } assert.equal(dirty,false,'hook-uri instabile'); return result; },
    rerender() { dirty=true; },
  };
}
const excel = context('Achizitii', ['numarExcel','repereDinExcel']);
test('A2: numere românești/native, antet normalizat/deplasat, rânduri invalide', () => {
  for (const x of ['1.234,56','1234,56','1234.56',1234.56]) assert.equal(excel.numarExcel(x),1234.56);
  assert.ok(Number.isNaN(excel.numarExcel('12abc')));
  assert.equal(excel.numarExcel(''),null);
  const r=excel.repereDinExcel([['Titlu'],[' D E N U M I R E ','U.M.','QTY','PREȚ UNITAR','SPECIFICAȚII'],['Țeavă','ml','1.234,56','2,50','PEHD'],['','buc',1],['Filtru','buc',0],['Ulei','l','abc'],['Piesă','buc',''],['A','buc',1,'bad']]);
  assert.equal(r[0].cantitate,1234.56); assert.equal(r[0].pret_unitar,2.5); assert.equal(r[0].observatii,'PEHD');
  assert.equal(r.filter(x=>!x.erori.length).length,1);
  assert.throws(()=>excel.repereDinExcel([['fără antet']]),/capul de tabel/);
  assert.throws(()=>excel.repereDinExcel([...Array(10).fill([]),['Denumire','Cantitate'],['A',1]]),/capul de tabel/);
  assert.equal(excel.repereDinExcel([['Material','Cant'],...Array(300).fill(['A',1])]).length,300);
  assert.throws(()=>excel.repereDinExcel([['Material','Cant'],...Array(301).fill(['A',1])]),/300/);
});
test('A2: citire XLSX/XLS/CSV și adăugare locală peste liniile existente', async () => {
  const c=context('Achizitii',['uniq8','LINIE_GOALA','numarExcel','repereDinExcel','PRAG_APROBARE_LEI']);
  const extras=vm.runInContext('({uniq8,LINIE_GOALA,numarExcel,repereDinExcel,PRAG_APROBARE_LEI})',c);
  const h=hooks('Achizitii','ComandaFormModal','linii,importRows,importaExcel,adaugaImport',{
    comanda:{id:1,linii:[{denumire:'Existent',cantitate:2}]},showToast:msg=>{throw new Error(msg)},
  },{...extras,XLSX,CURS_EUR_APROX:5,supabase:{from(){throw new Error('Importul nu trebuie să scrie în DB')}}});
  await h.flush();
  for(const type of ['xlsx','xls','csv']) {
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Denumire','Cantitate','Preț unitar'],['Importat','1.234,56','2,5'],['Invalid',0]]),'Prima');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Ignoră']]),'A doua');
    const bytes=XLSX.write(wb,{type:'buffer',bookType:type==='xls'?'biff8':type});
    await h.value.importaExcel({target:{files:[{name:`test.${type}`,arrayBuffer:async()=>bytes}],value:'test'}}); await h.flush();
    assert.equal(h.value.importRows[0].cantitate,1234.56);
    h.value.adaugaImport(); await h.flush();
  }
  assert.equal(h.value.linii.length,4); assert.equal(h.value.linii[0].denumire,'Existent');
  assert.equal(h.value.linii[3].pret_unitar,2.5);
});
test('A1: eligibilitate, concurență, antet permis, motiv și păstrarea observațiilor', async () => {
  const calls=[], messages=[]; let payload, filters, dbRow=true, reloads=0;
  const c=vm.createContext({canCreate:true,profile:{id:9,name:'Răzvan'},profilesMap:{9:'Răzvan'},setBusy:()=>{},showToast:m=>messages.push(m),loadAll:async()=>{reloads++}});
  c.supabase={from(table){assert.equal(table,'comenzi_furnizor');calls.push(table);filters=[];return {update(p){payload=p;return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},select(){return this},async maybeSingle(){return {data:dbRow?{id:1}:null,error:null}}}}};
  c.actions={};
  for(const name of ['actualizeazaEmisa','salveazaAntet','anuleazaEmisa']) {
    const n=walk(files.Achizitii.ast,n=>n.type==='ObjectProperty'&&n.key?.name===name);
    c.actions[name]=vm.runInContext(`(${files.Achizitii.source.slice(n.value.start,n.value.end)})`,c);
  }
  const base={id:1,status:'emisa',updated_at:'2026-09-28T08:00:00Z',observatii:'Observații vechi'};
  for(const status of ['emisa','in_tranzit','ajunsa']) assert.equal(await c.actions.anuleazaEmisa({...base,status},'Livrare anulată'),true);
  assert.equal(payload.status,'anulata'); assert.match(payload.observatii,/^\[ANULATĂ \d{2}\.\d{2}\.\d{4} de Răzvan: Livrare anulată\]\nObservații vechi$/);
  assert.ok(filters.some(([k,v])=>k==='updated_at'&&v===base.updated_at));
  for(const key of ['receptie_mp_la','receptie_achizitii_la']) {assert.ok(filters.some(([k,v])=>k===key&&v===null));assert.equal(await c.actions.anuleazaEmisa({...base,[key]:'semnat'},'Motiv valid'),false)}
  for(const status of ['draft','in_stoc','receptionata','anulata']) assert.equal(await c.actions.anuleazaEmisa({...base,status},'Motiv valid'),false);
  c.canCreate=false; assert.equal(await c.actions.anuleazaEmisa(base,'Motiv valid'),false); c.canCreate=true;
  assert.equal(await c.actions.anuleazaEmisa(base,'  ab  '),false);
  const form={persoana_contact:' Ion ',telefon_contact:' 07 ',livrare_tip:'sediu',livrare_site_id:10,data_livrare_estimata:'2026-10-01',observatii:'Nou',numar_comanda:'NEPERMIS'};
  assert.equal(await c.actions.salveazaAntet(base,form),true); assert.equal(payload.livrare_site_id,null); assert.equal(payload.persoana_contact,'Ion'); assert.equal(payload.numar_comanda,undefined);
  const before=calls.length; assert.equal(await c.actions.salveazaAntet(base,{...form,livrare_tip:'santier',livrare_site_id:''}),false);assert.equal(calls.length,before);
  dbRow=false; const reloadBefore=reloads; assert.equal(await c.actions.anuleazaEmisa(base,'Motiv valid'),false);assert.equal(reloads,reloadBefore);assert.match(messages.at(-1),/între timp/);
});
test('C1/C2: comodat gol/zero; tarif valid, total prioritar, monedă/unitate, valori invalide', () => {
  const c=context('ContracteTertiTab',['TARIF_UNITATI','fmtLei','fmtEur','fmtVal','valoriContract']);
  const base={categorie:'comodat',valoare_lei:'',valoare_eur:''};
  assert.equal(c.valoriContract(base,'total').error,undefined);
  assert.equal(c.valoriContract({...base,valoare_lei:0},'total').payload.valoare_lei,0);
  assert.ok(c.valoriContract({...base,categorie:'prestari_servicii'},'total').error);
  const tarif={...base,categorie:'prestari_servicii',tarif_valoare:'500',tarif_unitate:'luna',tarif_moneda:'RON',tarif_descriere:' abonament '};
  const p=c.valoriContract(tarif,'tarif').payload;assert.equal(p.valoare_lei,null);assert.equal(p.tarif_valoare,500);assert.equal(p.tarif_descriere,'abonament');
  assert.equal(vm.runInContext('fmtVal',c)(p),'500 lei / lună');
  assert.equal(vm.runInContext('fmtVal',c)({...p,tarif_moneda:'EUR',tarif_unitate:'ora'}),'500 EUR / oră');
  assert.equal(vm.runInContext('fmtVal',c)({...p,valoare_actuala_lei:'0',valoare_lei:'0'}),'500 lei / lună');
  assert.ok(!vm.runInContext('fmtVal',c)({...p,valoare_lei:1000}).includes('/'));
  for(const bad of [{tarif_valoare:'abc'},{tarif_valoare:-1},{tarif_valoare:0},{tarif_moneda:'USD'},{tarif_unitate:'an'}]) assert.ok(c.valoriContract({...tarif,...bad},'tarif').error);
  assert.equal(c.valoriContract({...tarif,valoare_lei:1000},'total').payload.tarif_valoare,null);
});
test('B1: precompletare, lipsă cod/cantitate, debifare și editare manuală, reset activ/tip', async () => {
  const grupa='1. Mentenanță Periodică';
  const items=[{id:1,denumire:'Filtru ulei',grupa,cantitate_default:1},{id:2,denumire:'Ulei',grupa,cantitate_default:8},{id:3,denumire:'Frână',grupa:'2. Reparații'}];
  let saved=0; const inserted=[];
  const props={activPreset:10,active:[{id:10},{id:20},{id:30}],presetItems:items,onSaved:()=>saved++,showToast:(msg,kind)=>{if(kind==='error')throw new Error(msg)}};
  const deferred={}; const calls=[];
  const db={auth:{getUser:async()=>({data:{user:{id:9}}})},from(table){
    if(table==='logistica_service_fise')return {insert(){return this},select(){return this},single:async()=>({data:{id:99}})};
    if(table==='notifications')return {update(){return this},eq(){return this}};
    assert.equal(table,'logistica_service_intrari');
    let id;return {insert:async rows=>{inserted.push(...rows);return {}},select(s){assert.ok(s.includes('cantitate'));return this},eq(k,v){id=v;return this},order(){return this},range(){calls.push(id);return new Promise(resolve=>{deferred[id]=resolve})}}
  }};
  const norm=vm.runInContext('norm',context('ServiceTab',['norm']));
  const exposed='bife,expanded,precompletate,setActivId,setTip,handleBifa,handleBifaDetail,handleSave';
  const dependencies={supabase:db,norm,todayISO:()=> '2026-09-28',isApplicable:()=>true,confirmaCitiriBord:async()=>true};
  const h=hooks('ServiceTab','NewFisaModal',exposed,props,dependencies);
  await h.flush();
  deferred[10]({data:[{denumire:'FILTRU ULEI',cod_piesa:'NOU',cantitate:2},{denumire:'Filtru ulei',cod_piesa:'VECHI',cantitate:1},{denumire:'Ulei',cod_piesa:null,cantitate:null},{denumire:'Frână',cod_piesa:'X',cantitate:4}]});
  await h.flush();assert.equal(h.value.bife[1].cod_piesa,'NOU');assert.equal(h.value.bife[1].cantitate,'2');assert.equal(h.value.bife[2].cantitate,'8');assert.equal(h.value.bife[2].cod_piesa,'');assert.equal(h.value.bife[3],undefined);assert.equal(h.value.expanded[grupa],true);assert.equal(h.value.precompletate,2);
  await h.value.handleSave();await h.flush();assert.equal(saved,1);assert.equal(inserted.length,2);assert.equal(inserted[0].cantitate,'2');assert.equal(inserted[1].cantitate,'8');assert.equal(inserted[1].cod_piesa,null);
  h.value.handleBifa(1,false,items[0]);h.value.handleBifaDetail(2,'cantitate','12');await h.flush();
  props.presetItems=[...items];h.rerender();await h.flush();assert.equal(h.value.bife[1],undefined);assert.equal(h.value.bife[2].cantitate,'12');assert.equal(calls.length,1);
  h.value.handleBifa(3,true,items[2],'MANUAL');await h.flush();h.value.setTip('reparatie');await h.flush();assert.equal(h.value.bife[2],undefined);assert.equal(h.value.bife[3].cod_piesa,'MANUAL');
  h.value.setActivId('20');await h.flush();assert.deepEqual(plain(h.value.bife),{});
  h.value.setTip('mentenanta');h.value.setActivId('30');await h.flush();
  deferred[20]({data:[{denumire:'Ulei',cod_piesa:'ACTIV VECHI',cantitate:99}]});deferred[30]({data:[]});await h.flush();assert.deepEqual(plain(h.value.bife),{});
  const h2=hooks('ServiceTab','NewFisaModal',exposed,props,dependencies);await h2.flush();
  h2.value.handleBifa(1,true,items[0],'ALES DE OM');h2.value.handleBifaDetail(1,'cantitate','7');h2.value.handleBifa(2,false,items[1]);await h2.flush();
  deferred[10]({data:[{denumire:'Filtru ulei',cod_piesa:'ISTORIC',cantitate:99},{denumire:'Ulei',cod_piesa:'ISTORIC',cantitate:99}]});await h2.flush();
  assert.equal(h2.value.bife[1].cod_piesa,'ALES DE OM');assert.equal(h2.value.bife[1].cantitate,'7');assert.equal(h2.value.bife[2],undefined);
});
(async()=>{let failed=0;for(const [name,fn] of tests){try{await fn();console.log('OK',name)}catch(e){failed++;console.error('FAIL',name,e)}}console.log(`${tests.length-failed}/${tests.length} scenarii trecute; JSX valid în 3 fișiere.`);if(failed)process.exitCode=1;})();
```
