#!/bin/sh
# launcher — o rulare = un raport. Argument: numele sarcinii (fișier în /opt/prompts/<sarcina>.md). Implicit: lectura_licitatie.
# Garanții (condițiile Jakarinos 22.09.2026): fără cheie API, fără Bash/Edit/Write/Agent/Web, fără BD, fără mail,
# /data montat :ro, timeout + max-turns + stop la orice eroare; jurnal fără secrete.
set -u
TASK="${1:-lectura_licitatie}"
PROMPT_F="/opt/prompts/$TASK.md"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_MD="/out/${STAMP}_${TASK}.md"; OUT_JSON="/out/${STAMP}_${TASK}.json"; JURNAL="/out/jurnal.log"
START=$(date +%s)
J() { echo "$(date +%H:%M:%S) $*" | tee -a "$JURNAL" >&2; }
final() { # cod motiv
  DUR=$(( $(date +%s) - START ))
  J "FINAL task=$TASK cod=$1 motiv=$2 durata=${DUR}s raport=$OUT_MD"
  exit "$1"
}
# D4: fără pre-extragere/OCR. Verificarea manifestului precedă chiar autentificarea.
if [ "$TASK" = "plansa_felii" ]; then
  [ -f /data/manifest.json ] || { J "plansa_felii: /data/manifest.json lipsește"; final 2 manifest_lipsa; }
  TASK_MODEL=opus
  TURE_PLANSA=$(node -e 'const m=JSON.parse(require("fs").readFileSync("/data/manifest.json","utf8")); if(!Array.isArray(m.felii)||!m.felii.length||!Array.isArray(m.perechi_lipire))process.exit(2); console.log(12+4*m.felii.length+4*m.perechi_lipire.length)' 2>/dev/null) || final 2 manifest_invalid
  case "${TASK_MAX_TURNS:-}" in ''|*[!0-9]*) TASK_MAX_TURNS=$TURE_PLANSA ;; esac
  [ "$TASK_MAX_TURNS" -ge "$TURE_PLANSA" ] || TASK_MAX_TURNS=$TURE_PLANSA
  OUT_JSON="/out/${STAMP}_${TASK}.cli.json"
  OUT_MD="/work/${STAMP}_${TASK}.txt"
fi
# 1. identitate: DOAR abonament (token setup-token). Orice cheie API moștenită ar factura API de la început.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL 2>/dev/null
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { J "CLAUDE_CODE_OAUTH_TOKEN lipsește din .env"; final 2 fara_token; }
[ -f "$PROMPT_F" ] || { J "prompt necunoscut: $TASK"; final 2 prompt_lipsa; }
[ -d /data ] || { J "/data nu e montat"; final 2 fara_date; }
command -v claude >/dev/null || { J "claude CLI lipsește din imagine"; final 2 fara_cli; }
CLI_VERSION=$(claude --version 2>/dev/null | head -1)
J "START task=$TASK cli=$CLI_VERSION model=${TASK_MODEL:-sonnet} effort=${TASK_EFFORT:-medium} timeout=${TASK_TIMEOUT_MIN:-15}m max_turns=${TASK_MAX_TURNS:-20} lic_id=${LIC_ID:-} nr_anunt=${LIC_NR_ANUNT:-}"

