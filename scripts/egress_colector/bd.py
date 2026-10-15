"""Scrierea UNUI rand in public.supabase_usage_oficial prin psql (ca restul proiectului): pooler + parola din pgpass.

Siguranta textului paginii (continut extern): nimic din pagina nu se interpoleaza in SQL. Citirea REverificata
(valideaza_document) devine UN document JSON (ensure_ascii, o singura linie), pus intr-un literal dollar-quoted cu tag
ALEATOR (128 de biti) verificat ca nu apare in document; serverul il parseaza ca jsonb si fiecare camp e convertit explicit
(::timestamptz, ::date, ::bigint). Textul paginii ajunge DOAR in raspuns_brut (jsonb), ca date. psql nu interpoleaza
variabile si nu vede meta-comenzi in interiorul unui literal dollar-quoted; in afara literalului SQL-ul generat e fix si nu
contine backslash. Ruleaza cu -X (fara psqlrc), -w (fara prompt de parola), ON_ERROR_STOP si --single-transaction.
"""
import json, os, re, secrets, shutil, subprocess, sys, tempfile
from datetime import date, datetime, timedelta, timezone

from . import parsare as P
from .pagina import ORG

PSQL_IMPLICIT = r'C:\Users\Public\pgsql\bin\psql.exe'
# aceleasi valori ca in %APPDATA%\postgresql\pgpass.conf (parola NU apare aici, nici in mediu, nici pe linia de comanda)
PG_IMPLICIT = {'host': 'aws-1-eu-central-1.pooler.supabase.com', 'port': '5432',
               'user': 'postgres.dxczwkbciseqniprspcu', 'db': 'postgres', 'sslmode': 'require'}
# variabile care ar putea schimba tinta sau executia pe ascuns — scoase din mediul lui psql (ca in livrare_migrare.sh)
MEDIU_SCOS = ('PGPASSWORD', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PSQLRC', 'PGHOST', 'PGHOSTADDR',
              'PGPORT', 'PGDATABASE', 'PGUSER', 'PGTARGETSESSIONATTRS', 'PGLOADBALANCEHOSTS', 'PGSSLMODE', 'PGAPPNAME')
SURSA = 'dashboard'
VERSIUNE = 1
MAX_TEXT = 300                       # orice sir din raspuns_brut
MAX_DOC = 4000                       # documentul JSON intreg (doar valori + cateva randuri, nu pagina)
TOLERANTA_VIITOR = timedelta(minutes=5)   # triggerul din BD refuza peste now() + 10 min
REZULTAT_RE = re.compile(r'^EGRESS_REZULTAT\|(\d+)\|(\S+)$', re.M)
STARE_RE = re.compile(r'^EGRESS_STARE\|(.*)$', re.M)
CHEI_RANDURI = ('Egress', 'Cached Egress', 'Storage Size', 'ciclu')
CHEI_BYTES = ('egress_bytes', 'cached_egress_bytes', 'storage_size_bytes')


class EroareScriere(Exception):
    pass


# ── documentul ────────────────────────────────────────────────────────────────────────────────────────────────────────

def document(c, citit_la):
    """Citire (parsata) + momentul citirii (UTC) → documentul care merge la server. raspuns_brut = doar valorile parsate
    + randurile relevante (eticheta → rand), NU pagina."""
    eticheta = dict(P.ETICHETE)
    return {
        'citit_la': citit_la.astimezone(timezone.utc).isoformat(timespec='seconds'),
        'ciclu_start': c.ciclu_start.isoformat(),
        'ciclu_sfarsit': c.ciclu_sfarsit.isoformat(),
        'egress_bytes': c.egress_bytes,
        'cached_egress_bytes': c.cached_egress_bytes,
        'storage_size_bytes': c.storage_size_bytes,
        'raspuns_brut': {
            'colector': 'scripts/egress_colector', 'versiune': VERSIUNE,
            'pagina': f'/dashboard/org/{ORG}/usage', 'unitate': 'GB zecimal (1 GB = 10^9 bytes)',
            'separator_zecimal': c.zecimal,
            'valori_gb': {k: P.gb(getattr(c, k + '_bytes')) for k, _ in P.ETICHETE},
            'cote_gb': {k: P.gb(c.cote[k]) for k, _ in P.ETICHETE},
            'randuri': {**{eticheta[k]: c.randuri[k] for k, _ in P.ETICHETE}, 'ciclu': c.randuri['ciclu']},
        },
    }


def _bytes_ok(v):
    return type(v) is int and 0 <= v <= P.MAX_BYTES


