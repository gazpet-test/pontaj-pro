// v11 — verificarea pe sursa oficiala (legislatie.just.ro). Fixture-ul e structura reala a paginii
// DetaliiDocument/179009 (HG 395/2016), citita pe 01.11.2026.
import { describe, it, expect } from 'vitest';
import { consolidari, paginaPotrivita, verdictOficial, imparteLot, faraRand, construiesteMail, URL_LEGISLATIE } from './logic.js';

const HTML = `<html><head><title>HG        395 02/06/2016 - Portal Legislativ</title></head><body>
<div id="istoric_fa" class="nav_content expanded" style="display: none;">
&nbsp;<a title='Consolidarea din 25.02.2026' style='color:red'>25.02.2026</a><br/>
&nbsp;<a title='Consolidarea din 24.05.2024' href='~/../../../Public/DetaliiDocument/282822'>24.05.2024</a><br/>
&nbsp;<a title='Consolidarea din 19.04.2023' href='~/../../../Public/DetaliiDocument/266861'>19.04.2023</a><br/>
&nbsp;<a title='Consolidarea din 09.06.2016' href='~/../../../Public/DetaliiDocument/179160'>09.06.2016</a><br/>
</div></body></html>`;

const rand = (o = {}) => ({ id: 9, identificator: 'HG 395/2016', tip: 'hg', numar: '395/2016', legislatie_doc_id: 179009, forma_oficiala_la: null, ...o });

describe('consolidari()', () => {
  it('extrage datele ISO, descrescator, prima = forma curenta', () => {
    expect(consolidari(HTML)).toEqual(['2026-02-25', '2024-05-24', '2023-04-19', '2016-06-09']);
  });
  it('pagina fara istoric → []', () => {
    expect(consolidari('<title>LEGE 1 01/01/2020</title>')).toEqual([]);
    expect(consolidari(null)).toEqual([]);
  });
  it('accepta si ghilimele duble, fara dubluri', () => {
    expect(consolidari(`title="Consolidarea din 01.02.2025" title='Consolidarea din 01.02.2025'`)).toEqual(['2025-02-01']);
  });
});

describe('paginaPotrivita()', () => {
  it('titlul poarta numarul si anul actului', () => {
    expect(paginaPotrivita(HTML, rand())).toBe(true);
  });
  it('alt act (numar diferit sau an diferit) → false', () => {
    expect(paginaPotrivita(HTML, rand({ numar: '394/2016' }))).toBe(false);
    expect(paginaPotrivita(HTML, rand({ numar: '395/2017' }))).toBe(false);
    expect(paginaPotrivita(HTML, rand({ numar: '39/2016' }))).toBe(false);
  });
  it('pagina de eroare fara titlu / numar nestandard → false', () => {
    expect(paginaPotrivita('<html>eroare</html>', rand())).toBe(false);
    expect(paginaPotrivita(HTML, rand({ numar: '12007-1…-5' }))).toBe(false);
  });
});

describe('verdictOficial()', () => {
  const date = consolidari(HTML);
  it('baza egala cu forma curenta → neschimbat, confirmat automat', () => {
    const v = verdictOficial(rand({ forma_oficiala_la: '2026-02-25' }), date, '2026-10-01');
    expect(v.verdict).toBe('neschimbat');
    expect(v.sursa).toBe('oficial');
    expect(v.detalii).toContain('confirmat automat');
    expect(v.detalii).toContain(URL_LEGISLATIE(179009));
  });
  it('consolidare noua dupa baza si dupa ultimul scan → schimbare_noua, cu toate datele noi', () => {
    const v = verdictOficial(rand({ forma_oficiala_la: '2023-04-19' }), date, '2025-12-01');
    expect(v.verdict).toBe('schimbare_noua');
    expect(v.tip).toBe('modificat');
    expect(v.data_act).toBe('2026-02-25');
    expect(v.detalii).toContain('2 consolidare(i)');
    expect(v.detalii).toContain('25.02.2026, 24.05.2024');
  });
  it('consolidare noua dar deja publicata la ultimul scan → forma_incompleta (gol vechi)', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '2024-05-24' }), date, '2026-06-01').verdict).toBe('forma_incompleta');
  });
  it('fara scan anterior, consolidare noua → schimbare_noua', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '2024-05-24' }), date, null).verdict).toBe('schimbare_noua');
  });
  it('baza lipsa: cu consolidari → necunoscut (de setat o data); fara consolidari → neschimbat', () => {
    expect(verdictOficial(rand(), date, null).verdict).toBe('necunoscut');
    expect(verdictOficial(rand(), date, null).detalii).toContain('bază nesetată');
    expect(verdictOficial(rand(), [], null).verdict).toBe('neschimbat');
  });
  it('baza mai noua decat forma curenta → necunoscut (baza gresita), nu „neschimbat”', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '2026-09-01' }), date, null).verdict).toBe('necunoscut');
  });
  it('baza in format invalid → tratata ca lipsa', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '25.02.2026' }), date, null).verdict).toBe('necunoscut');
  });
});

describe('imparteLot() + faraRand()', () => {
  it('actele cu id oficial pozitiv merg pe calea oficiala, restul la AI', () => {
    const { oficial, ai } = imparteLot([rand(), rand({ id: 33, legislatie_doc_id: null }), rand({ id: 34, legislatie_doc_id: 0 })]);
    expect(oficial.map((n) => n.id)).toEqual([9]);
    expect(ai.map((n) => n.id)).toEqual([33, 34]);
  });
  it('faraRand pastreaza sursa si consolidarea, nu randul', () => {
    const [v] = faraRand([verdictOficial(rand({ forma_oficiala_la: '2026-02-25' }), consolidari(HTML), null)]);
    expect(v.sursa).toBe('oficial');
    expect(v.curent).toBe('2026-02-25');
    expect(v.nr_consolidari).toBe(4);
    expect(v.rand).toBeUndefined();
    expect(faraRand([{ id: 1, verdict: 'neschimbat' }])[0].sursa).toBe('ai');
  });
});

describe('mail v11', () => {
  it('arata cate acte au fost citite direct si cate confirmate automat', () => {
    const m = construiesteMail({
      id: 3, test: false, azi: '2026-12-01', nr_loturi: 2, acte_ids: [1, 2, 3], cautari: 4, erori: [],
      verdicte: [
        { id: 1, identificator: 'A', verdict: 'neschimbat', sursa: 'oficial' },
        { id: 2, identificator: 'B', verdict: 'schimbare_noua', sursa: 'oficial', tip: 'modificat' },
        { id: 3, identificator: 'C', verdict: 'neschimbat', sursa: 'ai' },
      ],
    }, 1);
    expect(m.html).toContain('2 acte citite direct pe legislatie.just.ro (1 confirmate automat, fără AI)');
    expect(m.nSemn).toBe(1);
  });
});