# 2. pre-extragere text (agentul nu are Bash): PDF → text cu marcaje ⟦PAGINA n⟧ (același format ca ingest-ul Deno), DOCX → text brut.
if [ "$TASK" != "plansa_felii" ]; then
mkdir -p /work/text
N_PDF=0; N_DOCX=0; N_SARIT=0; MAX_FISIERE=300; MAX_MB=150
OCR_MAX_PAG=${OCR_MAX_PAG:-250}; OCR_PAG_FISIER=${OCR_PAG_FISIER:-60}; echo 0 > /work/.ocr_pag; : > /work/.ocr_md5
# text real = fără marcajele ⟦PAGINA n⟧ și fără spații
text_real() { sed "s/⟦PAGINA [0-9]*⟧//g" "$1" | tr -d "[:space:]" | wc -c; }
# OCR pentru PDF scanat: pdftoppm 200 dpi gri + tesseract ron; un singur OCR per conținut identic (md5); plafon total de pagini
ocr_pdf() { # $1 pdf  $2 dest
  md=$(md5sum "$1" | cut -c1-32); if grep -q "$md" /work/.ocr_md5; then echo "dup"; return; fi
  # cache OCR pe /out (persistă între rulări): a treia rulare pe Mânăstirea a refăcut 434 pagini OCR (29 min) degeaba
  mkdir -p /out/.ocr_cache 2>/dev/null; if [ -s "/out/.ocr_cache/$md.txt" ]; then cp "/out/.ocr_cache/$md.txt" "$2"; echo "$md" >> /work/.ocr_md5; echo "ocr:cache"; return; fi
  fac=$(cat /work/.ocr_pag); rest=$((OCR_MAX_PAG - fac)); [ "$rest" -gt 0 ] || { echo "plafon"; return; }
  n=$OCR_PAG_FISIER; [ "$n" -gt "$rest" ] && n=$rest
  tot=$(pdfinfo "$1" 2>/dev/null | awk '/^Pages:/{print $2}'); [ -n "$tot" ] || tot=0; [ "$n" -gt "$tot" ] && n=$tot
  d=$(mktemp -d /tmp/ocr.XXXX); : > "$2"; k=0
  while [ "$k" -lt "$n" ]; do k=$((k+1))   # pagină cu pagină: /tmp e tmpfs mic
    pdftoppm -r 200 -gray -f "$k" -l "$k" -singlefile "$1" "$d/p" 2>/dev/null
    printf "\n⟦PAGINA %d⟧\n" "$k" >> "$2"; [ -f "$d/p.pgm" ] && tesseract "$d/p.pgm" - -l ron+eng --psm 1 2>/dev/null >> "$2"; rm -f "$d/p.pgm"
  done
  rm -rf "$d"; echo $((fac + k)) > /work/.ocr_pag; echo "$md" >> /work/.ocr_md5; [ "$k" -gt 0 ] && cp "$2" "/out/.ocr_cache/$md.txt" 2>/dev/null; echo "ocr:$k"; }
: > /work/INVENTAR.md
echo "# Inventar /data (generat de launcher, $STAMP)" >> /work/INVENTAR.md
echo "" >> /work/INVENTAR.md
echo "| fișier | MB | pagini | text |" >> /work/INVENTAR.md
echo "|---|---|---|---|" >> /work/INVENTAR.md
find /data -type f \( -iname '*.pdf' -o -iname '*.docx' \) | sort | head -n "$MAX_FISIERE" | while IFS= read -r f; do
  rel="${f#/data/}"; mb=$(( $(stat -c %s "$f") / 1048576 )); dest="/work/text/$rel.txt"; mkdir -p "$(dirname "$dest")"
  if [ "$mb" -gt "$MAX_MB" ]; then echo "| $rel | $mb | - | sărit (> ${MAX_MB} MB) |" >> /work/INVENTAR.md; continue; fi
  case "$f" in
    *.pdf|*.PDF)
      pg=$(pdfinfo "$f" 2>/dev/null | awk '/^Pages:/{print $2}'); [ -n "$pg" ] || pg='?'
      if pdftotext -layout "$f" - 2>/dev/null | awk 'BEGIN{p=1; printf "⟦PAGINA 1⟧\n"} { n=split($0, a, "\f"); for(i=1;i<=n;i++){ if(i>1){p++; printf "\n⟦PAGINA %d⟧\n", p} printf "%s", a[i] } printf "\n" }' > "$dest"; then
        if [ "$(text_real "$dest")" -lt 200 ]; then
          r=$(ocr_pdf "$f" "$dest")
          case "$r" in
            ocr:*) if [ "$(text_real "$dest")" -ge 200 ]; then echo "| $rel | $mb | $pg | text/$rel.txt (OCR ${r#ocr:}) |" >> /work/INVENTAR.md; else echo "| $rel | $mb | $pg | scanat, OCR fără rezultat |" >> /work/INVENTAR.md; rm -f "$dest"; fi ;;
            dup) echo "| $rel | $mb | $pg | scanat, identic cu un fișier deja citit prin OCR |" >> /work/INVENTAR.md; rm -f "$dest" ;;
            *) echo "| $rel | $mb | $pg | scanat, necitit (plafon OCR $OCR_MAX_PAG pag.) |" >> /work/INVENTAR.md; rm -f "$dest" ;;
          esac
        else echo "| $rel | $mb | $pg | text/$rel.txt |" >> /work/INVENTAR.md; fi
      else echo "| $rel | $mb | $pg | eroare pdftotext |" >> /work/INVENTAR.md; fi ;;
    *.docx|*.DOCX)
      if unzip -p "$f" word/document.xml 2>/dev/null | sed -e 's#</w:p>#\n#g' -e 's#<w:tab/>#\t#g' -e 's#<[^>]*>##g' > "$dest" && [ "$(wc -c < "$dest")" -gt 50 ]; then
        echo "| $rel | $mb | - | text/$rel.txt |" >> /work/INVENTAR.md; else echo "| $rel | $mb | - | docx necitibil |" >> /work/INVENTAR.md; fi ;;
  esac
