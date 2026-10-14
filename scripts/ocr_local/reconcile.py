"""Pasul 5 (CPU): textul reconciliat pe pagina, din citirea LightOn + deciziile arbitrului pe dezacorduri.
Arbitrajul insusi NU e aici (edge ofertare-ocr-arbitreaza, D3b): aici doar se valideaza deciziile si se aplica.
Fail-closed: dezacord fara decizie valida = needs_human; o pagina cu orice needs_human NU e propusa pentru promovare.
Pastreaza tripletul (citire LightOn / citire MinerU / ales) pentru fiecare dezacord - tripleti.jsonl, append-only la nivel de rulare."""
import json, pathlib
import hashlib
import os
from .compare import segments, tokens, flat_text, table_rows, compare_band, item_hash, canonical, check_result
from .plan import load_plan, save

DECIZII = ('ales_lighton', 'ales_mineru', 'text_propus', 'needs_human')

def arbiter_policy():
    return json.loads((pathlib.Path(__file__).parent / 'protocol.json').read_text(encoding='utf-8'))['arbitru']

def valid_decision(d, item=None, policy=None):
    """Schema stricta (spec §3) + provenienta: amprenta dezacordului identica (item_sha256), model si versiune de prompt
    din lista admisa in protocol.json. Orice abatere = invalid (tratat ca needs_human)."""
    if not isinstance(d, dict): return False
    if set(d) - {'id', 'item_sha256', 'decizie', 'text', 'motiv', 'e_cantitate', 'anomalie_separator', 'arbitru_model', 'prompt_versiune', 'cost_usd'}: return False
    policy = policy or arbiter_policy()
    if item is not None and d.get('item_sha256') != item.get('item_sha256'): return False
    if d.get('arbitru_model') not in policy['modele_admise'] or d.get('prompt_versiune') not in policy['prompt_versiuni_admise']: return False
    if d.get('decizie') not in DECIZII or not isinstance(d.get('text'), str) or not isinstance(d.get('motiv'), str): return False
    if len(d['motiv']) > 200 or not isinstance(d.get('e_cantitate'), bool) or not isinstance(d.get('anomalie_separator'), bool): return False
    if d['decizie'] == 'needs_human' and d['text']: return False
    if d['decizie'] == 'text_propus' and not d['text'].strip(): return False
    return True

def chosen(item, dec):
    if dec['decizie'] == 'ales_lighton': return item['citire_lighton']
    if dec['decizie'] == 'ales_mineru': return item['citire_mineru']
    return dec['text']

def render(segs):
    out = []
    for kind, val in segs:
        if kind == 'text': out.append(val)
        else: out.append('\n'.join('| ' + ' | '.join(c.replace('|', '\\|') for c in r) + ' |' for r in val))  # '|' din celula, escapat
    return '\n\n'.join(x for x in out if x.strip())

