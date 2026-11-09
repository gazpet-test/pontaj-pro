// Teste pentru logica nodului de cuplare (src/nodCuplareLogica.js). Valorile așteptate sunt numărate de mână pe cazurile de mai jos
// (L25), nu recalculate cu codul testat. Tranzițiile au și test de paritate cu lista din migrarea SQL (L19).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  STARI, CULORI, culoareStare, CULOARE_NECUNOSCUTA, TRANZITII, tranzitiePermisa, stariUrmatoare, valideazaMarcare, scadeZile,
  contor, filtreaza, incadreaza, limiteScala, zoomLa, ecranDinPct, pctDinEcran, parseManifest, parseCsv, obiecteCsv,
  mapeazaLista, mapeazaPuncte, dnDinText, certitudineDinText, puncteVedere, grupeazaPuncte, stariGrup, fundalGrup,
  esteFurnizor, faraPunctPeVedere, celMaiAproape, RAZA_ATINGERE, cheieImagine, aplicaRand, decideReincercare, payloadStare,
} from './nodCuplareLogica.js'

const AZI = '2026-11-09'

describe('contor azi / cumulat / rest pe DN', () => {
  const suduri = [
    { id: 1, dn: 600, stare: 'sudat', data_sudare: '2026-11-09' },
    { id: 2, dn: 600, stare: 'acceptat', data_sudare: '2026-11-05' },
    { id: 3, dn: 600, stare: 'de_executat', data_sudare: null },
    { id: 4, dn: 600, stare: 'anulat', data_sudare: null },
    { id: 5, dn: 300, stare: 'insailat', data_sudare: null },
    { id: 6, dn: 300, stare: 'reparat', data_sudare: '2026-11-09' },
    { id: 7, dn: 300, stare: 'ndt', data_sudare: '2026-11-08' },
    { id: 8, dn: null, stare: 'de_executat', data_sudare: null },
    { id: 9, dn: 100, stare: 'ciudat', data_sudare: null },
  ]
  it('totalurile (anulatele nu intră, starea necunoscută nu e nici cumulat, nici rest)', () => {
    const c = contor(suduri, AZI)
    expect([c.total, c.cumulat, c.rest, c.azi, c.insailate, c.necunoscute]).toEqual([8, 4, 3, 2, 1, 1])
  })
  it('pe diametre, descrescător, fără DN la final', () => {
    const c = contor(suduri, AZI)
    expect(c.peDn.map(d => [d.eticheta, d.total, d.cumulat, d.rest, d.azi, d.insailate, d.necunoscute])).toEqual([
      ['DN600', 3, 2, 1, 1, 0, 0],
      ['DN300', 3, 2, 1, 1, 1, 0],
      ['DN100', 1, 0, 0, 0, 0, 1],
      ['DN ?', 1, 0, 1, 0, 0, 0],
    ])
  })
  it('azi = doar data_sudare de azi (ieri nu, fără dată nu)', () => {
    expect(contor([{ dn: 200, stare: 'sudat', data_sudare: '2026-11-08' }], AZI).azi).toBe(0)
    expect(contor([], AZI)).toMatchObject({ total: 0, cumulat: 0, rest: 0, azi: 0, peDn: [] })
  })
  it('filtrul pe stare și DN', () => {
    expect(filtreaza(suduri, { stari: ['sudat', 'ndt'] }).map(s => s.id)).toEqual([1, 7])
    expect(filtreaza(suduri, { dn: '300' }).map(s => s.id)).toEqual([5, 6, 7])
    expect(filtreaza(suduri, { stari: ['sudat'], dn: 300 }).map(s => s.id)).toEqual([])
    expect(filtreaza(suduri, {}).length).toBe(9)
  })
})