done
find /data -type f ! \( -iname '*.pdf' -o -iname '*.docx' \) | sort | sed 's#^/data/#| #; s#$# | - | - | alt format (necitit) |#' >> /work/INVENTAR.md
TOTAL_FIS=$(find /data -type f | wc -l); TXT=$(find /work/text -type f | wc -l)
J "inventar: $TOTAL_FIS fișiere în /data, $TXT texte extrase, OCR $(cat /work/.ocr_pag) pag. (limită $MAX_FISIERE fișiere, $MAX_MB MB/fișier)"
[ "$TOTAL_FIS" -gt 0 ] || { J "STOP: /data e gol — LIC_FOLDER greșit? (docker creează un folder gol dacă ruta nu există)"; final 3 fara_fisiere; }
[ "$TXT" -gt 0 ] || { J "STOP: niciun text extras (doar scanări?)"; final 3 fara_text; }
if [ -d /context ] && [ -n "$(ls -A /context 2>/dev/null)" ]; then echo "" >> /work/INVENTAR.md; echo "Context suplimentar în /context: $(ls /context | tr '\n' ' ')" >> /work/INVENTAR.md; fi
fi

# 3. rularea agentului: doar Read/Glob/Grep, fără prompturi (dontAsk = orice ar cere aprobare e refuzat), fără subagenți, fără sesiune pe disc.
PROMPT="$(cat "$PROMPT_F")

Directoare: textele extrase sunt în /work/text (oglinda lui /data, cu ⟦PAGINA n⟧), originalele în /data (doar citire), inventarul în /work/INVENTAR.md, contextul opțional în /context$( [ -f /context/documente.json ] && echo " (documente.json = lista documentelor din ERP cu id, seap_cod, tip)" )."
if [ "$TASK" = "plansa_felii" ]; then
  PROMPT="$(cat "$PROMPT_F")

Pachetul este în /data: manifest.json, INSTRUCTIUNI.md, INSTRUCTIUNI_LIPIRE.md și felii/. Nu există text pre-extras. Răspunsul final JSON este salvat de launcher; tu nu scrii fișiere."
  # Înghețăm promptul efectiv și proveniența ÎNAINTE de CLI; modelul nu furnizează aceste metadate.
  PROMPT="$PROMPT

INSTRUCTIUNI:
$(cat /data/INSTRUCTIUNI.md)

