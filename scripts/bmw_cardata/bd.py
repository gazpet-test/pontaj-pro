"""Scrierea append-only in Supabase prin psql (ca restul proiectului): conexiunea pooler + parola din pgpass.

Siguranta textului BMW (continut extern): nimic din raspuns nu se interpoleaza in SQL. Citirea REverificata strict
(valideaza.reverifica) devine UN document JSON (ensure_ascii, o singura linie), pus intr-un literal dollar-quoted cu tag
ALEATOR (128 de biti) verificat ca nu apare in document; serverul il parseaza ca jsonb si fiecare camp e convertit explicit
(::uuid, ::timestamptz, ::numeric). psql nu interpoleaza variabile si nu vede meta-comenzi in interiorul unui literal
dollar-quoted; in afara literalului SQL-ul generat nu contine backslash. Ruleaza cu -X (fara psqlrc), ON_ERROR_STOP
si --single-transaction.
"""
import json, os, re, secrets, shutil, subprocess, tempfile

from . import valideaza as V

PSQL_IMPLICIT = r'C:\Users\Public\pgsql\bin\psql.exe'
# aceleasi valori ca in %APPDATA%\postgresql\pgpass.conf (parola NU apare aici, nici in mediu, nici pe linia de comanda)
PG_IMPLICIT = {'host': 'aws-1-eu-central-1.pooler.supabase.com', 'port': '5432',
               'user': 'postgres.dxczwkbciseqniprspcu', 'db': 'postgres', 'sslmode': 'require'}
# variabile care ar putea schimba tinta sau executia pe ascuns — scoase din mediul lui psql (ca in livrare_migrare.sh)
MEDIU_SCOS = ('PGPASSWORD', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PSQLRC', 'PGHOST', 'PGHOSTADDR',
              'PGPORT', 'PGDATABASE', 'PGUSER', 'PGTARGETSESSIONATTRS', 'PGLOADBALANCEHOSTS', 'PGSSLMODE', 'PGAPPNAME')
REZULTAT_RE = re.compile(r'^BMW_REZULTAT\|(\d+|deja)\|(\d+)\|(\d+)$', re.M)


class EroareScriere(Exception):
    pass


def payload_json(rec_bd):
    return json.dumps(rec_bd, ensure_ascii=True, separators=(',', ':'), sort_keys=True)


def construieste_sql(rec_bd, tag=None):
    """rec_bd = rezultatul valideaza.reverifica. Intoarce textul SQL (fara BEGIN/COMMIT: --single-transaction)."""
    doc = payload_json(rec_bd)
    tag = tag or ('bmw_' + secrets.token_hex(16))
    if not re.match(r'^[a-z_][a-z0-9_]*$', tag):
        raise EroareScriere('tag dollar-quote invalid')
    if tag in doc or '\n' in doc or '\r' in doc:
        raise EroareScriere('documentul contine tag-ul dollar-quote sau un salt de rand — refuz')
    lit = f'${tag}${doc}${tag}$'
    coloane = ', '.join(V.COLOANE)
    valori = ', '.join(f"(d.j->>'{c}')::numeric" for c in V.COLOANE)
    return (
        "SET LOCAL client_min_messages = warning;\n"
        "SET LOCAL statement_timeout = '30s';\n"
        f"WITH d AS (SELECT {lit}::jsonb AS j),\n"
        "c AS (\n"
        f"  INSERT INTO public.bmw_cardata_citiri (id_citire, citit_la, vin, odometru_la, {coloane}, sursa)\n"
        "  SELECT (d.j->>'id_citire')::uuid, (d.j->>'citit_la')::timestamptz, d.j->>'vin', (d.j->>'odometru_la')::timestamptz,\n"
        f"         {valori}, d.j->>'sursa'\n"
        "  FROM d\n"
        "  ON CONFLICT (id_citire) DO NOTHING\n"
        "  RETURNING id, citit_la\n"
        "),\n"
        "l AS (\n"
        "  INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, pozitie_la, lat, lon, heading)\n"
        "  SELECT c.id, c.citit_la, (d.j->'locatie'->>'pozitie_la')::timestamptz, (d.j->'locatie'->>'lat')::numeric,\n"
        "         (d.j->'locatie'->>'lon')::numeric, (d.j->'locatie'->>'heading')::numeric\n"
        "  FROM c CROSS JOIN d\n"
        "  WHERE jsonb_typeof(d.j->'locatie') = 'object'\n"
        "  RETURNING 1\n"
        "),\n"
        "b AS (\n"   # brutul: tabel DOAR owner (Copilot r1 P1-1), nu in citiri (vizibil modulului logistica)
        "  INSERT INTO public.bmw_cardata_brut (citire_id, citit_la, raspuns_brut)\n"
        "  SELECT c.id, c.citit_la, d.j->'raspuns_brut'\n"
        "  FROM c CROSS JOIN d\n"
        "  RETURNING 1\n"
        ")\n"
        "SELECT 'BMW_REZULTAT|' || coalesce((SELECT id::text FROM c), 'deja') || '|' || (SELECT count(*) FROM l)\n"
        "       || '|' || (SELECT count(*) FROM b);\n"
    )