def _texte(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _texte(v)
    elif isinstance(o, str):
        yield o
    elif not (type(o) is int or o is None):
        raise EroareScriere(f'raspuns_brut: tip nepermis {type(o).__name__}')


def valideaza_document(doc, acum=None):
    """A doua verificare, independenta de parser, chiar inainte de SQL (aceleasi reguli ca CHECK-urile din BD)."""
    acum = acum or datetime.now(timezone.utc)
    if not isinstance(doc, dict) or set(doc) != {'citit_la', 'ciclu_start', 'ciclu_sfarsit', *CHEI_BYTES, 'raspuns_brut'}:
        raise EroareScriere('document cu alte chei decat cele asteptate')
    for k in CHEI_BYTES:
        if not _bytes_ok(doc[k]):
            raise EroareScriere(f'{k}: trebuie intreg intre 0 si {P.MAX_BYTES}')
    try:
        start = date.fromisoformat(doc['ciclu_start'])
        sfarsit = date.fromisoformat(doc['ciclu_sfarsit'])
        citit = datetime.fromisoformat(doc['citit_la'])
    except (TypeError, ValueError):
        raise EroareScriere('data/ora invalida in document')
    if start.day != 7 or sfarsit != P.plus_o_luna(start):
        raise EroareScriere(f'ciclul {start}→{sfarsit} nu e 07→07 de o luna')
    if citit.tzinfo is None or citit.utcoffset() != timedelta(0):
        raise EroareScriere('citit_la trebuie in UTC, cu fus explicit')
    if citit > acum + TOLERANTA_VIITOR:
        raise EroareScriere('citit_la e in viitor')
    if not (start - timedelta(days=1) <= citit.date() <= sfarsit):
        raise EroareScriere(f'citirea din {citit.date()} nu cade in ciclul {start}→{sfarsit}')
    rb = doc['raspuns_brut']
    if not isinstance(rb, dict) or set(rb.get('randuri', {})) != set(CHEI_RANDURI):
        raise EroareScriere('raspuns_brut fara randurile asteptate')
    for t in _texte(rb):
        if len(t) > MAX_TEXT:
            raise EroareScriere('raspuns_brut: sir prea lung (se pastreaza doar randurile relevante, nu pagina)')
    return doc


def payload_json(doc):
    return json.dumps(doc, ensure_ascii=True, separators=(',', ':'), sort_keys=True)


def construieste_sql(doc, tag=None, acum=None):
    """Textul SQL (fara BEGIN/COMMIT: --single-transaction). doc = rezultatul document(); se reverifica aici."""
    valideaza_document(doc, acum)
    text = payload_json(doc)
    if len(text) > MAX_DOC:
        raise EroareScriere('documentul e prea mare — refuz')
    tag = tag or ('egr_' + secrets.token_hex(16))
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', tag):
        raise EroareScriere('tag dollar-quote invalid')
    if tag in text or '\n' in text or '\r' in text or not text.isascii():
        raise EroareScriere('documentul contine tag-ul dollar-quote, un salt de rand sau non-ASCII — refuz')
    lit = f'${tag}${text}${tag}$'
    return (
        "SET LOCAL client_min_messages = warning;\n"
        "SET LOCAL statement_timeout = '30s';\n"
        "SET LOCAL lock_timeout = '10s';\n"
        f"WITH d AS (SELECT {lit}::jsonb AS j),\n"
        "c AS (\n"
        "  INSERT INTO public.supabase_usage_oficial\n"
        "    (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, storage_size_bytes, sursa, raspuns_brut)\n"
        "  SELECT (d.j->>'citit_la')::timestamptz, (d.j->>'ciclu_start')::date, (d.j->>'ciclu_sfarsit')::date,\n"
        "         (d.j->>'egress_bytes')::bigint, (d.j->>'cached_egress_bytes')::bigint, (d.j->>'storage_size_bytes')::bigint,\n"
        f"         '{SURSA}', d.j->'raspuns_brut'\n"
        "  FROM d\n"
        "  RETURNING id, citit_la\n"
        ")\n"
        "SELECT 'EGRESS_REZULTAT|' || id || '|' || to_char(citit_la AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM c;\n"
    )


SQL_STARE = (
    "SET TRANSACTION READ ONLY;\n"
    "SET LOCAL statement_timeout = '30s';\n"
    "SELECT 'EGRESS_STARE|' || (SELECT count(*) FROM public.supabase_usage_oficial) || '|' ||\n"
    "  coalesce((SELECT id || '|' || to_char(citit_la AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || '|' || ciclu_start || '|' ||\n"
    "                   ciclu_sfarsit || '|' || egress_bytes || '|' || cached_egress_bytes || '|' ||\n"
    "                   coalesce(storage_size_bytes::text, '-') || '|' || round(extract(epoch FROM now() - citit_la) / 3600.0, 1)\n"
    "            FROM public.supabase_usage_oficial ORDER BY citit_la DESC, id DESC LIMIT 1), '-|-|-|-|-|-|-|-') || '|' ||\n"
    "  coalesce((SELECT to_char(oficial_activat_la AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') FROM public.storage_egress_config\n"
    "            WHERE id = 1), '-');\n"
)


# ── psql ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def mediu_psql(sslmode):
    env = {k: v for k, v in os.environ.items() if k not in MEDIU_SCOS}
    env.update({'PGCLIENTENCODING': 'UTF8', 'PGSSLMODE': sslmode, 'PGAPPNAME': 'egress_colector', 'PGCONNECT_TIMEOUT': '20'})
    return env


def comanda_psql(psql, pg, cale):
    pg = dict(PG_IMPLICIT, **(pg or {}))
    for k, tipar in (('host', r'[A-Za-z0-9.-]{1,253}'), ('port', r'\d{1,5}'), ('user', r'[A-Za-z0-9_.-]{1,63}'),
                     ('db', r'[A-Za-z0-9_]{1,63}'), ('sslmode', r'require|verify-ca|verify-full|disable|prefer')):
        if not re.fullmatch(tipar, str(pg[k])):
            raise EroareScriere(f'parametru de conexiune invalid: {k}')
    return pg, [psql, '-X', '-w', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                '-h', pg['host'], '-p', str(pg['port']), '-U', pg['user'], '-d', pg['db'], '-f', cale]


def ruleaza_psql(sql, psql=PSQL_IMPLICIT, pg=None, run=subprocess.run):
    """Ruleaza SQL-ul generat dintr-un fisier temporar (nu pe linia de comanda); intoarce stdout. EroareScriere cu un
    extras scurt de eroare (fara parola: ea sta doar in pgpass)."""
    d = tempfile.mkdtemp(prefix='egress_colector_sql_')
    try:
        cale = os.path.join(d, 'egress.sql')
        pg, cmd = comanda_psql(psql, pg, cale)
        with open(cale, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
        extra = {'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}  # fara fereastra sub pythonw
        try:
            r = run(cmd, env=mediu_psql(pg['sslmode']), capture_output=True, text=True, encoding='utf-8',
                    errors='replace', timeout=90, stdin=subprocess.DEVNULL, **extra)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise EroareScriere(f'psql nu a putut rula: {type(e).__name__}')
        if r.returncode != 0:
            linii = [l for l in (r.stderr or '').splitlines() if re.search(r'ERROR|FATAL|DETAIL|HINT|psql:', l)]
            raise EroareScriere('psql a esuat (cod %d): %s' % (r.returncode, ' | '.join(l[:300] for l in linii[:4]) or 'fara mesaj'))
        return r.stdout or ''
    finally:
        shutil.rmtree(d, ignore_errors=True)


def scrie(c, citit_la, psql=PSQL_IMPLICIT, pg=None, rulare=ruleaza_psql, acum=None):
    """Un INSERT, o tranzactie. Intoarce (id, citit_la_server)."""
    out = rulare(construieste_sql(document(c, citit_la), acum=acum), psql=psql, pg=pg)
    m = REZULTAT_RE.findall(out)
    if len(m) != 1:
        raise EroareScriere('psql nu a intors exact o linie EGRESS_REZULTAT — starea scrierii trebuie verificata manual (stare)')
    return int(m[0][0]), m[0][1]


def stare(psql=PSQL_IMPLICIT, pg=None, rulare=ruleaza_psql):
    """Doar citire (tranzactie READ ONLY): numarul de citiri, ultima citire, momentul activarii monitorului oficial."""
    out = rulare(SQL_STARE, psql=psql, pg=pg)
    m = STARE_RE.search(out)
    if not m:
        raise EroareScriere('psql nu a intors linia EGRESS_STARE')
    campuri = m.group(1).split('|')
    if len(campuri) != 10:
        raise EroareScriere('linia EGRESS_STARE are alt format')
    chei = ('n', 'id', 'citit_la', 'ciclu_start', 'ciclu_sfarsit', 'egress_bytes', 'cached_egress_bytes',
            'storage_size_bytes', 'vechime_ore', 'activat_la')
    return dict(zip(chei, campuri))
