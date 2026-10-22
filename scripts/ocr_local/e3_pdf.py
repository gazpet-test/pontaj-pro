"""PyMuPDF în proces separat: parserul nu poate bloca serviciul peste 3 secunde."""
import multiprocessing
import pathlib
from .e3_contract import E3Error


def clasifica(data):
    if not data.startswith(b'%PDF') or len(data) > 8388608 or b'%%EOF' not in data[-2048:]:
        return 'invalid'
    try:
        import fitz
    except ImportError:
        return 'neverificabil'
    try:
        with fitz.open(stream=data, filetype='pdf') as pdf:
            if pdf.is_encrypted or pdf.needs_pass or pdf.xref_get_key(-1, 'Encrypt')[0] != 'null' or pdf.is_repaired or pdf.page_count < 1:
                return 'invalid'
            # Forțează citirea arborelui real, nu o căutare textuală /Type /Page.
            for page in pdf:
                if page.rect.is_empty or page.rect.is_infinite:
                    return 'invalid'
            return 'mono' if pdf.page_count == 1 else 'multi'
    except (ValueError, RuntimeError):
        return 'invalid'
    except Exception:
        return 'neverificabil'


def _validate(data, conn):
    try:
        conn.send(clasifica(data))
    finally:
        conn.close()


def valideaza_pdf(data, timeout=3):
    ctx = multiprocessing.get_context('spawn')
    parent, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_validate, args=(data, child), daemon=True)
    try:
        process.start()
        child.close()
        return parent.recv() if parent.poll(timeout) else 'neverificabil'
    except (OSError, EOFError):
        return 'neverificabil'
    finally:
        if process.pid:
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
        parent.close()
        child.close()


def randeaza(data):
    from PIL import Image
    import fitz
    with fitz.open(stream=data, filetype='pdf') as pdf:
        page = pdf[0]
        if page.rect.width * page.rect.height * (150 / 72) ** 2 > 25000000:
            raise E3Error('pdf_invalid')
        pix = page.get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72), alpha=False)
        return Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
