"""Trierea dezacordurilor (laborator OCR 16.10.2026, decizia Razvan A dupa proba arb-v2 pe r1).

Clase (DOAR pe continutul citit; marcajele puse de pipeline - ⟦rowspan⟧, ⟦img⟧, ⟦tabel_neparsat⟧, ⟦…_invalid⟧, ^{ }/_{ } - sunt separate
prin provenienta, compare.segmente_provenienta, nu prin forma textului):
- HIGH_RISK: numerele din continut difera (multiset de tokeni NUMBER, literal) SAU o bara de taiere (⟦barat⟧) exista doar la un cititor;
             orice item pe care provenienta nu se poate stabili (paritate esuata, pozitie lipsa) = HIGH_RISK (fail-closed).
- MARCAJE:   continutul e identic (aceeasi cheie de celula / aceiasi tokeni), difera doar marcajele pipeline-ului.
- DEFER:     continutul difera, dar fara nicio diferenta de numere si fara bara (text, format, decor).
- OM:        structura_tabele / banda_intreaga (merg la om ca pana acum, fara AI).
Nu schimba itemii, amprentele sau contractul cu BD; e o decizie a clientului la arbitraj."""
import collections
from .compare import (TOKEN, NUMBER, segmente_provenienta, segments, flat_text, cell_key, norm_word)

CLASE = ('HIGH_RISK', 'MARCAJE', 'DEFER', 'OM')


def _continut(text, mask):
    return ''.join(ch for ch, m in zip(text, mask) if not m)


def _marcaje(text, mask):
    return ''.join(ch if m else ' ' for ch, m in zip(text, mask))


def _numere(s):
    return collections.Counter(t for t in TOKEN.findall(s) if NUMBER.match(t))


def _tokeni(s):
    return [norm_word(t) for t in TOKEN.findall(s)]


def _pozitii(row):
    r = list(row)
    while r and not cell_key(r[-1]): r.pop()
    return [(len(r) - i, sorted(_numere(c).elements())) for i, c in enumerate(r) if _numere(c)]


def _bare(s):
    return s.count('⟦barat')


def _structura_diferita(raw_a, raw_b):
    sa, sb = segments(raw_a), segments(raw_b)
    return (sum(1 for s in sa if s[0] == 'table') > 0) != (sum(1 for s in sb if s[0] == 'table') > 0)


def _fragment(prov, sursa):
    """Continutul + marcajele fragmentului unui item text (sursa = seg, start, end in segmentele comparate)."""
    if sursa is None: return '', ''
    segs, masti = prov; s0, s1 = sursa['seg']; c, m = [], []
    for si in range(s0, s1 + 1):
        kind, val = segs[si]
        if kind != 'text': m.append('⟦tabel⟧'); continue
        a = sursa['start'] if si == s0 else 0; b = sursa['end'] if si == s1 else len(val)
        c.append(_continut(val[a:b], masti[si][a:b])); m.append(_marcaje(val[a:b], masti[si][a:b]))
    return '\n'.join(c), ' '.join(m)


def _rand(prov, poz):
    if poz is None: return None, None
    segs, masti = prov; si, ri = poz
    kind, val = segs[si]
    if kind != 'table': raise ValueError('pozitia nu e un tabel')
    cells = val[ri]; mk = masti[si][ri]
    return [_continut(c, m) for c, m in zip(cells, mk)], ' '.join(_marcaje(c, m) for c, m in zip(cells, mk))


def clasa(item, pa, pb):
    """pa / pb = segmente_provenienta pentru LightOn / MinerU (aceeasi aplatizare ca la comparare) sau None."""
    if item['tip'] in ('structura_tabele', 'banda_intreaga'): return 'OM', item['tip']
    if pa is None or pb is None: return 'HIGH_RISK', 'provenienta nestabilita (paritate)'
    try:
        if item['tip'] == 'text':
            ca, ma = _fragment(pa, (item.get('sursa') or {}).get('lighton')); cb, mb = _fragment(pb, (item.get('sursa') or {}).get('mineru'))
            if _numere(ca) != _numere(cb): return 'HIGH_RISK', 'numere diferite in continut'
            if _bare(ma) != _bare(mb): return 'HIGH_RISK', 'bara de taiere la un singur cititor'
            if _tokeni(ca) == _tokeni(cb): return 'MARCAJE', 'continut identic, difera marcajele'
            return 'DEFER', 'continut diferit fara numere'
        ra, ma = _rand(pa, item['pozitie']['lighton']); rb, mb = _rand(pb, item['pozitie']['mineru'])
        if ra is None or rb is None:  # rand doar la un cititor
            rand, mk = (rb, mb) if ra is None else (ra, ma)
            if _numere(' '.join(rand)) or _bare(mk): return 'HIGH_RISK', 'rand lipsa la un cititor, cu numere'
            return 'DEFER', 'rand lipsa la un cititor, fara numere'
        if _numere(' '.join(ra)) != _numere(' '.join(rb)): return 'HIGH_RISK', 'numere diferite in continut'
        if _bare(ma) != _bare(mb): return 'HIGH_RISK', 'bara de taiere la un singur cititor'
        if [cell_key(c) for c in ra] == [cell_key(c) for c in rb]: return 'MARCAJE', 'celule identice, difera marcajele'
        # numerele egale ca multiset dar mutate intre celule (ex. cantitatea in alta coloana) = risc pe cantitati. Pozitia se masoara de la
        # CAPATUL randului dupa taierea celulelor goale de la coada (ca regula A: LightOn / MinerU difera la celulele goale finale)
        if _pozitii(ra) != _pozitii(rb): return 'HIGH_RISK', 'numere mutate intre celule'
        return 'DEFER', 'celule diferite fara numere'
    except (IndexError, KeyError, TypeError, ValueError):
        return 'HIGH_RISK', 'pozitie nerezolvata'


def triaza_banda(raw_a, raw_b, items):
    """{item_id: (clasa, motiv)} pentru dezacordurile unei benzi (aceeasi aplatizare ca compare_band)."""
    flat = _structura_diferita(raw_a, raw_b)
    pa, pb = segmente_provenienta(raw_a, flat), segmente_provenienta(raw_b, flat)
    return {it['id']: clasa(it, pa, pb) for it in items}
