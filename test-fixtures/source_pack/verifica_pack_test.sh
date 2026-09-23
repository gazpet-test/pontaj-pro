#!/bin/sh
# Test repetabil, fără AI, pentru worker/claude-cli/verifica_pack.mjs (P0b). Rulează: sh test-fixtures/source_pack/verifica_pack_test.sh
# Verifică: verdict per cerință în locator (pagina/document), pagina_declarata + pagina_validata la corecție, intervalul ⟦PAGINA a-b⟧,
# respingerea excerptului inexistent, identitatea din argumente (nu din model), sha256/size_bytes pe /data, problema de schemă fără LIC_ID.
set -u
cd "$(dirname "$0")/../.."
T=$(mktemp -d); mkdir -p "$T/text/doc" "$T/data/doc"
printf 'Contract pentru retea gaze.\n⟦PAGINA 1⟧\nGarantia de participare este de 292.641,99 lei si se constituie prin virament.\n⟦PAGINA 2⟧\nDurata de executie este de maximum 36 de luni de la ordinul de incepere.\n⟦PAGINA 3-5⟧\nOfertantul trebuie sa dovedeasca o forma de inregistrare legala in conditiile legii.\n⟦PAGINA 6⟧\nAltceva fara legatura.\n' > "$T/text/doc/fisa.pdf.txt"
echo "PDFBYTES-fisa" > "$T/data/doc/fisa.pdf"
cat > "$T/pack.md" <<'JSON'
{"schema":"gazpet.source_pack/v1","licitatie":{"nr_anunt":"ALT-NR"},"reader":{"model":"test"},
"documente":[{"nume_fisier":"doc/fisa.pdf","seap_cod":null,"pagini":6,"citit":"integral"},{"nume_fisier":"doc/lipsa.pdf","citit":"deloc"}],
"cerinte":[
{"ref":"REQ-001","text":"Garantia","tip":"forma","cand_se_prezinta":"la_depunere","locator":{"nume_fisier":"doc/fisa.pdf","pagina":1,"excerpt":"Garantia de participare este de 292.641,99 lei"}},
{"ref":"REQ-002","text":"Durata","tip":"contractuala","cand_se_prezinta":"in_executie","locator":{"nume_fisier":"doc/fisa.pdf","pagina":9,"excerpt":"Durata de executie este de maximum 36 de luni"}},
{"ref":"REQ-003","text":"Inregistrare","tip":"eliminatorie","cand_se_prezinta":"DUAE","locator":{"nume_fisier":"doc/fisa.pdf","pagina":4,"excerpt":"forma de inregistrare legala in conditiile legii"}},
{"ref":"REQ-004","text":"Inregistrare, pagina gresita","tip":"eliminatorie","cand_se_prezinta":"DUAE","locator":{"nume_fisier":"doc/fisa.pdf","pagina":1,"excerpt":"Ofertantul trebuie sa dovedeasca o forma de inregistrare"}},
{"ref":"REQ-005","text":"Inventat","tip":"forma","cand_se_prezinta":"la_depunere","locator":{"nume_fisier":"doc/fisa.pdf","pagina":2,"excerpt":"acest text nu exista nicaieri in document"}}
],"solicitari":[],"erate":[],"participanti":[],"nereusite":[],"observatii_siguranta":[],"extensii_propuse":[]}
JSON
node worker/claude-cli/verifica_pack.mjs "$T/pack.md" "$T/text" "$T/out.json" --licitatie-id 3 --nr-anunt DF1278266 --data-dir "$T/data" --rulare '{"stamp":"t","model":"sonnet","ture":5,"cost_usd_estimat":0.1,"durata_s":42}' > "$T/raport.txt"; C=$?
node -e '
const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const L=Object.fromEntries(p.cerinte.map(c=>[c.ref,c.locator]))
const ok=(cond,msg)=>{ if(!cond){ console.error("FAIL: "+msg); process.exit(1) } console.log("ok  "+msg) }
ok(p.licitatie.licitatie_id===3 && p.licitatie.nr_anunt==="DF1278266" && p.licitatie.nr_anunt_model==="ALT-NR","identitatea vine din argumente; ce a zis modelul rămâne ca nr_anunt_model")
ok(L["REQ-001"].verificat==="pagina" && L["REQ-001"].pagina_validata===1,"REQ-001 găsit pe pagina declarată")
ok(L["REQ-002"].verificat==="document" && L["REQ-002"].pagina_declarata===9 && L["REQ-002"].pagina===2 && L["REQ-002"].pagina_validata===2,"REQ-002 pagina corectată 9→2, pagina_declarata păstrată")
ok(L["REQ-003"].verificat==="interval" && L["REQ-003"].pagina===null && L["REQ-003"].pagina_declarata===4 && !("pagina_validata" in L["REQ-003"]) && JSON.stringify(L["REQ-003"].pagina_interval)==="[3,5]","REQ-003 declarat 4 în ⟦PAGINA 3-5⟧: verificat=interval, pagina null, pagina_interval [3,5]")
ok(L["REQ-004"].verificat==="interval" && L["REQ-004"].pagina===null && L["REQ-004"].pagina_declarata===1 && JSON.stringify(L["REQ-004"].pagina_interval)==="[3,5]","REQ-004 declarat 1, găsit în intervalul 3-5: pagina_declarata păstrată, pagina null")
ok(!p.cerinte.find(c=>c.ref==="REQ-005") && p.nereusite.some(n=>/REQ-005/.test(n.motiv)),"REQ-005 respins → nereusite")
ok(!p.cerinte.some(c=>"verificat" in c || "pagina_declarata" in c),"fără câmpuri top-level vechi")
ok(p.documente[0].sha256 && p.documente[0].size_bytes===14 && p.documente[1].lipsa_in_data===true,"sha256 + size_bytes pe /data; fișier lipsă marcat")
ok(p.rulare.ture===5 && p.validare.validator==="verifica_pack.mjs/3" && p.validare.cerinte_ok_interval===2 && p.validare.probleme_schema.length===0,"rulare + validare")
' "$T/out.json"
[ "$C" -eq 0 ] || { echo "FAIL: exit $C"; exit 1; }
C2=0; node worker/claude-cli/verifica_pack.mjs "$T/pack.md" "$T/text" "$T/out2.json" --licitatie-id "" > /dev/null || C2=$?
[ "$C2" -eq 3 ] && echo "ok  fără LIC_ID → exit 3 (problemă de schemă)" || { echo "FAIL: fără LIC_ID exit $C2"; exit 1; }
cat "$T/raport.txt"; rm -rf "$T"; echo "TOATE TESTELE AU TRECUT"