// culoarea după stare: familia de culoare verificată pe nuanță (HSL), independent de valorile hex din cod
function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  const l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}
describe('culoarea punctului după stare', () => {
  it('gri / galben / albastru / verde / roșu, cum a cerut Răzvan', () => {
    expect(hsl(culoareStare('de_executat')).s).toBeLessThan(0.15)
    const h = s => hsl(culoareStare(s)).h
    expect(h('insailat')).toBeGreaterThan(35); expect(h('insailat')).toBeLessThan(60)
    expect(h('sudat')).toBeGreaterThan(195); expect(h('sudat')).toBeLessThan(230)
    expect(h('acceptat')).toBeGreaterThan(100); expect(h('acceptat')).toBeLessThan(150)
    expect(h('reparat') < 12 || h('reparat') > 348).toBe(true)
  })
  it('ndt fără rezultat are o culoare distinctă de celelalte (> 30° nuanță față de fiecare culoare saturată)', () => {
    const n = hsl(culoareStare('ndt')).h
    for (const s of ['insailat', 'sudat', 'acceptat', 'reparat']) {
      const d = Math.abs(n - hsl(culoareStare(s)).h)
      expect(Math.min(d, 360 - d)).toBeGreaterThan(30)
    }
  })
  it('fiecare stare are culoarea ei; o stare necunoscută NU e gri (nu se confundă cu „de executat”)', () => {
    expect(new Set(STARI.map(culoareStare)).size).toBe(STARI.length)
    expect(Object.keys(CULORI).sort()).toEqual([...STARI].sort())
    expect(culoareStare('xyz')).toBe(CULOARE_NECUNOSCUTA)
    expect(culoareStare(undefined)).not.toBe(culoareStare('de_executat'))
  })
})

