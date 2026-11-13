#!/usr/bin/env bash
# ============================================================================
# L15 v2 (docs/LIVRARE_L15_V2.md, sectiunile 5 si 7): compara doua iesiri ale citirii
# (scripts/amprenta_globala_citire.sh --lista). Doar bash / awk / coreutils, fara conexiune.
#   bash scripts/l15_compara_liste.sh --a <citire_A.txt> --b <citire_B.txt> [--manifest <NUME>.l15.tsv | --recitire]
# Fara optiuni: randurile doar in A, doar in B si cele cu alta amprenta, grupate pe familii, + totaluri.
#   Cod 0 = identice, 7 = difera.
# --manifest (A = clona, B = tinta): COMPARABIL (0) doar daca: randurile CONTEXT sunt egale; familia sesiune e egala;
#   privilegiile implicite ale ROLULUI DE LIVRARE (randurile "acl_implicit <current_user din CONTEXT> ...": creatorul
#   obiectelor noi) sunt egale; fiecare rand schimbat / sters din manifest exista in AMBELE liste cu ACEEASI amprenta;
#   fiecare rand creat lipseste din ambele. Altfel NECOMPARABIL (6) cu lista. Diferentele din extensie, colatie, limbaj,
#   rol, membru, schema, sistem_initdb (functiile de la initdb: alt build al serverului intre clona si tinta) si
#   privilegiile implicite ale ALTOR creatori (rolurile platformei: nu hotarasc drepturile obiectelor create de
#   livrare) se tiparesc ca DE_EXPLICAT (nu schimba codul: le explica coordonatorul in PR-ul de baseline). Rol de livrare cu nume ne-simplu (ar aparea intre ghilimele in eticheta) => regula stricta: orice rand
#   acl_implicit diferit = NECOMPARABIL (fail-closed).
# --recitire (aceeasi baza, doua momente: A = citirea revizuita, B = cea din ziua livrarii): partea REVIZUITA trebuie sa
#   fie IDENTICA - iesirea scriptului de amprente al migrarii (in ordine, cu momentul fotografiei deja inlocuit de citire
#   cu marcajul fix), randurile LANT, SEMNALE, INCREDERE, CONTEXT - altfel 6; restul diferentelor (RAND) se listeaza
#   integral (cod 0 daca partea revizuita e identica). Randul MOMENT (momentul fiecarei fotografii) e in afara partii
#   revizuite: se tipareste, nu se compara.
# Intrarile se valideaza (fail-closed, cod 2): exact un GLOBAL, VALIDARE ok, FOTOGRAFIE aceeasi, 3 randuri CONTEXT,
#   numarul randurilor RAND = numarul din GLOBAL (citire cu --lista), nicio linie nerecunoscuta in afara sectiunii
#   scriptului migrarii, etichete unice; cu sectiunea migrarii: exact un rand MOMENT, iar valoarea lui nu mai apare in
#   campul antetului standard (randul de dupa linia "baza | sistem | versiune | la", ultimul camp: il inlocuieste
#   citirea); in alte randuri acelasi sir e o valoare reala si se compara.
# Coduri: 0 identice / COMPARABIL / partea revizuita identica | 2 argumente / intrare invalida | 6 NECOMPARABIL /
#   partea revizuita difera | 7 difera (fara optiuni).
# Fiecare regula are pe linia ei un marcaj "# M_<regula>" (testul scripts/test_l15_compara_liste.sh o scoate = mutant).
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ: $2" >&2; exit "$1"; }
A="" B="" MAN="" REC=0
while [ $# -gt 0 ]; do
  case "$1" in --recitire) REC=1; shift; continue ;; esac
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --a) A="$2" ;; --b) B="$2" ;; --manifest) MAN="$2" ;;
    *) refuz 2 "optiune nepermisa: $1" ;;
  esac
  shift 2
