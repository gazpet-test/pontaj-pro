"""Banda goala (25.11.2026): o iesire GOALA a cititorului e rezultat valid DOAR pe o banda ALBA dovedita din imagine.

Cazul real (coada Lot 2): o banda de margine (1240x402, medie 254,8, deviatie 2,3) cu doar doua linii verticale palide de tabel;
LightOn raspunde corect cu nimic (finish_reason=stop, 1 token) si, inainte, tot documentul se oprea (ok=False -> stopped_no_retry).

Pragurile sunt alese pe toate cele 2.344 de benzi ale planurilor Lot 2 (masuratorile sunt in descrierea PR-ului):
  - un pragul simplu „< 0,1% pixeli sub 128” NU e sigur: o singura cifra de pagina („7”) are 26 de pixeli sub 128 (0,003%), iar o banda
    cu paragrafe intregi de text foarte palid are deviatie 1,7 (mai mica decat a benzii albe) si doar 24 de pixeli sub 128;
  - de aceea banda e alba doar daca: (a) NICIUN pixel sub 128 (banda alba reala: cel mai inchis pixel = 146; orice banda cu text din
    Lot 2 are cel putin 24), (b) deviatia standard < 6, (c) urmele de cerneala oricat de palida (pixeli sub 245, componente conexe pe
    8 vecini) sunt numai segmente subtiri si drepte (linii de tabel / chenar: grosime <= 5 px, lungime >= 12 px si >= 4 x grosimea) sau
    praf (fiecare pata <= 4 px - sub cel mai mic semn tiparit: punctul de 10 pt la 150 dpi are ~9 px - si cel mult 20 px in total).
    Textul palid se rupe in zeci de pete rotunde (3x4, 6x5 px), deci pica la (c) chiar fara (a).
Orice imagine care nu se poate masura (decodare, PIL lipsa, dimensiune) = NU e alba (fail-closed: banda ramane esec, ca inainte).
Ce nu se poate dovedi din pixeli (o cifra izolata, foarte palida, in forma de bara, ex. „1”) ramane acoperit de al doilea cititor:
compara trateaza banda goala la unul + text la celalalt ca dezacord (banda_intreaga, la om)."""
import io

VERSIUNE = 'banda-alba-v1'
PRAG_INTUNECAT = 128      # pixel < 128 = cerneala reala (text, cifra, pata neagra): unul singur ajunge ca banda sa NU fie alba
PRAG_STD = 6.0            # deviatia standard a nivelului de gri (0-255) trebuie sa fie strict sub
PRAG_CERNEALA = 245       # pixel < 245 = urma de cerneala, oricat de palida (fundalul scanat sta la 250-255)
LINIE_GROSIME = 5         # segment subtire: latura mica a chenarului <= 5 px
LINIE_LUNGIME = 12        # ... latura mare >= 12 px
LINIE_RAPORT = 4          # ... si >= 4 x latura mica
PRAF_COMPONENTA = 4       # o pata ne-liniara de cel mult 4 px = praf
PRAF_TOTAL = 20           # praful adunat: cel mult 20 px
MAX_PIXELI = 16_000_000   # benzile au ~1 Mpx; peste = nu masuram (fail-closed)


def _linie(latime, inaltime):
    gros, lung = min(latime, inaltime), max(latime, inaltime)
    return gros <= LINIE_GROSIME and lung >= LINIE_LUNGIME and lung >= LINIE_RAPORT * gros


def _componente(im):
    """Componentele conexe (8 vecini) ale pixelilor < PRAG_CERNEALA: (pixeli, latime, inaltime). Apelat doar dupa (a) si (b),
    deci pe putini pixeli."""
    w, h = im.size
    masca = im.point(lambda v: 255 if v < PRAG_CERNEALA else 0)
    bb = masca.getbbox()
    if not bb: return
    mp = masca.load(); vazut = bytearray(w * h)
    for y0 in range(bb[1], bb[3]):
        for x0 in range(bb[0], bb[2]):
            if not mp[x0, y0] or vazut[y0 * w + x0]: continue
            stiva = [(x0, y0)]; vazut[y0 * w + x0] = 1; n = 0; x1 = x2 = x0; y1 = y2 = y0
            while stiva:
                x, y = stiva.pop(); n += 1
                if x < x1: x1 = x
                elif x > x2: x2 = x
                if y < y1: y1 = y
                elif y > y2: y2 = y
                for yy in (y - 1, y, y + 1):
                    if 0 <= yy < h:
                        for xx in (x - 1, x, x + 1):
                            if 0 <= xx < w and mp[xx, yy] and not vazut[yy * w + xx]:
                                vazut[yy * w + xx] = 1; stiva.append((xx, yy))
            yield n, x2 - x1 + 1, y2 - y1 + 1


