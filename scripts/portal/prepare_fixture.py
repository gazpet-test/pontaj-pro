#!/usr/bin/env python3
"""Copie EXCLUSIV de harness a migrarii 18a. Artefactul de productie ramane neschimbat.

- lista alba PUBLIC de productie (21 de semnaturi revizuite) -> cele 21 de functii sintetice ale scheletului local;
- amprentele public si net -> literalii din --amprente (JSON {"public": {...}, "net": {...}}), citite de harness din
  clusterul efemer INAINTE de apply, ca un corp schimbat inainte de apply sa fie refuzat (Copilot r2 P1-02);
- lista ERP aprobata -> sha256 pe UUID-urile din --erp (fara --erp lista ramane goala: testul negativ);
- r9: lista conturilor teren existente (PORTAL_TEREN_APROBAT) -> sha256 pe UUID-urile sintetice din --teren UUID=EMP
  (EMP gol = fara fisa); fara --teren raman hash-urile productiei (testul negativ: inventar teren schimbat).

- r22: lista obiectelor pg_net (DE_COMPLETAT in 18a) -> amprentele din --net-rel (JSON, porti_citire.sql G pe clusterul
  efemer, citit prin net_rel_completeaza.py --json); --net-rel-necompletat o lasa DE_COMPLETAT (testul negativ).
- r23 (varianta d): clasificarea celor 21 (PORTAL_PUBLIC_CLASIFICARE) -> sinteticele 01..18 de trigger, 19..21 apelabile.

Utilizare: prepare_fixture.py <sursa.sql> <destinatie.sql> --amprente <fisier.json> (--net-rel <fisier.json> |
           --net-rel-necompletat) [--erp UUID ...] [--teren UUID=EMP ...]
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SIG_PUBLIC = re.compile(r"^public\.portal_fixture_public_[0-9]{2}\(\)$")
SIG_NET = re.compile(r"^net\.portal_fixture_net_[0-9]{2}\(\)$")
MD5 = re.compile(r"^[0-9a-f]{32}$")


def hold(message):
    raise SystemExit("HOLD: " + message)


def sql_literal(value):
    # Fara backslash (validatorul refuza backslash in literali obisnuiti); cheile si valorile sunt verificate mai sus.
    text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    if "\\" in text or "'" in text:
        hold("amprente cu caractere nepermise")
    return "'" + text + "'::jsonb"


def replace_once(pattern, text, repl, what):
    if len(pattern.findall(text)) != 1:
        hold(f"marcaj {what}: trebuie exact o aparitie")
    return pattern.sub(repl, text, count=1)


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--amprente", type=Path, required=True)
parser.add_argument("--erp", nargs="*", default=[])
parser.add_argument("--teren", nargs="*", default=None)
# r22: lista obiectelor pg_net (fn_portal_net_rel_aprobat) e DE_COMPLETAT in 18a; copia de fixture primeste amprentele
# citite de harness din clusterul efemer (porti_citire.sql G, prin net_rel_completeaza.py --json), ca pe productie.
# --net-rel-necompletat pune lista DE_COMPLETAT (testul negativ: PORTAL_NET_REL_LIST_NECOMPLETATA), oricare ar fi starea 18a (r24).
grup_net_rel = parser.add_mutually_exclusive_group(required=True)
grup_net_rel.add_argument("--net-rel", type=Path)
grup_net_rel.add_argument("--net-rel-necompletat", action="store_true")
args = parser.parse_args()
TEREN = re.compile(r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})=([0-9]{1,9})?$")
teren = []
for value in args.teren or []:
    m = TEREN.match(value)
    if not m:
        hold("intrare --teren invalida (UUID=EMP): " + value)
    teren.append((hashlib.sha256(m.group(1).encode("utf-8")).hexdigest(), m.group(2)))
if args.teren is not None and (len(teren) != 3 or len({h for h, _ in teren}) != 3):
    hold("--teren cere exact 3 conturi distincte")

text = args.source.read_text(encoding="utf-8").replace("\r\n", "\n")
amprente = json.loads(args.amprente.read_text(encoding="utf-8"))
public, net = amprente.get("public"), amprente.get("net")
if not isinstance(public, dict) or len(public) != 21 or not all(SIG_PUBLIC.match(k) and MD5.match(v) for k, v in public.items()):
    hold("amprentele public trebuie sa fie exact cele 21 de functii sintetice")
if not isinstance(net, dict) or len(net) != 12 or not all(SIG_NET.match(k) and MD5.match(v) for k, v in net.items()):
    hold("amprentele net trebuie sa fie exact cele 12 functii sintetice")
for value in args.erp:
    if not UUID.match(value):
        hold("UUID ERP invalid: " + value)

pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_aprobat\(\) RETURNS text\[\].*?\$fn\$\s*SELECT )(ARRAY\[.*?\]::text\[\])(;\s*\$fn\$;)", re.S)
matches = pattern.findall(text)
if len(matches) != 1 or matches[0][1].count("'public.") != 21:
    hold("lista alba PUBLIC din migrare nu are exact 21 de semnaturi; revizuieste fixture-ul")
signatures = ",".join("'" + s + "'" for s in sorted(public))
text = pattern.sub(lambda m: m.group(1) + "ARRAY[" + signatures + "]::text[]" + m.group(3), text)

# r23 (varianta d): clasificarea celor 21 -> functiile sintetice in aceeasi forma ca productia (porti_citire.sql M):
# portal_fixture_public_01..18 = functii de TRIGGER (granturi gol), 19..21 = apelabile (GRANT authenticated, service_role).
clasif_pattern = re.compile(r"(CREATE TEMP TABLE portal_public_clasificare ON COMMIT DROP AS\n"
                            r"SELECT v\.semnatura, v\.granturi::text\[\] AS granturi FROM \(VALUES\n"
                            r" -- PORTAL_PUBLIC_CLASIFICARE:[^\n]*\n)(.*?)(\n\) v\(semnatura,granturi\);)", re.S)
clasif = clasif_pattern.findall(text)
if len(clasif) != 1 or len(re.findall(r"^ \('public\.[^']+\(.*?\)','\{[a-z_,]*\}'\),?$", clasif[0][1], re.M)) != 21:
    hold("clasificarea PUBLIC din migrare nu are exact 21 de randuri; revizuieste fixture-ul")
APELABILE_FIXTURE = {f"public.portal_fixture_public_{i:02d}()" for i in (19, 20, 21)}
rows = ",\n".join(" ('" + s + "','" + ("{authenticated,service_role}" if s in APELABILE_FIXTURE else "{}") + "')"
                  for s in sorted(public))
text = clasif_pattern.sub(lambda m: m.group(1) + rows + m.group(3), text, count=1)
# ... si instructiunile statice GRANT / REVOKE dintre marcaje (aceleasi liste ca clasificarea, verificate static in 18a)
for marcaj, instr in (
        ("PORTAL_PUBLIC_D_GRANT", "GRANT EXECUTE ON FUNCTION " + ", ".join(sorted(APELABILE_FIXTURE)) + " TO authenticated, service_role;"),
        ("PORTAL_PUBLIC_D_REVOKE", "REVOKE EXECUTE ON FUNCTION " + ", ".join(sorted(public)) + " FROM PUBLIC;")):
    bloc = re.compile(r"(-- " + marcaj + r" inceput[^\n]*\n).*?(\n-- " + marcaj + r" sfarsit\n)", re.S)
    text = replace_once(bloc, text, lambda m, i=instr: m.group(1) + i + m.group(2), marcaj)

hash_pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_md5\(\) RETURNS jsonb.*?AS \$hash\$).*?(\$hash\$;)", re.S)
text = replace_once(hash_pattern, text, lambda m: m.group(1) + "\n SELECT " + sql_literal(public) + ";\n" + m.group(2), "public md5")

net_pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_net_md5\(\) RETURNS jsonb.*?AS \$nethash\$).*?(\$nethash\$;)", re.S)
text = replace_once(net_pattern, text, lambda m: m.group(1) + "\n SELECT " + sql_literal(net) + ";\n" + m.group(2), "net md5")

# owner-ul functiilor net: pe prod supabase_admin; in clusterul efemer functiile sintetice net sunt ale lui postgres
owner_line = "c_net_owner CONSTANT text := 'supabase_admin';"
if text.count(owner_line) != 1:
    hold("marcaj owner net: trebuie exact o aparitie")
text = text.replace(owner_line, "c_net_owner CONSTANT text := 'postgres';")

erp_pattern = re.compile(r"(CREATE TEMP TABLE portal_erp_aprobat ON COMMIT DROP AS\nSELECT ARRAY\[).*?(\]::text\[\] AS lista;)", re.S)
hashes = ",".join("'" + hashlib.sha256(u.encode("utf-8")).hexdigest() + "'" for u in args.erp)
text = replace_once(erp_pattern, text, lambda m: m.group(1) + hashes + m.group(2), "lista ERP")

teren_pattern = re.compile(r"(CREATE TEMP TABLE portal_teren_aprobat ON COMMIT DROP AS\nSELECT h,employee_id FROM \(VALUES\n"
                           r" -- PORTAL_TEREN_APROBAT:[^\n]*\n).*?(\n\) v\(h,employee_id\);)", re.S)
if len(teren_pattern.findall(text)) != 1:
    hold("marcaj PORTAL_TEREN_APROBAT: trebuie exact o aparitie")
if teren:
    rows = ",\n".join(" ('" + h + "'," + (emp if emp else "NULL::integer") + ")" for h, emp in teren)
    text = teren_pattern.sub(lambda m: m.group(1) + rows + m.group(2), text, count=1)

NET_REL_CHEI = ["net._http_response", "net.http_request_queue", "net.http_request_queue_id_seq"]
LISTA_GOALA = '{' + ','.join(f'"{k}":"DE_COMPLETAT"' for k in NET_REL_CHEI) + '}'
# r24: 18a poate fi NECOMPLETAT (DE_COMPLETAT) sau COMPLETAT din productie (md5); literalul se citeste in forma lui
# curenta (exact o aparitie, toate DE_COMPLETAT sau toate md5) si se inlocuieste explicit in ambele variante:
# --net-rel => amprentele clusterului, --net-rel-necompletat => DE_COMPLETAT (testul negativ nu mai depinde de repo).
LISTA_18A = re.compile(r"SELECT '(\{" + ",".join(f'"{re.escape(k)}":"([^"\']*)"' for k in NET_REL_CHEI) + r"\})'::jsonb;")
gasite = LISTA_18A.findall(text)
if len(gasite) != 1:
    hold("lista pg_net din 18a (fn_portal_net_rel_aprobat): trebuie exact o aparitie")
lista_curenta, valori_curente = gasite[0][0], gasite[0][1:]
if text.count(lista_curenta) != 1 or not (all(v == "DE_COMPLETAT" for v in valori_curente)
                                          or all(MD5.match(v) for v in valori_curente)):
    hold("lista pg_net din 18a: nici DE_COMPLETAT, nici completata (md5) peste tot")
if args.net_rel is not None:
    net_rel = json.loads(args.net_rel.read_text(encoding="utf-8"))
    if not isinstance(net_rel, dict) or sorted(net_rel) != NET_REL_CHEI or not all(MD5.match(v) for v in net_rel.values()):
        hold("--net-rel: exact cele trei obiecte pg_net, cu md5")
    text = text.replace(lista_curenta, '{' + ','.join(f'"{k}":"{net_rel[k]}"' for k in NET_REL_CHEI) + '}', 1)
else:
    text = text.replace(lista_curenta, LISTA_GOALA, 1)

args.destination.write_text(text, encoding="utf-8", newline="\n")
print(f"FIXTURE ONLY: 21 public + 12 net sintetice cu amprente literale; ERP aprobate: {len(args.erp)}; "
      f"teren: {'sintetice' if teren else 'productie'}; obiecte pg_net: "
      f"{'DE_COMPLETAT' if args.net_rel_necompletat else 'amprentele clusterului'}")