def apply_band(raw_a, raw_b, items, decisions):
    """Returneaza (text_reconciliat, needs_human: bool). Baza = citirea LightOn (literal), segmentata ca la comparare."""
    sa = segments(raw_a); sb = segments(raw_b)
    for it in items:
        if it['tip'] == 'structura_tabele':
            d = decisions.get(it['id'])
            if d is None or d['decizie'] != 'ales_lighton': needs_struct = True; break
    else: needs_struct = False
    if needs_struct: return None, True
    if any(i['tip'] == 'banda_intreaga' for i in items):
        it = items[0]; d = decisions.get(it['id'])
        if d is None or d['decizie'] == 'needs_human': return None, True
        return render(segments(chosen(it, d))), False
    if any(i.get('semnal') == 'structura_diferita' for i in items) or ((sum(s[0] == 'table' for s in sa) > 0) != (sum(s[0] == 'table' for s in sb) > 0)):
        sa = flat_text(sa)
    needs = False
    # text: inlocuiri pe pozitiile tokenilor LightOn, de la dreapta la stanga ca sa nu se mute pozitiile
    ta = tokens(sa); edits = {}
    for it in items:
        if it['tip'] != 'text': continue
        d = decisions.get(it['id'])
        if d is None or d['decizie'] == 'needs_human': needs = True; continue
        if d['decizie'] == 'ales_lighton': continue
        a1, a2 = it['pozitie']['lighton']; new = chosen(it, d)
        if a1 < a2: si, start = ta[a1][1], ta[a1][2]; end = ta[a2 - 1][3]
        elif a1 < len(ta): si, start = ta[a1][1], ta[a1][2]; end = start; new = new + ' '
        elif ta: si, start = ta[-1][1], ta[-1][3]; end = start; new = ' ' + new
        else: needs = True; continue
        if a1 < a2 and ta[a2 - 1][1] != si: needs = True; continue  # dezacord peste doua segmente - nu se coase automat
        edits.setdefault(si, []).append((start, end, new))
    segs = [list(s) for s in sa]
    for si, lst in edits.items():
        txt = segs[si][1]
        for start, end, new in sorted(lst, reverse=True): txt = txt[:start] + new + txt[end:]
        segs[si][1] = txt
    # tabele: randuri inlocuite / adaugate / scoase
    rows = {(si, ri): list(r) for si, ri, r in table_rows(sa)}; drop = set(); add = {}
    for it in items:
        if not it['tip'].startswith('rand_'): continue
        d = decisions.get(it['id'])
        if d is None or d['decizie'] == 'needs_human': needs = True; continue
        pa = it['pozitie']['lighton']
        # celulele se iau ca vectori (nu din textul afisat): o celula care contine ' | ' nu se poate sparge gresit
        if d['decizie'] == 'ales_lighton': cells = it.get('celule_lighton') or []
        elif d['decizie'] == 'ales_mineru': cells = it.get('celule_mineru') or []
        else:
            if any(' | ' in x for x in (it.get('celule_lighton') or []) + (it.get('celule_mineru') or [])): needs = True; continue
            cells = [x.strip() for x in d['text'].split(' | ')] if d['text'].strip() else []
        if it['tip'] == 'rand_tabel':
            if d['decizie'] == 'ales_lighton': continue
            if len(cells) != len(rows[tuple(pa)]) and d['decizie'] == 'text_propus': needs = True; continue
            rows[tuple(pa)] = cells
        elif it['tip'] == 'rand_lipsa_mineru':      # randul exista doar la LightOn
            if d['decizie'] in ('ales_mineru',) or (d['decizie'] == 'text_propus' and not cells): drop.add(tuple(pa))
            elif d['decizie'] == 'text_propus': rows[tuple(pa)] = cells
        else:                                        # rand_lipsa_lighton: randul exista doar la MinerU
            if d['decizie'] == 'ales_lighton': continue
            # se insereaza dupa randul LightOn precedent din aliniere; fara ancora sigura = om
            anchor = it.get('ancora_lighton')
            if anchor is None or not it.get('ancora_sigura'): needs = True; continue
            add.setdefault(tuple(anchor), []).append(cells)
    for si, (kind, val) in enumerate(segs):
        if kind != 'table': continue
        new_rows = []
        for ri, r in enumerate(val):
            if (si, ri) not in drop: new_rows.append(rows.get((si, ri), r))
            new_rows += add.get((si, ri), [])
        segs[si][1] = new_rows
    return render([tuple(s) for s in segs]), needs

def join_bands(texts, signals, min_tokens=8, max_lines=3):
    """Benzile pas6 se suprapun cu 1-3 randuri intregi (doua randuri de cerneala). Se taie din banda urmatoare primele k randuri
    (k = 1..3, cel mai mare) DOAR daca sunt identice (tokeni, ș/ş unificate) cu ultimele k randuri INTREGI ale benzii precedente si au
    impreuna >= 8 tokeni. Comparatie pe randuri complete, nu pe tokeni oarecare. Altfel cusatura e nesigura: None (pagina -> needs_human)."""
    from .compare import TOKEN, norm_word
    key = lambda line: [norm_word(t) for t in TOKEN.findall(line)]
    out = texts[0] if texts else ''
    for k, nxt in enumerate(texts[1:], 1):
        la = [l for l in out.split('\n') if l.strip()]; lb = nxt.split('\n'); lbn = [i for i, l in enumerate(lb) if l.strip()]
        best = 0
        for n in range(min(max_lines, len(la), len(lbn)), 0, -1):
            if [key(l) for l in la[-n:]] == [key(lb[i]) for i in lbn[:n]] and sum(len(key(l)) for l in la[-n:]) >= min_tokens: best = n; break
        if best:
            out = out + '\n' + '\n'.join(lb[lbn[best - 1] + 1:]).lstrip('\n'); signals.append({'type': 'cusatura_suprapunere_taiata', 'banda': k, 'randuri': best})
        else:
            signals.append({'type': 'cusatura_nesigura', 'banda': k}); return None
    return out