def masoara(image_bytes):
    """Masurile benzii si verdictul {'alba': bool, 'motiv': ...}. Nu arunca: orice esec de masurare = alba False."""
    m = {'versiune': VERSIUNE, 'alba': False}
    try:
        from PIL import Image, ImageStat
        im = Image.open(io.BytesIO(image_bytes))
        if im.size[0] < 1 or im.size[1] < 1 or im.size[0] * im.size[1] > MAX_PIXELI:
            m['motiv'] = 'dimensiune'; return m
        im = im.convert('L')
    except Exception as exc:  # imagine nedecodabila / PIL lipsa: nu se poate dovedi nimic
        m['motiv'] = 'imagine_nedecodabila:' + type(exc).__name__; return m
    hist = im.histogram(); n = im.size[0] * im.size[1]
    m.update(latime=im.size[0], inaltime=im.size[1], medie=round(sum(i * c for i, c in enumerate(hist)) / n, 3),
             pixeli_intunecati=sum(hist[:PRAG_INTUNECAT]), cel_mai_inchis=next(i for i, c in enumerate(hist) if c))
    if m['pixeli_intunecati'] > 0:
        m['motiv'] = 'pixeli_sub_%d' % PRAG_INTUNECAT; return m
    m['deviatie'] = round(ImageStat.Stat(im).stddev[0], 3)
    if not m['deviatie'] < PRAG_STD:
        m['motiv'] = 'deviatie'; return m
    linii = praf = pete = 0
    for px, lat, ina in _componente(im):
        if _linie(lat, ina): linii += 1; continue
        if px > PRAF_COMPONENTA:
            m.update(motiv='cerneala_ne_liniara', pata=[px, lat, ina]); return m
        praf += px; pete += 1
    m.update(segmente_linie=linii, praf_px=praf, praf_pete=pete)
    if praf > PRAF_TOTAL:
        m['motiv'] = 'praf_peste_prag'; return m
    m.update(alba=True, motiv='alba'); return m


def alba(image_bytes):
    return masoara(image_bytes)['alba'] is True


def iesire_goala(reader, raw, res):
    """Cititorul a terminat curat si n-a scris nimic: text vid dupa strip, fara eroare / termen / semnal sau eveniment de garda;
    LightOn cu finish_reason = stop; MinerU fara niciun bloc de layout cu text. Altfel (ex. max_tokens / length) nu e „nimic”."""
    if not isinstance(raw, str) or raw.strip(): return False
    if res.get('error') or res.get('signal') or res.get('guard_event'): return False
    if reader == 'lighton': return res.get('finish_reason') == 'stop'
    if reader == 'mineru': return res.get('blocuri_cu_text') == 0
    return False


def aplica(reader, raw, res, image_bytes):
    """Pe loc, pe rezultatul unei citiri: iesire goala curata + banda alba dovedita -> ok True, banda_goala True (si masurile).
    Iesire goala pe banda NE-alba -> ramane esec (ok False), cu masurile notate ca motiv. Restul rezultatelor: neatinse."""
    if res.get('ok') is True or not iesire_goala(reader, raw, res): return res
    m = masoara(image_bytes); res['banda_alba'] = m
    if m['alba']: res['ok'] = True; res['banda_goala'] = True
    return res


def e_goala(raw, res):
    """Pentru compara: banda goala valida = rezultat ok marcat banda_goala SI text efectiv vid (marcaj fara text vid = neconsistent)."""
    return res.get('ok') is True and res.get('banda_goala') is True and isinstance(raw, str) and not raw.strip()
