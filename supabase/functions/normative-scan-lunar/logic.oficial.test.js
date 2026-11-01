// v11 — verificarea pe sursa oficiala (legislatie.just.ro). Fixture-ul reproduce structura reala a paginii
// DetaliiDocument/179009 (HG 395/2016), citita pe 01.11.2026. r2: cazurile adverse din review-ul Copilot + Jakarinos r1.
import { describe, it, expect } from 'vitest';
import {
  consolidari, paginaPotrivita, verdictOficial, imparteLot, faraRand, construiesteMail, URL_LEGISLATIE,
  dataISO, plafoneazaAI, ordineRulare, ordinePrioritate,
} from './logic.js';

const pagina = ({ titlu = 'HG        395 02/06/2016 - Portal Legislativ', emitent = 'GUVERNUL', bloc } = {}) =>
  `<html><head><title>${titlu}</title></head><body>
<div id="label_forme_actz">+ istoric consolidări</div>
<div id="istoric_fa" class="nav_content expanded" style="display: none; margin-left: -8px;">${bloc ?? `
&nbsp;<a title='Consolidarea din 25.02.2026' style='color:red;text-decoration:none;cursor:default'>25.02.2026</a><br/>
&nbsp;<a title='Consolidarea din 24.05.2024' style='color:#428BCA' href='~/../../../Public/DetaliiDocument/282822'>24.05.2024</a><br/>
&nbsp;<a title='Consolidarea din 19.04.2023' style='color:#428BCA' href='~/../../../Public/DetaliiDocument/266861'>19.04.2023</a><br/>
&nbsp;<a title='Consolidarea din 09.06.2016' style='color:#428BCA' href='~/../../../Public/DetaliiDocument/179160'>09.06.2016</a><br/>`}
</div>
<table><tr><td><span class="S_EMT_TTL">EMITENT</span></td><td><span class="S_EMT_BDY"><li>${emitent}</li></span></td></tr></table>
</body></html>`;
const HTML = pagina();

const rand = (o = {}) => ({ id: 9, identificator: 'HG 395/2016', tip: 'hg', numar: '395/2016', legislatie_doc_id: 179009, forma_oficiala_la: null, ...o });

describe('dataISO()', () => {
  it('valideaza calendaristic', () => {
    expect(dataISO('25', '02', '2026')).toBe('2026-02-25');
    expect(dataISO('29', '02', '2024')).toBe('2024-02-29');
    expect(dataISO('29', '02', '2026')).toBeNull();
    expect(dataISO('31', '02', '2026')).toBeNull();
    expect(dataISO('00', '13', '2026')).toBeNull();
    expect(dataISO('01', '01', '1800')).toBeNull();
  });
});

