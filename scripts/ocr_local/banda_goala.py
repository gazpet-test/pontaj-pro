"""Banda goala (25.11.2026, runda 2 dupa Jakarinos #1196 NO-GO): o iesire GOALA a cititorului NU mai opreste documentul, dar NICIO
banda nu se mai accepta automat ca „alba”. Regula OCR a casei: nimic nu se pierde fara semnal; ambiguu = la om.

Cazul real (coada Lot 2): o banda de margine (1240x402) cu doar doua linii verticale palide de tabel; LightOn raspunde corect cu
nimic (finish_reason=stop, 1 token) si, inainte, tot documentul se oprea (ok=False -> stopped_no_retry).

Regula (DOAR pe calea laboratorului / cozii: read.run_reader(..., gol_de_verificat=True); E3 si clientul Ofertare raman ca pe main):
  - iesirea goala CURATA (iesire_goala: text vid, fara eroare / termen / garda; LightOn finish_reason = stop; MinerU fara bloc de
    layout cu text) pe ORICE imagine -> rezultatul ramane ok = False (nicio cale veche nu o ia drept citire valida) si primeste
    `gol_de_verificat: true`; citirea continua cu benzile urmatoare (rezultat, nu eroare);
  - compara: o banda `gol_de_verificat` la ORICARE cititor = intotdeauna un rand `banda_goala_de_verificat` in dezacorduri.jsonl
    (niciodata acord, nici cand ambii dau gol), cu ce a dat celalalt cititor;
  - masurile pe pixeli (masoara) sunt DOAR informatie in acel rand (`probabil_alba`), fara efect asupra vreunei decizii.
Contraexemplele din review: text gri 245 si „III” gri 200 erau clasificate albe de euristica -> de aceea ea nu mai decide nimic."""
import io

VERSIUNE = 'banda-alba-v2-informativ'
PRAG_INTUNECAT = 128      # pixel < 128 = cerneala reala (text, cifra, pata neagra)
PRAG_STD = 6.0            # deviatia standard a nivelului de gri (0-255)
PRAG_CERNEALA = 245       # pixel < 245 = urma de cerneala, oricat de palida (fundalul scanat sta la 250-255)
LINIE_GROSIME = 5         # segment subtire: latura mica a chenarului <= 5 px
LINIE_LUNGIME = 12        # ... latura mare >= 12 px
LINIE_RAPORT = 4          # ... si >= 4 x latura mica
PRAF_COMPONENTA = 4       # o pata ne-liniara de cel mult 4 px = praf
PRAF_TOTAL = 20           # praful adunat: cel mult 20 px
MAX_PIXELI = 16_000_000   # benzile au ~1 Mpx; peste = nu masuram


def _linie(latime, inaltime):
    gros, lung = min(latime, inaltime), max(latime, inaltime)
    return gros <= LINIE_GROSIME and lung >= LINIE_LUNGIME and lung >= LINIE_RAPORT * gros


def _componente(im):
    """Componentele conexe (8 vecini) ale pixelilor < PRAG_CERNEALA: (pixeli, latime, inaltime)."""
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
    """Masurile benzii {'alba': bool, 'motiv': ...} - INFORMATIE pentru omul care verifica banda, nu decizie.
    Nu arunca: orice esec de masurare = alba False."""
    m = {'versiune': VERSIUNE, 'alba': False}
    try:
        from PIL import Image, ImageStat
        im = Image.open(io.BytesIO(image_bytes))
        if im.size[0] < 1 or im.size[1] < 1 or im.size[0] * im.size[1] > MAX_PIXELI:
            m['motiv'] = 'dimensiune'; return m
        im = im.convert('L')
    except Exception as exc:  # imagine nedecodabila / PIL lipsa
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


def iesire_goala(reader, raw, res):
    """Cititorul a terminat curat si n-a scris nimic: text vid dupa strip, fara eroare / termen / semnal sau eveniment de garda;
    LightOn cu finish_reason = stop; MinerU fara niciun bloc de layout cu text. Altfel (ex. max_tokens / length, eroare de
    transport) nu e „nimic”: ramane esecul de azi (oprire)."""
    if not isinstance(raw, str) or raw.strip(): return False
    if res.get('error') or res.get('signal') or res.get('guard_event'): return False
    if reader == 'lighton': return res.get('finish_reason') == 'stop'
    if reader == 'mineru': return res.get('blocuri_cu_text') == 0
    return False


def marcheaza(reader, raw, res, image_bytes):
    """Pe loc, pe rezultatul unei citiri: iesire goala curata (oricare imagine) -> `gol_de_verificat: true` + masurile pe pixeli
    (informatie). `ok` ramane False: asamblarea, clientul Ofertare si E3 nu o pot lua drept citire valida. Restul: neatinse.
    Intoarce True daca a marcat."""
    if res.get('ok') is True or not iesire_goala(reader, raw, res): return False
    res['gol_de_verificat'] = True; res['banda_alba'] = masoara(image_bytes)
    return True


def e_gol(raw, res):
    """Banda `gol_de_verificat` consistenta: marcajul, ok = False si text efectiv vid. Marcaj cu text nevid sau cu ok = True =
    rezultat neconsistent (compara il trimite la om ca banda_intreaga)."""
    return (isinstance(res, dict) and res.get('gol_de_verificat') is True and res.get('ok') is False
            and isinstance(raw, str) and not raw.strip())


def probabil_alba(*rezultate):
    """Informatia pe pixeli din rezultatele cititorilor (aceeasi imagine): True / False, sau None daca nu s-a masurat."""
    for res in rezultate:
        m = (res or {}).get('banda_alba')
        if isinstance(m, dict) and isinstance(m.get('alba'), bool): return m['alba']
    return None