done
[ -n "$A" ] && [ -f "$A" ] && [ -n "$B" ] && [ -f "$B" ] || refuz 2 "--a si --b: doua fisiere de citire existente"
[ -z "$MAN" ] || [ "$REC" = 0 ] || refuz 2 "--manifest si --recitire se exclud"
[ -z "$MAN" ] || [ -f "$MAN" ] || refuz 2 "--manifest: fisier inexistent: $MAN"
TAB=$'\t'
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# parse <fisier> <prefix>: <prefix>.rand (familie TAB eticheta TAB amprenta), .ctx, .rev (CONTEXT, LANT, SEMNALE,
# INCREDERE), .mig (sectiunea scriptului migrarii, in ordine); pe stdout: probleme (o linie fiecare) - goala = valida.
parse() {
  : >"$2.rand"; : >"$2.ctx"; : >"$2.rev"; : >"$2.mig"
  tr -d '\r' <"$1" | awk -F'\t' -v p="$2" '
    function md5ok(x) { return length(x) == 32 && x ~ /^[0-9a-f]+$/ }
    BEGIN { mig = 0; nb = 0; ne = 0; ng = 0; nv = 0; nf = 0; nc = 0; nr = 0; gn = -1; nrau = 0; nm = 0; mom = ""; nl = 0; dupa = 0; va = 0
            ant = "baza | sistem | versiune | la" }
    index($0, "=== scriptul de amprente al migrarii ") == 1 { if (mig || nb) prob("marcaj de inceput repetat"); mig = 1; nb++; dupa = 0; va = 0; print > (p ".mig"); next }
    $0 == "=== sfarsit scriptul de amprente al migrarii ===" { if (!mig) prob("marcaj de sfarsit fara inceput"); mig = 0; ne++; print > (p ".mig"); next }
    # ml = randul de date de imediat dupa antetul standard (campul momentului: ultimul, dupa " | "); antetul = DOAR prima
    # aparitie a liniei exacte in sectiune (ca in citire); o aparitie ulterioara e data obisnuita
    mig { print > (p ".mig"); if (dupa) ml[++nl] = $0; dupa = (!va && $0 == ant); if (dupa) va = 1; next }   # M_CMP_ANTET_UNIC
    # MOMENT: momentul fotografiei, in afara partii revizuite (nu intra in .rev / .mig)
    $1 == "MOMENT" && NF == 5 { nm++; mom = $4; if (mom == "") prob("MOMENT gol"); next }   # M_MOMENT
    $1 == "RAND" && NF >= 5 {
      e = $3; for (i = 4; i <= NF - 2; i++) e = e FS $i
      if ($2 !~ /^[a-z_]+$/ || !md5ok($(NF-1))) prob("rand RAND invalid")
      print $2 FS e FS $(NF-1) > (p ".rand"); nr++; next }
    $1 == "GLOBAL" && NF == 5 { ng++; if (!md5ok($4) || $5 !~ /^[0-9]+$/) prob("GLOBAL invalid"); gn = $5; next }
    $1 == "VALIDARE" { if ($4 == "ok") nv++; else prob("VALIDARE " $4); next }
    $1 == "FOTOGRAFIE" { if ($4 == "aceeasi") nf++; else prob("FOTOGRAFIE " $4); next }
    $1 == "CONTEXT" { print > (p ".ctx"); print > (p ".rev"); nc++; next }
    $1 == "LANT" || $1 == "SEMNALE" || $1 == "INCREDERE" { print > (p ".rev"); next }
    $1 == "TINTA" || $1 == "FAMILIE" { next }
    { nrau++; if (nrau <= 3) prob("linie nerecunoscuta: " substr($0, 1, 60)) }
    function prob(m) { print m }
    END {
      if (mig || nb != ne) prob("sectiunea scriptului migrarii neinchisa")
      if (ng != 1) prob("GLOBAL: " ng " randuri (asteptat 1)")
      if (nv != 1) prob("VALIDARE ok lipsa")
      if (nf != 1) prob("FOTOGRAFIE aceeasi lipsa")
      if (nc != 3) prob("CONTEXT: " nc " randuri (asteptat 3)")
      if (nr != gn) prob("RAND: " nr " randuri, GLOBAL anunta " gn " (citire fara --lista sau incompleta)")
      if (nrau > 3) prob("linii nerecunoscute: " nrau)
      if (nm > 1 || (nb > 0 && nm != 1)) prob("MOMENT: " nm " randuri (asteptat exact 1 cand exista sectiunea scriptului migrarii)")
      # citirea inlocuieste momentul in campul antetului standard; daca il mai gasim ACOLO, iesirea nu e a citirii (fail-closed).
      # In alte randuri acelasi sir poate fi o valoare reala (ramane, se compara).
      if (mom != "") for (i = 1; i <= nl; i++) {
        s = " | " mom
        if (length(ml[i]) > length(s) && substr(ml[i], length(ml[i]) - length(s) + 1) == s) { prob("momentul fotografiei apare neinlocuit in antetul standard al sectiunii migrarii"); break }
      }
    }'
}
for x in a b; do
  f="$A"; [ "$x" = a ] || f="$B"
  PR="$(parse "$f" "$W/$x")"
  [ -z "$PR" ] || { printf '%s\n' "$PR" | sed "s/^/  $x: /" >&2; refuz 2 "citirea $x ($f) nu e o iesire --lista valida"; }
  LC_ALL=C sort -o "$W/$x.rand" "$W/$x.rand"; LC_ALL=C sort -o "$W/$x.ctx" "$W/$x.ctx"; LC_ALL=C sort -o "$W/$x.rev" "$W/$x.rev"
  DUP="$(awk -F'\t' '{ k = $1; for (i = 2; i < NF; i++) k = k FS $i; print k }' "$W/$x.rand" | uniq -d | head -n 3)"
  [ -z "$DUP" ] || refuz 2 "citirea $x: etichete duble ($DUP)"