describe('consolidari()', () => {
  it('extrage datele ISO din blocul istoric_fa, descrescator, prima = forma curenta', () => {
    expect(consolidari(HTML)).toEqual(['2026-02-25', '2024-05-24', '2023-04-19', '2016-06-09']);
  });
  it('bloc lipsa → null (NU [] — absenta nu e dovada ca actul n-are consolidari)', () => {
    expect(consolidari('<title>HG 395 02/06/2016 - Portal Legislativ</title>')).toBeNull();
    expect(consolidari(null)).toBeNull();
  });
  it('bloc gol → null', () => {
    expect(consolidari(pagina({ bloc: '  &nbsp; ' }))).toBeNull();
  });
  it('un link din bloc nerecunoscut sau cu data imposibila → null (istoric incomplet)', () => {
    expect(consolidari(pagina({ bloc: `<a title='Consolidarea din 25.02.2026'>x</a><a title='Alt text'>y</a>` }))).toBeNull();
    expect(consolidari(pagina({ bloc: `<a title='Consolidarea din 31.02.2026'>x</a>` }))).toBeNull();
  });
  it('consolidarile din afara blocului sau din comentarii HTML nu conteaza', () => {
    const h = HTML.replace('<html>', `<html><!-- <div id="istoric_fa"><a title='Consolidarea din 01.10.2030'></a></div> --><a title='Consolidarea din 01.10.2029'></a>`);
    expect(consolidari(h)).toEqual(['2026-02-25', '2024-05-24', '2023-04-19', '2016-06-09']);
  });
  it('r3: div imbricat in istoric → null (nu se citeste partial)', () => {
    const h = `<div id="istoric_fa"><div><a title="Consolidarea din 24.05.2024">x</a></div><a title="Consolidarea din 25.02.2026">y</a></div>`;
    expect(consolidari(h)).toBeNull();
  });
  it('r3: doar id-ul EXACT conteaza (nu istoric_fa_backup / data-id); doua blocuri → null', () => {
    expect(consolidari(`<div id="istoric_fa_backup"><a title="Consolidarea din 24.05.2024">x</a></div>`)).toBeNull();
    expect(consolidari(`<div data-id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a></div>`)).toBeNull();
    const doua = `<div id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a></div><div id='istoric_fa'><a title="Consolidarea din 25.02.2026">y</a></div>`;
    expect(consolidari(doua)).toBeNull();
  });
  it('r3: data-title nu tine loc de title', () => {
    expect(consolidari(`<div id="istoric_fa"><a data-title="Consolidarea din 24.05.2024" title="Alta forma">x</a></div>`)).toBeNull();
    expect(consolidari(`<div id="istoric_fa"><a data-title="x" title="Consolidarea din 24.05.2024">x</a></div>`)).toEqual(['2024-05-24']);
  });
  it('r4: id/title scrise IN valoarea altui atribut nu conteaza', () => {
    expect(consolidari(`<div data-note=' id="istoric_fa"'><a title="Consolidarea din 24.05.2024">x</a></div>`)).toBeNull();
    expect(consolidari(`<div id="istoric_fa"><a data-note=' title="Consolidarea din 24.05.2024"' title="Alta forma">x</a></div>`)).toBeNull();
  });
  it('r4: </div> dintr-o valoare de atribut nu inchide blocul; </DIV> majuscul il inchide; </diversion> nu', () => {
    const h = `<div id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a><span data-note="</div>"></span><a title="Consolidarea din 25.02.2026">y</a></div>`;
    expect(consolidari(h)).toEqual(['2026-02-25', '2024-05-24']);
    expect(consolidari(`<div id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a></DIV><a title="Consolidarea din 25.02.2026">y</a>`)).toEqual(['2024-05-24']);
    expect(consolidari(`<div id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a></diversion><a title="Consolidarea din 25.02.2026">y</a></div>`)).toEqual(['2026-02-25', '2024-05-24']);
  });
  it('r4: pagina trunchiata (fara </div> sau tag neinchis) → null', () => {
    expect(consolidari(`<div id="istoric_fa"><a title="Consolidarea din 24.05.2024">x</a>`)).toBeNull();
    expect(consolidari(`<div id="istoric_fa"><a title="Consolidarea din 24.05.2024"`)).toBeNull();
  });
  it('r4: id-ul in <script> sau comentariu nu conteaza; atribut dublat = ambiguu', () => {
    const scr = `<script>if (a<b) document.getElementById('istoric_fa'); var s = '<div id="istoric_fa">';</script>` + HTML.slice(HTML.indexOf('<div id="istoric_fa"'));
    expect(consolidari(scr)).toEqual(['2026-02-25', '2024-05-24', '2023-04-19', '2016-06-09']);
    expect(consolidari(`<div id="istoric_fa"><a title="Consolidarea din 24.05.2024" title="Consolidarea din 25.02.2026">x</a></div>`)).toBeNull();
  });
  it('republicarea face parte din istoric (Legea 307/2006: „Republicarea din 17.04.2019”)', () => {
    const bloc = `<a title='Consolidarea din 08.05.2026'>x</a><a title='Republicarea din 17.04.2019' href='~/x?isFormaDeBaza=True'>y</a><a title='Consolidarea din 18.09.2006'>z</a>`;
    expect(consolidari(pagina({ bloc }))).toEqual(['2026-05-08', '2019-04-17', '2006-09-18']);
  });
  it('accepta spatii in jurul lui = si ghilimele duble', () => {
    expect(consolidari(pagina({ bloc: `<a title = "Consolidarea din 01.02.2025">x</a><a title="Consolidarea din 01.02.2025">x</a>` }))).toEqual(['2025-02-01']);
  });
});