INSTRUCTIUNI_LIPIRE:
$(cat /data/INSTRUCTIUNI_LIPIRE.md)"
  node -e '
    const fs=require("fs"), crypto=require("crypto"), sha=s=>crypto.createHash("sha256").update(s).digest("hex");
    try {
      const m=JSON.parse(fs.readFileSync("/data/manifest.json","utf8"));
      const a=sha(fs.readFileSync("/data/INSTRUCTIUNI.md","utf8").replace(/\n$/, ""));
      const b=sha(fs.readFileSync("/data/INSTRUCTIUNI_LIPIRE.md","utf8").replace(/\n$/, ""));
      const id=sha(JSON.stringify({doc_id:m.doc_id,taiat_la:m.taiat_la,felii:m.felii.map(({eticheta,sha256})=>({eticheta,sha256})),perechi_lipire:m.perechi_lipire,instructiuni_sha256:a,instructiuni_lipire_sha256:b}));
      if(id!==m.pachet_id || a!==m.instructiuni_sha256 || b!==m.instructiuni_lipire_sha256 || !process.argv[2]) process.exit(2);
      fs.writeFileSync("/work/plansa_provenienta.json", JSON.stringify({pachet_id:m.pachet_id,
        rulare:{prompt_sha256:sha(process.argv[1]),instructiuni_sha256:a,instructiuni_lipire_sha256:b,cli_version:process.argv[2]}}));
    } catch { process.exit(2); }
  ' "$PROMPT" "$CLI_VERSION" || final 2 pachet_invalid
fi
cd /work || final 2 fara_work
timeout -s TERM "$(( ${TASK_TIMEOUT_MIN:-15} * 60 ))" claude -p "$PROMPT" \
  --model "${TASK_MODEL:-sonnet}" --effort "${TASK_EFFORT:-medium}" \
  --tools "Read,Glob,Grep" \
  --disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit,Agent,Task,WebFetch,WebSearch,TodoWrite" \
  --permission-mode dontAsk --max-turns "${TASK_MAX_TURNS:-20}" --no-session-persistence \
  --add-dir /data /context --output-format json > "$OUT_JSON" 2> "/out/${STAMP}_${TASK}.stderr"
COD=$?
# 4. raportul + jurnalul (fără secrete): tokeni, cost API echivalent (estimare client), ture, motiv oprire
if [ -s "$OUT_JSON" ]; then
  node -e '
    const fs=require("fs"); let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch(e) { process.exit(3); }
    const r=(j.result||"").trim(); fs.writeFileSync(process.argv[2], r ? r+"\n" : "");
    const u=j.usage||{}; console.log(`turns=${j.num_turns??"?"} cost_usd_estimat=${j.total_cost_usd??"?"} in=${u.input_tokens??"?"} out=${u.output_tokens??"?"} cache_read=${u.cache_read_input_tokens??"?"} cache_create=${u.cache_creation_input_tokens??"?"} is_error=${j.is_error??"?"} subtype=${j.subtype??"?"} durata_api_ms=${j.duration_api_ms??"?"} denials=${(j.permission_denials||[]).length}`);
  ' "$OUT_JSON" "$OUT_MD" 2>/dev/null | while IFS= read -r l; do J "rezultat $l"; done
fi
[ "$COD" -eq 124 ] && final 124 timeout
[ "$COD" -ne 0 ] && final "$COD" claude_exit_$COD
[ -s "$OUT_MD" ] || final 5 raport_gol
if [ "$TASK" = "plansa_felii" ]; then
  PLANSA_JSON="/out/${STAMP}_plansa_felii.json"
  node -e '
    const fs=require("fs");
    try {
      const envelope=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(envelope.is_error || envelope.subtype!=="success") process.exit(4);
      const raw=fs.readFileSync(process.argv[2],"utf8").trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, "$1");
      const r=JSON.parse(raw), m=JSON.parse(fs.readFileSync("/data/manifest.json","utf8"));
      if(r.doc_id!==m.doc_id || r.taiat_la!==m.taiat_la || !r.felii || Array.isArray(r.felii) || typeof r.felii!=="object" || !r.lipiri || Array.isArray(r.lipiri) || typeof r.lipiri!=="object") process.exit(4);
      for(const [et,f] of Object.entries(r.felii)) {
        const mf=m.felii.find(x=>x.eticheta===et);
        if(!mf || f?.sha256!==mf.sha256 || typeof f?.text!=="string") process.exit(4);
      }
      const pairs=new Set(m.perechi_lipire.map(p=>p.join("+")));
      for(const [et,p] of Object.entries(r.lipiri)) {
        const [a,b]=et.split("+");
        if(!pairs.has(et)||typeof p?.text!=="string"||p.sha256_a!==m.felii.find(f=>f.eticheta===a)?.sha256||p.sha256_b!==m.felii.find(f=>f.eticheta===b)?.sha256) process.exit(4);
      }
      const meta=JSON.parse(fs.readFileSync("/work/plansa_provenienta.json","utf8"));
      // modelUsage este jurnalul CLI, nu aliasul cerut prin --model și nu textul modelului.
      const models=Object.keys(envelope.modelUsage||{});
      if(models.length!==1 || !/^claude-opus-/.test(models[0]) || meta.pachet_id!==m.pachet_id) process.exit(4);
      r.pachet_id=meta.pachet_id;
      r.rulare={...meta.rulare,model:models[0]};
      fs.writeFileSync(process.argv[3],JSON.stringify(r,null,2)+"\n");
    } catch { process.exit(4); }
  ' "$OUT_JSON" "$OUT_MD" "$PLANSA_JSON" || final 6 plansa_json_invalid
  OUT_MD="$PLANSA_JSON"
  J "PLANSA=$PLANSA_JSON sha256=$(sha256sum "$PLANSA_JSON" | cut -c1-64)"
  final 0 ok