done

# diferenta rand cu rand (cheia = familie + eticheta; eticheta poate contine TAB): TIP TAB familie TAB eticheta TAB amprente
awk -F'\t' '
  function cheie(   k, i) { k = $1; for (i = 2; i < NF; i++) k = k FS $i; return k }
  FILENAME == ARGV[1] { a[cheie()] = $NF; next }
  { k = cheie(); vazut[k] = 1 }
  !(k in a) { print "DOAR_B" FS k FS $NF }                             # M_DOAR_B
  (k in a) && a[k] != $NF { print "DIFERA" FS k FS a[k] FS $NF }       # M_DIFERA
  END { for (k in a) if (!(k in vazut)) print "DOAR_A" FS k FS a[k] }  # M_DOAR_A
' "$W/a.rand" "$W/b.rand" | LC_ALL=C sort -t "$TAB" -k2,2 -k3 >"$W/dif"
N_DIF="$(grep -c . "$W/dif" || true)"
rezumat() { # totalurile pe familii + total
  awk -F'\t' '{ n[$2 FS $1]++; t[$1]++; f[$2] = 1 }
    END { for (x in f) { s = x ":"; for (y in t) if ((x FS y) in n) s = s " " y "=" n[x FS y]; print "FAMILIE" FS s }
          printf "TOTAL"; for (y in t) printf " %s=%d", y, t[y]; print "" }' "$W/dif" | LC_ALL=C sort
}

if [ -z "$MAN" ] && [ "$REC" = 0 ]; then
  cat "$W/dif"
  [ "$N_DIF" = 0 ] || rezumat
  if [ "$N_DIF" = 0 ]; then echo "[ok] IDENTICE ($(grep -c . "$W/a.rand" || true) randuri)"; exit 0; fi
  echo "[x] DIFERA: $N_DIF randuri"; exit 7
fi