describe('paginaPotrivita()', () => {
  it('tip + numar + an din titlu + emitent din fisa', () => {
    expect(paginaPotrivita(HTML, rand())).toBe(true);
  });
  it('acelasi numar si an, alt TIP de act → false (HG vs ORDIN / LEGE)', () => {
    expect(paginaPotrivita(pagina({ titlu: 'ORDIN        395 02/06/2016 - Portal Legislativ' }), rand())).toBe(false);
    expect(paginaPotrivita(pagina({ titlu: 'LEGE        395 02/06/2016 - Portal Legislativ' }), rand())).toBe(false);
  });
  it('numar sau an diferit → false; numarul nu se potriveste in zi/luna', () => {
    expect(paginaPotrivita(HTML, rand({ numar: '394/2016' }))).toBe(false);
    expect(paginaPotrivita(HTML, rand({ numar: '395/2017' }))).toBe(false);
    expect(paginaPotrivita(pagina({ titlu: 'HG        999 02/06/2016 - Portal Legislativ' }), rand({ numar: '2/2016' }))).toBe(false);
    expect(paginaPotrivita(pagina({ titlu: 'HG        1395 02/06/2016 - Portal Legislativ' }), rand())).toBe(false);
  });
  it('emitent gresit → false (ex. ordin ANRE vs ordin de ministru cu acelasi numar)', () => {
    const anre = rand({ tip: 'ordin_anre', numar: '395/2016' });
    const titluOrdin = 'ORDIN        395 02/06/2016 - Portal Legislativ';
    expect(paginaPotrivita(pagina({ titlu: titluOrdin, emitent: 'AUTORITATEA NAŢIONALĂ DE REGLEMENTARE ÎN DOMENIUL ENERGIEI' }), anre)).toBe(true);
    expect(paginaPotrivita(pagina({ titlu: titluOrdin, emitent: 'MINISTERUL DEZVOLTĂRII' }), anre)).toBe(false);
  });
  it('r3: ordin de ministru nu e pe calea oficiala (emitentul nu se poate dovedi exact) → false', () => {
    const titluOrdin = 'ORDIN        395 02/06/2016 - Portal Legislativ';
    expect(paginaPotrivita(pagina({ titlu: titluOrdin, emitent: 'MINISTERUL TRANSPORTURILOR' }), rand({ tip: 'ordin' }))).toBe(false);
    expect(paginaPotrivita(pagina({ titlu: titluOrdin, emitent: 'MINISTERUL SĂNĂTĂȚII' }), rand({ tip: 'ordin' }))).toBe(false);
  });
  it('OUG: ambele forme de titlu ale portalului', () => {
    const oug = rand({ tip: 'oug', numar: '92/2021' });
    expect(paginaPotrivita(pagina({ titlu: 'ORD DE URGENTA 92 19/08/2021 - Portal Legislativ' }), oug)).toBe(true);
    expect(paginaPotrivita(pagina({ titlu: 'OUG 92 19/08/2021 - Portal Legislativ' }), oug)).toBe(true);
  });
  it('tip necunoscut (standard), numar nestandard sau pagina fara titlu → false', () => {
    expect(paginaPotrivita(HTML, rand({ tip: 'standard' }))).toBe(false);
    expect(paginaPotrivita(HTML, rand({ numar: '12007-1…-5' }))).toBe(false);
    expect(paginaPotrivita('<html>eroare</html>', rand())).toBe(false);
  });
});

describe('verdictOficial()', () => {
  const date = consolidari(HTML);
  it('baza egala cu forma curenta → neschimbat, confirmat automat, cu ce s-a vazut', () => {
    const v = verdictOficial(rand({ forma_oficiala_la: '2026-02-25' }), date, '2026-10-01', '2026-11-01T06:00:00.000Z');
    expect(v.verdict).toBe('neschimbat');
    expect(v.sursa).toBe('oficial');
    expect(v.detalii).toContain('confirmat automat');
    expect(v.detalii).toContain(URL_LEGISLATIE(179009));
    expect([v.doc, v.baza, v.vazut_la]).toEqual([179009, '2026-02-25', '2026-11-01T06:00:00.000Z']);
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
  it('baza lipsa → necunoscut, indiferent de istoric (nu exista „neschimbat” fara baza)', () => {
    expect(verdictOficial(rand(), date, null).verdict).toBe('necunoscut');
    expect(verdictOficial(rand(), date, null).detalii).toContain('bază nesetată');
    expect(verdictOficial(rand(), [], null).verdict).toBe('necunoscut');
  });
  it('istoric gol/null cu baza setata → necunoscut, NU neschimbat (P1-01)', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '2024-05-24' }), [], '2026-10-01').verdict).toBe('necunoscut');
    expect(verdictOficial(rand({ forma_oficiala_la: '2024-05-24' }), null, '2026-10-01').verdict).toBe('necunoscut');
  });
  it('baza mai noua decat forma curenta → necunoscut (baza gresita)', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '2026-09-01' }), date, null).verdict).toBe('necunoscut');
  });
  it('baza in format invalid sau imposibila → tratata ca lipsa', () => {
    expect(verdictOficial(rand({ forma_oficiala_la: '25.02.2026' }), date, null).verdict).toBe('necunoscut');
    expect(verdictOficial(rand({ forma_oficiala_la: '2026-02-31' }), date, null).verdict).toBe('necunoscut');
  });
});