def mediu_psql(sslmode):
    env = {k: v for k, v in os.environ.items() if k not in MEDIU_SCOS}
    env.update({'PGCLIENTENCODING': 'UTF8', 'PGSSLMODE': sslmode, 'PGAPPNAME': 'bmw_cardata', 'PGCONNECT_TIMEOUT': '20'})
    return env


def ruleaza_psql(sql, psql=PSQL_IMPLICIT, pg=None):
    """Ruleaza SQL-ul generat; intoarce (id_bd | 'deja', randuri_locatie). EroareScriere cu un extras scurt de eroare."""
    pg = dict(PG_IMPLICIT, **(pg or {}))
    for k, tipar in (('host', r'^[A-Za-z0-9.-]{1,253}$'), ('port', r'^\d{1,5}$'), ('user', r'^[A-Za-z0-9_.-]{1,63}$'),
                     ('db', r'^[A-Za-z0-9_]{1,63}$'), ('sslmode', r'^(require|verify-ca|verify-full|disable|prefer)$')):
        if not re.match(tipar, str(pg[k])):
            raise EroareScriere(f'parametru de conexiune invalid: {k}')
    d = tempfile.mkdtemp(prefix='bmw_cardata_sql_')
    try:
        cale = os.path.join(d, 'scrie.sql')
        with open(cale, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
        cmd = [psql, '-X', '-w', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
               '-h', pg['host'], '-p', str(pg['port']), '-U', pg['user'], '-d', pg['db'], '-f', cale]
        try:
            r = subprocess.run(cmd, env=mediu_psql(pg['sslmode']), capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=90)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise EroareScriere(f'psql nu a putut rula: {type(e).__name__}')
        if r.returncode != 0:
            linii = [l for l in (r.stderr or '').splitlines() if re.search(r'ERROR|FATAL|DETAIL|HINT|psql:', l)]
            raise EroareScriere('psql a esuat (cod %d): %s' % (r.returncode, ' | '.join(l[:300] for l in linii[:4]) or 'fara mesaj'))
        m = REZULTAT_RE.search(r.stdout or '')
        if not m:
            raise EroareScriere('psql nu a intors linia BMW_REZULTAT — starea scrierii trebuie verificata manual')
        id_bd, loc, brut = m.group(1), int(m.group(2)), int(m.group(3))
        if (id_bd == 'deja') != (brut == 0) or brut > 1 or loc > 1:
            raise EroareScriere(f'rezultat inconsistent (citire {id_bd}, locatie {loc}, brut {brut}) — verificati manual')
        return id_bd, loc
    finally:
        shutil.rmtree(d, ignore_errors=True)


def scrie(st, psql=PSQL_IMPLICIT, pg=None, rulare=ruleaza_psql, afis=print):
    """Toate citirile locale nescrise -> BD (cate o tranzactie per citire). Intoarce numarul de citiri scrise/confirmate."""
    s = st.setup()
    if not s or not V.vin_valid(s.get('vin')):
        raise EroareScriere('setup lipsa sau VIN invalid — rulati setup')
    fisiere = st.citiri_nescrise()
    if not fisiere:
        afis('nimic de scris (nicio citire locala nescrisa)')
        return 0
    n = 0
    for cale in fisiere:
        nume = os.path.basename(cale)
        try:
            rec_bd = V.reverifica(st.citeste_json(cale), s['vin'])
        except (V.EroareValidare, ValueError, json.JSONDecodeError) as e:
            raise EroareScriere(f'{nume}: {e}')
        id_bd, loc = rulare(construieste_sql(rec_bd), psql=psql, pg=pg)
        st.marcheaza_scrisa(cale, {'id_bd': id_bd, 'randuri_locatie': loc})
        afis(f'{nume}: ' + ('deja in BD (id_citire existent, nimic dublat)' if id_bd == 'deja' else f'scrisa (id {id_bd}, locatie {loc})'))
        n += 1
    return n