NEC=0
nec() { NEC=1; printf 'NECOMPARABIL\t%s\t%s\n' "$1" "$2"; }
if [ -n "$MAN" ]; then
  # randurile manifestului: familie TAB eticheta TAB operatie TAB amprenta (eticheta poate contine TAB)
  tr -d '\r' <"$MAN" | grep -v '^#' | grep -v '^$' >"$W/man" || true
  awk -F'\t' 'NF < 4 || $(NF-1) !~ /^(creat|schimbat|sters)$/ { print NR }' "$W/man" | head -n 3 >"$W/man_rau"
  [ ! -s "$W/man_rau" ] || refuz 2 "--manifest: linii fara formatul familie TAB eticheta TAB operatie TAB amprenta ($(tr '\n' ' ' <"$W/man_rau"))"
  cmp -s "$W/a.ctx" "$W/b.ctx" || nec R_CONTEXT "CONTEXT diferit: A [$(cut -f2,4 "$W/a.ctx" | tr '\t\n' '= ')] B [$(cut -f2,4 "$W/b.ctx" | tr '\t\n' '= ')]"   # M_R_CONTEXT
  # rolul de livrare = current_user din CONTEXT (A; B e egal sau R_CONTEXT a refuzat deja). Nume ne-simplu => "" => strict.
  ROL_L="$(awk -F'\t' '$2 == "current_user" { print $4 }' "$W/a.ctx")"
  [[ "$ROL_L" =~ ^[a-z_][a-z0-9_]*$ ]] || ROL_L=""
  awk -F'\t' -v rol="$ROL_L" '$2 == "sesiune" || ($2 == "acl_implicit" && (rol == "" || index($3, "acl_implicit " rol " ") == 1))' "$W/dif" >"$W/fam"
  [ ! -s "$W/fam" ] || nec R_FAM "sesiunea / privilegiile implicite ale rolului de livrare difera ($(grep -c . "$W/fam") randuri)"   # M_R_FAM
  sed 's/^/  /' "$W/fam"
  awk -F'\t' -v fe="$W/r_exist" -v fc="$W/r_creat" '
    function cheie_r(   k, i) { k = $1; for (i = 2; i < NF; i++) k = k FS $i; return k }
    function cheie_m(   k, i) { k = $1; for (i = 2; i <= NF - 2; i++) k = k FS $i; return k }
    FILENAME == ARGV[1] { a[cheie_r()] = $NF; next }
    FILENAME == ARGV[2] { b[cheie_r()] = $NF; next }
    { k = cheie_m(); op = $(NF-1)
      if (op == "creat") { if ((k in a) || (k in b)) print "CREAT_EXISTA" FS k FS ((k in a) ? "A " a[k] : "A -") FS ((k in b) ? "B " b[k] : "B -") > fc }
      else if (!(k in a) || !(k in b)) print "LIPSA_INAINTE" FS op FS k FS ((k in a) ? "A " a[k] : "A -") FS ((k in b) ? "B " b[k] : "B -") > fe
      else if (a[k] != b[k]) print "ALTA_AMPRENTA_INAINTE" FS op FS k FS "A " a[k] FS "B " b[k] > fe }
  ' "$W/a.rand" "$W/b.rand" "$W/man"
  touch "$W/r_exist" "$W/r_creat"
  [ ! -s "$W/r_exist" ] || nec R_EXIST "randuri schimbat / sters din manifest care nu exista in ambele liste cu aceeasi amprenta: $(grep -c . "$W/r_exist")"   # M_R_EXIST
  [ ! -s "$W/r_creat" ] || nec R_CREAT "randuri creat din manifest care exista deja: $(grep -c . "$W/r_creat")"   # M_R_CREAT
  sed 's/^/  /' "$W/r_exist" "$W/r_creat"
  # DE_EXPLICAT: familiile de context + privilegiile implicite ale altor creatori decat rolul de livrare
  awk -F'\t' -v rol="$ROL_L" '$2 ~ /^(extensie|colatie|limbaj|rol|membru|schema|sistem_initdb)$/ || ($2 == "acl_implicit" && rol != "" && index($3, "acl_implicit " rol " ") != 1) { print "DE_EXPLICAT" FS $0 }' "$W/dif" >"$W/expl"
  cat "$W/expl"
  echo "diferente intre liste: $N_DIF randuri ($(grep -c . "$W/expl" || true) DE_EXPLICAT)"
  if [ "$NEC" = 0 ]; then echo "[ok] COMPARABIL: manifestul $(basename "$MAN") ($(grep -c . "$W/man" || true) randuri) se poate verifica pe B"; exit 0; fi
  echo "[x] NECOMPARABIL: vezi liniile NECOMPARABIL de mai sus"; exit 6
fi

# --recitire
cmp -s "$W/a.mig" "$W/b.mig" || nec R_MIG "iesirea scriptului de amprente al migrarii difera ($(grep -c . "$W/a.mig" || true) / $(grep -c . "$W/b.mig" || true) linii)"   # M_R_MIG
cmp -s "$W/a.mig" "$W/b.mig" || diff "$W/a.mig" "$W/b.mig" | head -n 40 | sed 's/^/  /' || true
cmp -s "$W/a.rev" "$W/b.rev" || nec R_REV "randurile revizuite (LANT / SEMNALE / INCREDERE / CONTEXT) difera"   # M_R_REV
LC_ALL=C comm -23 "$W/a.rev" "$W/b.rev" | sed 's/^/  DOAR_A /'
LC_ALL=C comm -13 "$W/a.rev" "$W/b.rev" | sed 's/^/  DOAR_B /'
cat "$W/dif"
[ "$N_DIF" = 0 ] || rezumat
if [ "$NEC" = 0 ]; then
  echo "[ok] partea revizuita IDENTICA; $N_DIF randuri RAND difera (listate mai sus: se trec in jurnalul livrarii; doar partitiile zilnice ale platformei au voie sa difere fara review nou)"
  exit 0
fi
echo "[x] partea revizuita DIFERA - PR de baseline nou"; exit 6