describe('plafoneazaAI() — AI nu confirma ce sursa oficiala n-a confirmat (Jakarinos P1-3)', () => {
  it('„neschimbat” din AI pe un act cu id oficial → necunoscut; semnalele si actele fara id raman', () => {
    const out = plafoneazaAI([
      { id: 9, verdict: 'neschimbat', detalii: 'AI ok' },
      { id: 7, verdict: 'schimbare_noua', detalii: 'OUG' },
      { id: 33, verdict: 'neschimbat', detalii: 'standard' },
    ], [9, 7]);
    expect(out.map((v) => v.verdict)).toEqual(['necunoscut', 'schimbare_noua', 'neschimbat']);
    expect(out[0].detalii).toContain('sursa oficială indisponibilă');
  });
});

describe('ordinePrioritate() — r4', () => {
  it('CRITIC inaintea ACTUALIZARE (nu alfabetic); 40 ACTUALIZARE + 1 CRITIC → CRITIC intra in primele 40', () => {
    const l = [...Array(40)].map((_, k) => ({ id: k + 1, prioritate: 'ACTUALIZARE' })).concat([{ id: 99, prioritate: 'CRITIC' }]);
    const sel = ordinePrioritate(l).slice(0, 40);
    expect(sel[0].id).toBe(99);
    expect(sel.map((n) => n.id)).toContain(99);
  });
});

describe('paginaPotrivita() — r4 titlu/emitent ambigue', () => {
  it('doua <title> sau doua span S_EMT_BDY → false', () => {
    expect(paginaPotrivita(HTML.replace('</head>', '<title>LEGE 1 01/01/2020 - Portal Legislativ</title></head>'), rand())).toBe(false);
    expect(paginaPotrivita(HTML.replace('</table>', '<span class="S_EMT_BDY">GUVERNUL</span></table>'), rand())).toBe(false);
  });
  it('clasa S_EMT_BDY scrisa in valoarea altui atribut nu conteaza', () => {
    const h = HTML.replace(`<span class="S_EMT_BDY"><li>GUVERNUL</li></span>`, `<span data-x='class="S_EMT_BDY"'>GUVERNUL</span>`);
    expect(paginaPotrivita(h, rand())).toBe(false);
  });
});

describe('imparteLot() + ordineRulare() + faraRand()', () => {
  it('actele cu id oficial pozitiv merg pe calea oficiala, restul la AI', () => {
    const { oficial, ai } = imparteLot([rand(), rand({ id: 33, legislatie_doc_id: null }), rand({ id: 34, legislatie_doc_id: 0 })]);
    expect(oficial.map((n) => n.id)).toEqual([9]);
    expect(ai.map((n) => n.id)).toEqual([33, 34]);
  });
  it('ordineRulare pune actele cu id oficial primele, pastrand ordinea in fiecare grup', () => {
    const l = [rand({ id: 1, legislatie_doc_id: null }), rand({ id: 2 }), rand({ id: 3, legislatie_doc_id: null }), rand({ id: 4 })];
    expect(ordineRulare(l).map((n) => n.id)).toEqual([2, 4, 1, 3]);
  });
  it('faraRand pastreaza sursa, consolidarea si ce s-a vazut, nu randul', () => {
    const [v] = faraRand([verdictOficial(rand({ forma_oficiala_la: '2026-02-25' }), consolidari(HTML), null, 'T')]);
    expect(v.sursa).toBe('oficial');
    expect(v.curent).toBe('2026-02-25');
    expect(v.nr_consolidari).toBe(4);
    expect([v.doc, v.baza, v.vazut_la]).toEqual([179009, '2026-02-25', 'T']);
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