describe('tranziții', () => {
  // decizia (09.11.2026): de executat -> însăilat -> sudat -> NDT -> acceptat / de reparat; de reparat -> sudat (reparația); anulat din cele nesudate
  const PERMISE = [
    'de_executat>insailat', 'de_executat>sudat', 'de_executat>anulat', 'insailat>sudat', 'insailat>anulat',
    'sudat>ndt', 'sudat>reparat', 'ndt>acceptat', 'ndt>reparat', 'reparat>sudat',
  ]
  it('toate cele 49 de perechi: exact cele 10 permise', () => {
    for (const v of STARI) for (const n of STARI) expect(tranzitiePermisa(v, n), `${v}>${n}`).toBe(PERMISE.includes(`${v}>${n}`))
  })
  it('negative: acceptat și anulat sunt finale; NDT nu se sare; stare necunoscută refuzată', () => {
    expect(stariUrmatoare('acceptat')).toEqual([])
    expect(stariUrmatoare('anulat')).toEqual([])
    expect(tranzitiePermisa('sudat', 'acceptat')).toBe(false)
    expect(tranzitiePermisa('de_executat', 'ndt')).toBe(false)
    expect(tranzitiePermisa('xyz', 'sudat')).toBe(false)
  })
  it('paritate: lista din migrarea SQL (fn_executie_nod_tranzitie) = lista din JS', () => {
    const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261201a_executie_noduri_suduri.sql', import.meta.url)), 'utf8')
    const bloc = sql.slice(sql.indexOf('-- TRANZITII-START'), sql.indexOf('-- TRANZITII-END'))
    expect(bloc.length).toBeGreaterThan(20)
    const dinSql = [...bloc.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map(m => `${m[1]}>${m[2]}`).sort()
    expect(dinSql).toEqual(TRANZITII.map(([v, n]) => `${v}>${n}`).sort())
    expect(dinSql).toEqual([...PERMISE].sort())
  })
  it('lista albă a stărilor din CHECK-ul SQL = STARI', () => {
    const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261201a_executie_noduri_suduri.sql', import.meta.url)), 'utf8')
    const m = sql.match(/stare text NOT NULL DEFAULT 'de_executat' CHECK \(stare IN \(([^)]*)\)\)/)
    expect(m).not.toBeNull()
    expect(m[1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual(STARI)
  })
})

describe('validarea fișei înainte de RPC', () => {
  const baza = { stareVeche: 'de_executat', stareNoua: 'sudat', data: AZI, azi: AZI, dataStare: null, sudor: 'P-12', buletin: '', motiv: '' }
  it('cazul bun trece', () => expect(valideazaMarcare(baza)).toEqual([]))
  it('fiecare regulă are test negativ', () => {
    expect(valideazaMarcare({ ...baza, stareNoua: 'acceptat' }).join()).toMatch(/nepermisă/)
    expect(valideazaMarcare({ ...baza, sudor: '  ' }).join()).toMatch(/sudorul/)
    expect(valideazaMarcare({ ...baza, stareVeche: 'sudat', stareNoua: 'ndt', buletin: '' }).join()).toMatch(/buletinului/)
    expect(valideazaMarcare({ ...baza, stareVeche: 'ndt', stareNoua: 'reparat', motiv: '' }).join()).toMatch(/motivul/)
    expect(valideazaMarcare({ ...baza, data: '2026-11-10' }).join()).toMatch(/viitor/)
    expect(valideazaMarcare({ ...baza, data: '2026-11-01' }).join()).toMatch(/7 zile/)
    expect(valideazaMarcare({ ...baza, data: '2026-11-02' })).toEqual([])
    expect(valideazaMarcare({ ...baza, data: '2026-11-05', dataStare: '2026-11-06' }).join()).toMatch(/înaintea/)
    expect(valideazaMarcare({ ...baza, data: '' }).join()).toMatch(/Data lipsește/)
  })
  it('scăderea zilelor peste lună și peste schimbarea orei (25.10.2026)', () => {
    expect(scadeZile('2026-11-02', 7)).toBe('2026-10-26')
    expect(scadeZile('2026-10-27', 3)).toBe('2026-10-24')
    expect(scadeZile('2026-03-01', 1)).toBe('2026-02-28')
  })
})

describe('geometria zoom / pan', () => {
  const img = { w: 1000, h: 500 }
  it('încadrarea: imaginea întreagă, centrată, cu margine 4%', () => {
    expect(incadreaza(img, { cw: 500, ch: 500 })).toEqual({ scale: 0.48, tx: 10, ty: 130 })
    expect(incadreaza(img, { cw: 0, ch: 500 })).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
  it('centrul imaginii (50%, 50%) cade în centrul containerului', () => {
    const v = incadreaza(img, { cw: 500, ch: 500 })
    expect(ecranDinPct(50, 50, img, v)).toEqual({ x: 250, y: 250 })
    expect(ecranDinPct(0, 0, img, v)).toEqual({ x: 10, y: 130 })
  })
  it('zoom ×2 în jurul degetelor: punctul de sub degete rămâne pe loc, restul se depărtează de 2×', () => {
    const v = { scale: 0.48, tx: 10, ty: 130 }
    const lim = { min: 0.1, max: 10 }
    const z = zoomLa(v, 2, 100, 200, lim)
    expect(z.scale).toBeCloseTo(0.96)
    const sub = pctDinEcran(100, 200, img, v)
    const dupa = ecranDinPct(sub.xPct, sub.yPct, img, z)
    expect(dupa.x).toBeCloseTo(100); expect(dupa.y).toBeCloseTo(200)
    const a = ecranDinPct(10, 10, img, v), b = ecranDinPct(10, 10, img, z)
    expect(b.x - 100).toBeCloseTo(2 * (a.x - 100)); expect(b.y - 200).toBeCloseTo(2 * (a.y - 200))
  })
  it('zoom-ul e limitat (nu trece de min / max)', () => {
    const lim = limiteScala({ scale: 0.5 })
    expect(lim).toEqual({ min: 0.25, max: 8 })
    expect(zoomLa({ scale: 0.5, tx: 0, ty: 0 }, 1000, 0, 0, lim).scale).toBe(8)
    expect(zoomLa({ scale: 0.5, tx: 0, ty: 0 }, 0.001, 0, 0, lim).scale).toBe(0.25)
    expect(limiteScala({ scale: 0.05 }).max).toBe(3)
  })
  it('pctDinEcran e inversul lui ecranDinPct', () => {
    const v = { scale: 1.7, tx: -320, ty: 45 }
    const p = ecranDinPct(37.5, 81.25, img, v)
    const q = pctDinEcran(p.x, p.y, img, v)
    expect(q.xPct).toBeCloseTo(37.5); expect(q.yPct).toBeCloseTo(81.25)
  })
})

describe('manifestul vederilor', () => {
  it('lista sau {vederi}; intrările invalide sunt raportate, nu pierdute', () => {
    const m = parseManifest([
      { vedere: 'PLAN', fisier: 'PLAN.png', latime_px: 1200, inaltime_px: 800, titlu: 'Plan' },
      { vedere: 'A', fisier: '../x.png', latime_px: 10, inaltime_px: 10 },
      { vedere: 'b', fisier: 'B.png', latime_px: 10, inaltime_px: 10 },
      { vedere: 'C', fisier: 'C.png', latime_px: 0, inaltime_px: 10 },
      { vedere: 'PLAN', fisier: 'P2.png', latime_px: 5, inaltime_px: 5 },
    ])
    expect(m.vederi).toEqual([{ vedere: 'PLAN', fisier: 'PLAN.png', w: 1200, h: 800, titlu: 'Plan' }])
    expect(m.erori.length).toBe(4)
    expect(m.erori.join(' ')).toMatch(/fișier invalid.*cod de vedere invalid.*dimensiuni invalide.*duplicată/)
    expect(parseManifest({ vederi: [{ vedere: 'D', fisier: 'D.webp', latime_px: 3, inaltime_px: 4 }] }).vederi[0].titlu).toBe('D')
    expect(parseManifest({ x: 1 }).erori).toEqual(['Manifestul nu e o listă de vederi'])
  })
})

describe('CSV și maparea listei / punctelor', () => {
  const BOM = String.fromCharCode(0xFEFF)
  it('CSV: BOM, CRLF, ghilimele cu ; și "" și rând nou în câmp; rândurile goale sar', () => {
    expect(parseCsv(BOM + 'a;b\r\n"x;1";"zi ""bună""\nnou"\r\n\r\n3;4')).toEqual([['a', 'b'], ['x;1', 'zi "bună"\nnou'], ['3', '4']])
    expect(() => parseCsv('a;"b')).toThrow(/neînchise/)
  })
  it('obiecteCsv: antet normalizat; rândul cu alt număr de câmpuri = eroare', () => {
    const o = obiecteCsv('ID;Poziția 1\nCP-001;x\nCP-002')
    expect(o.antet).toEqual(['id', 'pozitia 1'])
    expect(o.obiecte).toEqual([{ _rand: 2, id: 'CP-001', 'pozitia 1': 'x' }])
    expect(o.erori).toEqual(['Rândul 3: 1 câmpuri, antetul are 2'])
  })
  it('DN și certitudine', () => {
    expect([dnDinText('DN600'), dnDinText(' 300 '), dnDinText(''), dnDinText('DN 1.5')]).toEqual([600, 300, null, NaN])
    expect(certitudineDinText('sigur (din tabel); de confirmat …')).toEqual({ valoare: 'sigur', recunoscut: true })
    expect(certitudineDinText('probabilă, de confirmat').valoare).toBe('posibil')
    expect(certitudineDinText('estimare din tabel').valoare).toBe('de_confirmat')
    expect(certitudineDinText('altceva')).toEqual({ valoare: 'de_confirmat', recunoscut: false })
  })
  it('lista: cod duplicat, cod invalid, DN invalid, câmp prea lung = erori (nu se taie)', () => {
    const o = obiecteCsv(['ID;Subansamblu;DN;Diametru×grosime capăt 1 (mm);Diametru×grosime capăt 2 (mm);Poziția 1;Poziția 2;Certitudine',
      'CP-001;A;DN100;114×6;114×6;1;2;sigur', 'CP-001;A;DN100;;;;;sigur', 'X1;A;DN100;;;;;sigur', 'CP-003;A;DN9;;;;;sigur',
      `CP-004;${'s'.repeat(301)};DN100;;;;;sigur`, 'CP-005;A;;;;;;nimic'].join('\n')).obiecte
    const r = mapeazaLista(o)
    expect(r.suduri.map(s => s.cod)).toEqual(['CP-001', 'CP-005'])
    expect(r.suduri[0]).toEqual({ cod: 'CP-001', subansamblu: 'A', dn: 100, diametru: '114×6 / 114×6', poz1: '1', poz2: '2', certitudine: 'sigur' })
    expect(r.erori).toEqual(['Rândul 3: cod duplicat CP-001', 'Rândul 4: cod invalid „X1”', 'Rândul 5: DN invalid', 'Rândul 6: subansamblu peste 300 caractere'])
    expect(r.avertismente).toEqual(['Rândul 7 (CP-005): fără DN', 'Rândul 7 (CP-005): certitudine nerecunoscută → de_confirmat'])
  })
  it('punctele: virgulă zecimală; primul rând = vederea principală, următoarele = alte vederi; aceeași vedere de două ori = ignorat; erori', () => {
    const o = obiecteCsv(['cod_sudura;vedere;x_pct;y_pct;certitudine_pozitie;observatii',
      'CP-001;PLAN;12,5;40;sigur;', 'CP-001;A;1;1;;', 'CP-001;PLAN;5;5;;', 'CP-009;PLAN;1;1;;', 'CP-002;Z;1;1;;', 'CP-002;PLAN;100,5;1;;',
      'CP-002;PLAN;abc;1;;', 'CP-002;A;0;100;fara_pozitie_pe_plansa;'].join('\n')).obiecte
    const r = mapeazaPuncte(o, { coduri: new Set(['CP-001', 'CP-002']), vederi: new Set(['PLAN', 'A']) })
    expect(r.puncte).toEqual([
      { cod: 'CP-001', vedere: 'PLAN', x: 12.5, y: 40, certitudine: 'sigur', secundare: [{ vedere: 'A', x_pct: 1, y_pct: 1 }] },
      { cod: 'CP-002', vedere: 'A', x: 0, y: 100, certitudine: 'fara_pozitie_pe_plansa', secundare: [] },
    ])
    expect(r.ignorate).toEqual(['Rândul 4: CP-001 are deja un punct pe vederea PLAN (păstrat primul)'])
    expect(r.erori).toEqual(['Rândul 5: sudură necunoscută „CP-009”', 'Rândul 6: vedere necunoscută „Z”', 'Rândul 7: x_pct invalid', 'Rândul 8: x_pct invalid'])
  })
})

describe('punctele unei vederi și grupurile', () => {
  const s1 = { id: 1, cod: 'CP-001', stare: 'sudat', vedere: 'PLAN', x_pct: '10.000', y_pct: '20.000', pozitii_secundare: [{ vedere: 'A', x_pct: 5, y_pct: 6 }] }
  const s2 = { id: 2, cod: 'CP-002', stare: 'de_executat', vedere: 'A', x_pct: 50, y_pct: 50, pozitii_secundare: [{ vedere: 'PLAN', x_pct: 42.65, y_pct: 26.97, certitudine: 'fara_pozitie_pe_plansa' }] }
  const s3 = { id: 3, cod: 'CP-003', stare: 'de_executat', vedere: 'PLAN', x_pct: 42.65, y_pct: 26.97, pozitii_secundare: [] }
  const s4 = { id: 4, cod: 'CP-004', stare: 'acceptat', vedere: 'PLAN', x_pct: 42.65, y_pct: 26.97, pozitii_secundare: [] }
  const s5 = { id: 5, cod: 'CP-005', stare: 'de_executat', vedere: null, x_pct: null, y_pct: null, pozitii_secundare: [] }
  it('vederea principală și cele secundare; fără punct = absentă', () => {
    expect(puncteVedere([s1, s2, s3, s5], 'PLAN').map(p => [p.sudura.id, p.x_pct, p.y_pct, p.principal])).toEqual([[1, 10, 20, true], [2, 42.65, 26.97, false], [3, 42.65, 26.97, true]])
    expect(puncteVedere([s1, s2, s5], 'A').map(p => [p.sudura.id, p.principal])).toEqual([[1, false], [2, true]])
    expect(puncteVedere([s5], 'PLAN')).toEqual([])
  })
  it('coordonatele identice = un singur grup, cu toate sudurile lui', () => {
    const g = grupeazaPuncte(puncteVedere([s1, s2, s3, s4], 'PLAN'))
    expect(g.map(x => [x.x_pct, x.y_pct, x.puncte.map(p => p.sudura.id)])).toEqual([[10, 20, [1]], [42.65, 26.97, [2, 3, 4]]])
  })
  it('culoarea grupului: o stare = culoarea ei; mai multe = cerc împărțit proporțional', () => {
    const [unu, trei] = grupeazaPuncte(puncteVedere([s1, s2, s3, s4], 'PLAN'))
    expect(fundalGrup(unu)).toBe(culoareStare('sudat'))
    expect(stariGrup(trei)).toEqual([{ stare: 'de_executat', n: 2 }, { stare: 'acceptat', n: 1 }])
    expect(fundalGrup(trei)).toBe(`conic-gradient(${culoareStare('de_executat')} 0deg 240deg, ${culoareStare('acceptat')} 240deg 360deg)`)
  })
  it('sudurile fără punct pe vedere (inclusiv fără niciun punct) se pot lista', () => {
    expect(faraPunctPeVedere([s1, s2, s3, s5], 'PLAN').map(s => s.id)).toEqual([5])
    expect(faraPunctPeVedere([s1, s2, s3, s5], 'A').map(s => s.id)).toEqual([3, 5])
    expect(faraPunctPeVedere([s1, s5], 'D').map(s => s.id)).toEqual([1, 5])
  })
})

describe('sudurile furnizorului rezervorului (se sar la import, raportate)', () => {
  const BLOC = 'Rezervoare – furnizorul rezervorului, la atelier (informativ)'
  it('regula ancorată: ambele coloane = furnizor; niciuna = a noastră; doar una = de lămurit (null)', () => {
    expect(esteFurnizor({ bloc: BLOC, certitudine: 'făcută de furnizor (rezervor livrat cu racorduri)' })).toBe(true)
    expect(esteFurnizor({ bloc: BLOC, certitudine: 'Făcută de furnizor' })).toBe(true)
    expect(esteFurnizor({ bloc: 'Rezervoare - furnizorul rezervorului', certitudine: 'facuta de furnizor' })).toBe(true)
    expect(esteFurnizor({ bloc: 'Rezervoare – noi, montaj pe șantier', certitudine: 'sigur' })).toBe(false)
    expect(esteFurnizor({ bloc: '', certitudine: '' })).toBe(false)
    expect(esteFurnizor({ bloc: BLOC, certitudine: 'sigur' })).toBeNull()
    expect(esteFurnizor({ bloc: 'Planșa principală', certitudine: 'făcută de furnizor' })).toBeNull()
  })
  it('negative: textul nu începe cu regula sau continuă alt cuvânt', () => {
    expect(esteFurnizor({ bloc: 'Planșa', certitudine: 'nu e făcută de furnizor' })).toBe(false)
    expect(esteFurnizor({ bloc: 'Planșa', certitudine: 'făcută de furnizorul X' })).toBe(false)
    expect(esteFurnizor({ bloc: 'Alte rezervoare – furnizorul rezervorului', certitudine: 'sigur' })).toBe(false)
  })
  it('lista: rândurile furnizorului se sar și se raportează; un rând pe jumătate = eroare; codul nu se poate repeta', () => {
    const o = obiecteCsv(['ID;Bloc;DN;Certitudine', `CR-001;${BLOC};DN50;făcută de furnizor`, 'CR-002;Rezervoare – noi;DN50;sigur',
      `CR-003;${BLOC};DN50;sigur`, 'CR-001;Rezervoare – noi;DN50;sigur'].join('\n')).obiecte
    const r = mapeazaLista(o)
    expect(r.furnizor).toEqual(['CR-001'])
    expect(r.suduri.map(s => s.cod)).toEqual(['CR-002'])
    expect(r.erori).toEqual(['Rândul 4 (CR-003): „furnizor” doar într-una din coloanele Bloc / Certitudine — de lămurit', 'Rândul 5: cod duplicat CR-001'])
  })
  it('punctele sudurilor furnizorului: ignorate și raportate (nu eroare, nu tăcere)', () => {
    const o = obiecteCsv(['cod_sudura;vedere;x_pct;y_pct;certitudine_pozitie;observatii', 'CR-001;PLAN;1;1;;', 'CR-002;PLAN;2;2;;'].join('\n')).obiecte
    const r = mapeazaPuncte(o, { coduri: new Set(['CR-002']), vederi: new Set(['PLAN']), coduriFurnizor: new Set(['CR-001']) })
    expect(r.puncte.map(p => p.cod)).toEqual(['CR-002'])
    expect(r.ignorate).toEqual(['Rândul 2: CR-001 e a furnizorului (sărită din listă), punct ignorat'])
    expect(r.erori).toEqual([])
  })
})

describe('atingerea, identitatea imaginii, salvarea (L24 / L05)', () => {
  it('ținta de atingere ~46 px; la suprapunere câștigă punctul cel mai apropiat', () => {
    expect(RAZA_ATINGERE * 2).toBeGreaterThanOrEqual(44)
    expect(RAZA_ATINGERE * 2).toBeLessThanOrEqual(48)
    const pe = [{ cheie: 'a', x: 100, y: 100 }, { cheie: 'b', x: 120, y: 100 }]
    expect(celMaiAproape(pe, 112, 101).cheie).toBe('b')
    expect(celMaiAproape(pe, 108, 99).cheie).toBe('a')
    expect(celMaiAproape(pe, 100, 122).cheie).toBe('a')        // 22 px: în țintă, deși în afara cercului de 15 px
    expect(celMaiAproape(pe, 100, 124)).toBeNull()             // 24 px: în afara țintei
    expect(celMaiAproape([], 0, 0)).toBeNull()
  })
  it('identitatea imaginii include proiect / nod / vedere / fișier', () => {
    expect(cheieImagine({ proiectId: 1, nod: 'NOD-A', vedere: 'PLAN', fisier: 'PLAN.png' })).toBe('1/NOD-A/PLAN/PLAN.png')
    expect(cheieImagine({ proiectId: 1, nod: 'NOD-A', vedere: 'PLAN', fisier: 'PLAN.png' })).not.toBe(cheieImagine({ proiectId: 1, nod: 'NOD-B', vedere: 'PLAN', fisier: 'PLAN.png' }))
    expect(cheieImagine({ proiectId: 1, nod: 'NOD-A', vedere: null, fisier: 'PLAN.png' })).toBeNull()
  })
  it('rândul întors de server nu înlocuiește o versiune locală mai nouă', () => {
    const lista = [{ id: 1, stare: 'ndt', versiune: 3 }, { id: 2, stare: 'sudat', versiune: 1 }]
    expect(aplicaRand(lista, { id: 1, stare: 'sudat', versiune: 2 })).toEqual(lista)
    expect(aplicaRand(lista, { id: 1, stare: 'acceptat', versiune: 4 })[0]).toEqual({ id: 1, stare: 'acceptat', versiune: 4 })
    expect(aplicaRand(lista, { id: 1, stare: 'ndt', versiune: 3 })[0].versiune).toBe(3)
    expect(aplicaRand(lista, { id: 9, stare: 'x', versiune: 1 })).toEqual(lista)
    expect(aplicaRand(lista, null)).toBe(lista)
  })
  it('reîncercarea după rezultat necunoscut: aceeași cerere = aceeași cheie; formular schimbat = întâi reconciliere', () => {
    const s = { id: 7, stare: 'de_executat', versiune: 2 }
    const p1 = payloadStare(s, { stareNoua: 'sudat', data: AZI, sudor: ' P-1 ', buletin: '', motiv: '' })
    expect(p1).toEqual({ p_id: 7, p_stare_veche: 'de_executat', p_versiune: 2, p_stare_noua: 'sudat', p_data: AZI, p_sudor: 'P-1', p_buletin_ndt: null, p_motiv: null })
    expect(Object.isFrozen(p1)).toBe(true)
    expect(decideReincercare(null, p1)).toBe('noua')
    const incert = { payload: p1, cheie: 'k1' }
    expect(decideReincercare(incert, payloadStare(s, { stareNoua: 'sudat', data: AZI, sudor: 'P-1' }))).toBe('aceeasi')
    expect(decideReincercare(incert, payloadStare(s, { stareNoua: 'sudat', data: AZI, sudor: 'P-2' }))).toBe('reconciliere')
    expect(decideReincercare(incert, payloadStare(s, { stareNoua: 'insailat', data: AZI, sudor: 'P-1' }))).toBe('reconciliere')
    expect(decideReincercare(incert, payloadStare({ ...s, id: 8 }, { stareNoua: 'sudat', data: AZI, sudor: 'P-1' }))).toBe('noua')
  })
})
