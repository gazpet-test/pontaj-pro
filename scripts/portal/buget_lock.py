#!/usr/bin/env python3
"""r9 (al doilea recenzent r8, P1-01): contractul static al bugetului de lock pentru 18a / 19a si revenirile lor.

Folosit de test_static.py si test_static_1b.py (si pe mutanti). Nu inlocuieste proba din harness
(scripts/portal/concurrency_lock.sh), care masoara efectiv modurile tinute si asteptarea utilizatorilor.
probleme(sql, moduri) intoarce lista abaterilor; goala = acceptat.
"""
import re

TABELE_UTILIZATORI = ('auth.users', 'public.employees', 'public.profiles', 'public.user_module_access')
PRIMA_SCHIMBARE = re.compile(r'^(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|COMMENT)\b', re.M)


def _instructiuni_lock(text):
    return re.findall(r'LOCK TABLE ([^;]*?) IN ([A-Z ]+?) MODE( NOWAIT)?;', text)


def probleme(sql, moduri):
    """moduri = {tabel: 'SHARE ROW EXCLUSIVE' | 'SHARE' | 'ACCESS EXCLUSIVE'} asteptat in blocul $locks$."""
    sql = sql.replace('\r\n', '\n')
    p = []
    i_timeout = sql.find("\nSET LOCAL lock_timeout = '3s';\n")
    i_stmt = sql.find("\nSET LOCAL statement_timeout = '15s';\n")
    if i_timeout < 0 or i_stmt < 0:
        return ['lock_timeout / statement_timeout lipsa']
    if sql.count('DO $locks$') != 1 or sql.count('END $locks$;') != 1:
        return ['blocul $locks$ trebuie sa apara exact o data']
    a = sql.index('DO $locks$')
    b = sql.index('END $locks$;')
    bloc, afara = sql[a:b], sql[:a] + sql[b:]
    prima_lock = sql.find('LOCK TABLE')
    if not (i_timeout < prima_lock and i_stmt < prima_lock):
        p.append('lock_timeout dupa primul LOCK')
    # Pe tabelele utilizatorilor: numai in $locks$, toate cu NOWAIT, cu modurile asteptate.
    for tabele, _, _ in _instructiuni_lock(afara):
        for t in (x.strip() for x in tabele.split(',')):
            if t in TABELE_UTILIZATORI:
                p.append('LOCK in afara $locks$: ' + t)
    gasite = {}
    for tabele, mod, nowait in _instructiuni_lock(bloc):
        if not nowait:
            p.append('LOCK fara NOWAIT in $locks$: ' + tabele)
        for t in (x.strip() for x in tabele.split(',')):
            if t in TABELE_UTILIZATORI:
                gasite[t] = mod.strip()
    if gasite != moduri:
        p.append(f'moduri {gasite} != {moduri}')
    if "interval '3 seconds'" not in bloc or 'PORTAL_LOCK_BUDGET' not in bloc or "USING ERRCODE = '55P03'" not in bloc \
            or 'WHEN lock_not_available' not in bloc or 'pg_sleep(0.05)' not in bloc:
        p.append('bucla $locks$ incompleta (buget 3 s / 55P03 / NOWAIT prins / pauza)')
    # Preflight-ul de drepturi inaintea primei schimbari (DO-urile de garda si SET LOCAL nu sunt schimbari).
    m = PRIMA_SCHIMBARE.search(sql)
    i_priv = sql.find('DO $priv$')
    if i_priv < 0 or 'PORTAL_PRIVILEGES_MISSING' not in sql or (m and m.start() < i_priv):
        p.append('preflight $priv$ lipsa sau dupa prima schimbare')
    return p