def reconcile(plan_dir, decisions_path):
    plan_dir = pathlib.Path(plan_dir); doc = load_plan(plan_dir)
    items = [json.loads(l) for l in (plan_dir / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    from .read import protocol
    proto = protocol()
    if len({i['id'] for i in items}) != len(items): raise ValueError('ID-uri duplicate in dezacorduri.jsonl')
    by_id = {i['id']: i for i in items}; decisions = {}; invalid = []; policy = arbiter_policy()
    if (plan_dir / 'tripleti.jsonl').exists() or (plan_dir / 'reconciliat.json').exists():
        raise FileExistsError('Reconcilierea a rulat deja in acest director - o rulare noua = director nou')
    for line in pathlib.Path(decisions_path).read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        try: d = json.loads(line)
        except ValueError: invalid.append({'motiv': 'json_invalid'}); continue
        if not isinstance(d, dict) or not isinstance(d.get('id'), str): invalid.append({'motiv': 'nu_e_obiect_cu_id'}); continue
        if d.get('id') not in by_id: invalid.append({'id': d.get('id'), 'motiv': 'id_necunoscut'}); continue
        if d['id'] in decisions: invalid.append({'id': d['id'], 'motiv': 'decizie_dubla'}); decisions[d['id']] = None; continue
        decisions[d['id']] = d if valid_decision(d, by_id[d['id']], policy) else None
        if decisions[d['id']] is None: invalid.append({'id': d['id'], 'motiv': 'schema'})
    decisions = {k: v for k, v in decisions.items() if v is not None}
    pages = {}; triplets = []
    for band in doc['bands']:
        d = plan_dir / ('page%04d' % band['page']) / band['id']
        raw_a = (d / 'lighton' / 'raw.txt').read_bytes().decode('utf-8'); raw_b = (d / 'mineru' / 'raw.txt').read_bytes().decode('utf-8')
        bi = [i for i in items if i['band'] == band['id']]
        # integritate: citirile de azi = cele din result.json si cele comparate; dezacordurile = exact ce produce comparatia acum
        res = {r: json.loads((d / r / 'result.json').read_text(encoding='utf-8')) for r in ('lighton', 'mineru')}
        for r, raw in (('lighton', raw_a), ('mineru', raw_b)):
            if hashlib.sha256(raw.encode()).hexdigest() != res[r].get('raw_sha256') or not check_result(res[r], r, band, proto):
                raise ValueError('Citirea %s a benzii %s nu mai corespunde rezultatului' % (r, band['id']))
        _, fresh = compare_band(band, raw_a, res['lighton'], raw_b, res['mineru'])
        for x in fresh: x['plan_input_sha256'] = doc['input_sha256']
        # egalitate canonica COMPLETA (toate campurile, in ordine) intre dezacordurile salvate si comparatia refacuta acum
        if [canonical(x) for x in fresh] != [canonical(i) for i in bi] or any(item_hash(i) != i.get('item_sha256') for i in bi):
            raise ValueError('dezacorduri.jsonl nu corespunde citirilor pentru banda %s - ruleaza din nou compara' % band['id'])
        text, needs = apply_band(raw_a, raw_b, bi, decisions)
        p = pages.setdefault(band['page'], {'page': band['page'], 'bands': [], 'needs_human': False, 'arbitrat_de_claude_cantitati': 0})
        p['bands'].append({'band': band['id'], 'text': text, 'needs_human': needs, 'dezacorduri': len(bi)})
        p['needs_human'] = p['needs_human'] or needs
        for i in bi:
            dec = decisions.get(i['id'])
            e_cant = bool(i['e_cantitate'] or (dec and dec['e_cantitate']))  # marcajul arbitrului se adauga, nu se pierde
            if dec and e_cant and dec['decizie'] != 'needs_human': p['arbitrat_de_claude_cantitati'] += 1
            triplets.append({'id': i['id'], 'band': i['band'], 'page': i['page'], 'tip': i['tip'], 'image_sha256': i['image_sha256'],
                             'citire_lighton': i['citire_lighton'], 'citire_mineru': i['citire_mineru'],
                             'decizie': dec['decizie'] if dec else 'needs_human', 'text_ales': chosen(i, dec) if dec and dec['decizie'] != 'needs_human' else None,
                             'motiv': dec['motiv'] if dec else 'fara decizie valida (fail-closed)', 'e_cantitate': e_cant,
                             'anomalie_separator': i['anomalie_separator'] or bool(dec and dec['anomalie_separator']),
                             'arbitrat_de': 'claude' if dec else None, 'item_sha256': i.get('item_sha256'), 'arbitru_model': dec.get('arbitru_model') if dec else None,
                             'prompt_versiune': dec.get('prompt_versiune') if dec else None})
    for p in pages.values():
        p['semnale'] = []
        p['text'] = None if p['needs_human'] else join_bands([b['text'] for b in p['bands']], p['semnale'])
        if p['text'] is None: p['needs_human'] = True
    out = {'pages': sorted(pages.values(), key=lambda x: x['page']), 'invalid_decisions': invalid,
           'summary': {'pages': len(pages), 'needs_human_pages': sum(1 for p in pages.values() if p['needs_human']),
                       'decisions_valid': len(decisions), 'decisions_invalid': len(invalid), 'disagreements': len(items)}}
    # ambele artefacte se scriu intai temporar si se publica impreuna; nicio pereche partiala daca scrierea pica la mijloc
    tmp = {'tripleti.jsonl': ''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in triplets),
           'reconciliat.json': json.dumps(out, ensure_ascii=False, indent=2)}
    for name, body in tmp.items():
        with (plan_dir / (name + '.tmp')).open('x', encoding='utf-8', newline='\n') as f: f.write(body)
    if any((plan_dir / n).exists() for n in tmp): raise FileExistsError('Reconcilierea a rulat deja in acest director')
    for name in tmp: os.rename(plan_dir / (name + '.tmp'), plan_dir / name)
    return out