fi
# 5. source_pack: rezultatul e JSON, nu raport → validator fără AI (excerpt-urile se caută literal în /work/text);
#    pack-ul validat merge la worker (B2), care e singurul care scrie în BD. Rezultatul brut rămâne în .md pentru diagnoză.
if [ "$TASK" = "source_pack" ]; then
  PACK="/out/${STAMP}_source_pack.pack.json"
  # identitatea pack-ului vine de la om/ERP (LIC_ID, LIC_NR_ANUNT din run_pilot), nu de la model; fără LIC_ID pack-ul e
  # marcat cu problemă de schemă și workerul îl respinge. "rulare" = metadatele rulării (model, ture, cost estimat, durată).
  [ -n "${LIC_ID:-}" ] || J "ATENȚIE: LIC_ID lipsește — pack-ul nu va avea licitatie_id (workerul îl respinge)"
  RULARE=$(node -e '
    const fs=require("fs"); let j={}; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch(e) {}
    const u=j.usage||{}; process.stdout.write(JSON.stringify({ stamp:process.argv[2], fisier:process.argv[3], sursa:"cli", cli:process.argv[4]||null,
      model:process.argv[5], effort:process.argv[6], ture:j.num_turns??null, cost_usd_estimat:j.total_cost_usd??null, durata_s:Number(process.argv[7])||null,
      tokeni:{in:u.input_tokens??null,out:u.output_tokens??null,cache_read:u.cache_read_input_tokens??null,cache_create:u.cache_creation_input_tokens??null},
      motiv_oprire:j.subtype??null, is_error:j.is_error??null }));
  ' "$OUT_JSON" "$STAMP" "${STAMP}_source_pack.pack.json" "$(claude --version 2>/dev/null | head -1)" "${TASK_MODEL:-sonnet}" "${TASK_EFFORT:-medium}" "$(( $(date +%s) - START ))")
  node /usr/local/bin/verifica_pack.mjs "$OUT_MD" /work/text "$PACK" --licitatie-id "${LIC_ID:-}" --nr-anunt "${LIC_NR_ANUNT:-}" --data-dir /data --rulare "$RULARE" > /work/.valid 2>&1; VC=$?
  while IFS= read -r l; do J "pack $l"; done < /work/.valid
  [ "$VC" -eq 4 ] && final 6 pack_json_invalid
  [ "$VC" -eq 3 ] && J "ATENȚIE: pack cu probleme de schemă — workerul îl va respinge (stare=respins, motiv în nota)"
  J "PACK=$PACK sha256=$(sha256sum "$PACK" | cut -c1-64) size=$(stat -c %s "$PACK")"
  final 0 ok
fi
grep -q "⟦PAGINA\|text/\|/data/" "$OUT_MD" || J "ATENȚIE: raportul nu citează niciun fișier/pagină — de tratat ca nevalidat"
final 0 ok
