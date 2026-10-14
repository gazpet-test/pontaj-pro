"""Pasul 5 (CPU): textul reconciliat pe pagina, din citirea LightOn + deciziile arbitrului pe dezacorduri.
Arbitrajul insusi NU e aici (edge ofertare-ocr-arbitreaza, D3b): aici doar se valideaza deciziile si se aplica.
Fail-closed: dezacord fara decizie valida = needs_human; o pagina cu orice needs_human NU e propusa pentru promovare.
Pastreaza tripletul (citire LightOn / citire MinerU / ales) pentru fiecare dezacord - tripleti.jsonl, append-only la nivel de rulare."""
import json, pathlib
from .compare import segments, tokens, flat_text, table_rows, match_rows
from .plan import load_plan, save

DECIZII = ('ales_lighton', 'ales_mineru', 'text_propus', 'needs_human')

def valid_decision(d):
    """Schema stricta (spec §3). Orice abatere = invalid (tratat ca needs_human)."""
    if not isinstance(d, dict): return False
    if set(d) - {'id', 'decizie', 'text', 'motiv', 'e_cantitate', 'anomalie_separator', 'arbitru_model', 'prompt_versiune', 'cost_usd'}: return False
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
        else: out.append('\n'.join('| ' + ' | '.join(r) + ' |' for r in val))
    return '\n\n'.join(x for x in out if x.strip())

def apply_band(raw_a, raw_b, items, decisions):
    """Returneaza (text_reconciliat, needs_human: bool). Baza = citirea LightOn (literal), segmentata ca la comparare."""
    sa = segments(raw_a); sb = segments(raw_b)
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
        pa = it['pozitie']['lighton']; new = chosen(it, d)
        cells = [c.strip() for c in new.split(' | ')] if new.strip() else []
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
            if anchor is None: needs = True; continue
            add.setdefault(tuple(anchor), []).append(cells)
    for si, (kind, val) in enumerate(segs):
        if kind != 'table': continue
        new_rows = []
        for ri, r in enumerate(val):
            if (si, ri) not in drop: new_rows.append(rows.get((si, ri), r))
            new_rows += add.get((si, ri), [])
        segs[si][1] = new_rows
    return render([tuple(s) for s in segs]), needs

def join_bands(texts, signals, min_n=3, max_n=120):
    """Benzile pas6 se suprapun (doua randuri de cerneala complete). Se taie din banda urmatoare cel mai lung inceput
    identic (dupa tokeni, ș/ş unificate) cu sfarsitul benzii precedente, minimum 3 tokeni. Fara suprapunere gasita = semnal, nu ghicit."""
    from .compare import TOKEN, norm_word
    out = texts[0] if texts else ''
    for k, nxt in enumerate(texts[1:], 1):
        ta = [norm_word(m.group(0)) for m in TOKEN.finditer(out)]; mb = list(TOKEN.finditer(nxt)); tb = [norm_word(m.group(0)) for m in mb]
        n = next((n for n in range(min(max_n, len(ta), len(tb)), min_n - 1, -1) if ta[-n:] == tb[:n]), 0)
        if n: out = out + '\n' + nxt[mb[n - 1].end():].lstrip(); signals.append({'type': 'cusatura_suprapunere_taiata', 'banda': k, 'tokeni': n})
        else: out = out + '\n' + nxt; signals.append({'type': 'cusatura_fara_suprapunere', 'banda': k, 'certitudine': 'euristica'})
    return out

def reconcile(plan_dir, decisions_path):
    plan_dir = pathlib.Path(plan_dir); doc = load_plan(plan_dir)
    items = [json.loads(l) for l in (plan_dir / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    by_id = {i['id']: i for i in items}; decisions = {}; invalid = []
    for line in pathlib.Path(decisions_path).read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        try: d = json.loads(line)
        except ValueError: invalid.append({'motiv': 'json_invalid'}); continue
        if d.get('id') not in by_id: invalid.append({'id': d.get('id'), 'motiv': 'id_necunoscut'}); continue
        if d['id'] in decisions: invalid.append({'id': d['id'], 'motiv': 'decizie_dubla'}); decisions[d['id']] = None; continue
        decisions[d['id']] = d if valid_decision(d) else None
        if decisions[d['id']] is None: invalid.append({'id': d['id'], 'motiv': 'schema'})
    decisions = {k: v for k, v in decisions.items() if v is not None}
    pages = {}; triplets = []
    for band in doc['bands']:
        d = plan_dir / ('page%04d' % band['page']) / band['id']
        raw_a = (d / 'lighton' / 'raw.txt').read_text(encoding='utf-8'); raw_b = (d / 'mineru' / 'raw.txt').read_text(encoding='utf-8')
        bi = [i for i in items if i['band'] == band['id']]
        text, needs = apply_band(raw_a, raw_b, bi, decisions)
        p = pages.setdefault(band['page'], {'page': band['page'], 'bands': [], 'needs_human': False, 'arbitrat_de_claude_cantitati': 0})
        p['bands'].append({'band': band['id'], 'text': text, 'needs_human': needs, 'dezacorduri': len(bi)})
        p['needs_human'] = p['needs_human'] or needs
        for i in bi:
            dec = decisions.get(i['id'])
            if dec and i['e_cantitate'] and dec['decizie'] != 'needs_human': p['arbitrat_de_claude_cantitati'] += 1
            triplets.append({'id': i['id'], 'band': i['band'], 'page': i['page'], 'tip': i['tip'], 'image_sha256': i['image_sha256'],
                             'citire_lighton': i['citire_lighton'], 'citire_mineru': i['citire_mineru'],
                             'decizie': dec['decizie'] if dec else 'needs_human', 'text_ales': chosen(i, dec) if dec and dec['decizie'] != 'needs_human' else None,
                             'motiv': dec['motiv'] if dec else 'fara decizie valida (fail-closed)', 'e_cantitate': i['e_cantitate'],
                             'anomalie_separator': i['anomalie_separator'] or bool(dec and dec['anomalie_separator']),
                             'arbitrat_de': 'claude' if dec else None, 'arbitru_model': dec.get('arbitru_model') if dec else None,
                             'prompt_versiune': dec.get('prompt_versiune') if dec else None})
    for p in pages.values():
        p['semnale'] = []
        p['text'] = None if p['needs_human'] else join_bands([b['text'] for b in p['bands']], p['semnale'])
    out = {'pages': sorted(pages.values(), key=lambda x: x['page']), 'invalid_decisions': invalid,
           'summary': {'pages': len(pages), 'needs_human_pages': sum(1 for p in pages.values() if p['needs_human']),
                       'decisions_valid': len(decisions), 'decisions_invalid': len(invalid), 'disagreements': len(items)}}
    save(plan_dir / 'reconciliat.json', out)
    with (plan_dir / 'tripleti.jsonl').open('x', encoding='utf-8') as f:
        for t in triplets: f.write(json.dumps(t, ensure_ascii=False) + '\n')
    return out
