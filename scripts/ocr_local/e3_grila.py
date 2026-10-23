"""HTML neexecutabil → matrice de ocupare cu proveniența fiecărei celule."""
from html.parser import HTMLParser
from .e3_contract import E3Error


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.rows, self.row, self.cell = [], None, None, None
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'table':
            if self.rows is not None:
                raise E3Error('structura_incerta')
            self.rows = []
        elif tag == 'tr' and self.rows is not None:
            if self.row is not None:
                raise E3Error('structura_incerta')
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            if self.cell is not None:
                raise E3Error('structura_incerta')
            a = dict(attrs)
            try:
                rs, cs = int(a.get('rowspan', 1)), int(a.get('colspan', 1))
                if not 1 <= rs <= 2048 or not 1 <= cs <= 100:
                    raise ValueError()
            except (TypeError, ValueError):
                raise E3Error('structura_incerta')
            self.cell = {'text': '', 'rowspan': rs, 'colspan': cs}
        elif tag == 'br' and self.cell is not None:
            self.cell['text'] += ' '

    def handle_data(self, data):
        if not self.skip and self.cell is not None:
            self.cell['text'] += data

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if self.skip:
            return
        if tag in ('td', 'th') and self.cell is not None:
            self.cell['text'] = ' '.join(self.cell['text'].split())
            self.row.append(self.cell)
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.cell is not None:
                raise E3Error('structura_incerta')
            self.rows.append(self.row)
            self.row = None
        elif tag == 'table' and self.rows is not None:
            if self.row is not None:
                raise E3Error('structura_incerta')
            self.tables.append(self.rows)
            self.rows = None


def ocupa(rows):
    if len(rows) > 2048:
        raise E3Error('limita_randuri')
    matrix = [{} for _ in rows]
    for ri, row in enumerate(rows):
        col = 0
        for cell in row:
            while col in matrix[ri]:
                col += 1
            rs, cs = cell['rowspan'], cell['colspan']
            if ri + rs > len(rows) or col + cs > 100:
                raise E3Error('structura_incerta')
            for r in range(ri, ri + rs):
                for c in range(col, col + cs):
                    if c in matrix[r]:
                        raise E3Error('structura_incerta')
                    matrix[r][c] = {**cell, 'origine': (ri, col), 'e_origine': (ri, col) == (r, c)}
            col += cs
    width = max((len(r) for r in matrix), default=0)
    if not width or any(set(r) != set(range(width)) for r in matrix):
        raise E3Error('structura_incerta')
    return [[r[c] for c in range(width)] for r in matrix]


def grile(raw):
    parser = Tables()
    parser.feed(raw)
    parser.close()
    if parser.rows is not None or parser.cell is not None:
        raise E3Error('structura_incerta')
    return [ocupa(t) for t in parser.tables]


def e3_grila(raw):
    tables = grile(raw)
    if len(tables) != 1:
        raise E3Error('structura_incerta')
    return tables[0]
