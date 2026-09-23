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
# 1. identitate: DOAR abonament (token setup-token). Orice cheie API moștenită ar factura API de la început.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL 2>/dev/null
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { J "CLAUDE_CODE_OAUTH_TOKEN lipsește din .env"; final 2 fara_token; }
[ -f "$PROMPT_F" ] || { J "prompt necunoscut: $TASK"; final 2 prompt_lipsa; }
[ -d /data ] || { J "/data nu e montat"; final 2 fara_date; }
command -v claude >/dev/null || { J "claude CLI lipsește din imagine"; final 2 fara_cli; }
J "START task=$TASK cli=$(claude --version 2>/dev/null | head -1) model=${TASK_MODEL:-sonnet} effort=${TASK_EFFORT:-medium} timeout=${TASK_TIMEOUT_MIN:-15}m max_turns=${TASK_MAX_TURNS:-20}"

# 2. pre-extragere text (agentul nu are Bash): PDF → text cu marcaje ⟦PAGINA n⟧ (același format ca ingest-ul Deno), DOCX → text brut.
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

# 3. rularea agentului: doar Read/Glob/Grep, fără prompturi (dontAsk = orice ar cere aprobare e refuzat), fără subagenți, fără sesiune pe disc.
PROMPT="$(cat "$PROMPT_F")

Directoare: textele extrase sunt în /work/text (oglinda lui /data, cu ⟦PAGINA n⟧), originalele în /data (doar citire), inventarul în /work/INVENTAR.md, contextul opțional în /context$( [ -f /context/documente.json ] && echo " (documente.json = lista documentelor din ERP cu id, seap_cod, tip)" )."
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
# 5. source_pack: rezultatul e JSON, nu raport → validator fără AI (excerpt-urile se caută literal în /work/text);
#    pack-ul validat merge la worker (B2), care e singurul care scrie în BD. Rezultatul brut rămâne în .md pentru diagnoză.
if [ "$TASK" = "source_pack" ]; then
  PACK="/out/${STAMP}_source_pack.pack.json"
  node /usr/local/bin/verifica_pack.mjs "$OUT_MD" /work/text "$PACK" > /work/.valid 2>&1; VC=$?
  while IFS= read -r l; do J "pack $l"; done < /work/.valid
  [ "$VC" -eq 4 ] && final 6 pack_json_invalid
  [ "$VC" -eq 3 ] && J "ATENȚIE: pack cu probleme de schemă — importul îl va respinge"
  J "PACK=$PACK"
  final 0 ok
fi
grep -q "⟦PAGINA\|text/\|/data/" "$OUT_MD" || J "ATENȚIE: raportul nu citează niciun fișier/pagină — de tratat ca nevalidat"
final 0 ok
