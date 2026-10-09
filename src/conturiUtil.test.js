import { describe, it, expect } from 'vitest'
import { CATEGORII, ORDINE_CATEGORII, urlSigur, pareParola, filtreaza, grupeaza, pregatesteRand, conturiPeLocatie, LIMITE } from './conturiUtil.js'

const R = [
  { id: 1, categorie: 'utilitati', serviciu: 'Furnizor Curent', utilizator: 'a@x.ro', titular: 'Titular Unu', cod_client: '9000000001', personal: true, activ: true, locatie_ids: [1] },
  { id: 2, categorie: 'utilitati', serviciu: 'Furnizor Curent', utilizator: 'a@x.ro', titular: 'Titular Doi Ștefan', cod_client: '9000000002', personal: true, activ: true, locatie_ids: [1, 3] },
  { id: 3, categorie: 'utilitati', serviciu: 'Furnizor Gaz', utilizator: 'a@x.ro', personal: true, activ: true },
  { id: 4, categorie: 'institutii', serviciu: 'portal-plati.test', utilizator: 'user.test', titular: 'Persoana Trei', personal: false, activ: true },
  { id: 5, categorie: 'firma', serviciu: 'licitatii.test', utilizator: 'office@x.ro', personal: false, activ: false },
  { id: 6, categorie: 'necunoscuta', serviciu: 'Ciudat', personal: false, activ: true },
]

describe('categorii', () => {
  it('ordinea acoperă exact categoriile din CHECK-ul BD', () => {
    expect(ORDINE_CATEGORII.slice().sort()).toEqual(Object.keys(CATEGORII).sort())
    expect(ORDINE_CATEGORII).toEqual(['utilitati', 'aplicatii', 'institutii', 'firma', 'retea', 'altele'])
  })
})

describe('urlSigur', () => {
  it('doar http(s) fără spații', () => {
    expect(urlSigur('https://www.exemplu.test/')).toBe(true)
    expect(urlSigur('HTTP://Exemplu.ro')).toBe(true)
    expect(urlSigur('javascript:alert(1)')).toBe(false)
    expect(urlSigur(' javascript:alert(1)')).toBe(false)
    expect(urlSigur('data:text/html,x')).toBe(false)
    expect(urlSigur('https://a b')).toBe(false)
    expect(urlSigur('www.exemplu.ro')).toBe(false)
    expect(urlSigur('https:////admin:abc123@example.com/')).toBe(false)
    expect(urlSigur('https://admin@router.local')).toBe(false)
    expect(urlSigur('https:///cale')).toBe(false)
    expect(urlSigur('https://x.ro\\@evil.ro/')).toBe(false)
    expect(urlSigur('https://x.ro/p?e=a@b.ro')).toBe(true)
    expect(urlSigur('https://x.ro:8443/a#b')).toBe(true)
    expect(urlSigur('https://:')).toBe(false)
    expect(urlSigur('https://x.ro:abc')).toBe(false)
    expect(urlSigur('https://.x.ro/')).toBe(false)
    expect(urlSigur('http://192.168.1.1:8080/x')).toBe(true)
    expect(urlSigur('https://exemplu-ț.ro/')).toBe(true)
    // r4 (J18-2/P17-2): port 1–65535, gazdă numerică doar IPv4 valid — la fel ca în BD
    expect(urlSigur('https://x.ro:65535/')).toBe(true)
    expect(urlSigur('https://x.ro:65536')).toBe(false)
    expect(urlSigur('https://x.ro:99999')).toBe(false)
    expect(urlSigur('https://x.ro:0')).toBe(false)
    expect(urlSigur('https://999.999.999.999')).toBe(false)
    expect(urlSigur('https://1.2.3')).toBe(false)
    expect(urlSigur('https://01.2.3.4')).toBe(false)
    expect(urlSigur('https://255.255.255.255:1/')).toBe(true)
    expect(urlSigur(null)).toBe(false)
    expect(urlSigur('https://' + 'a'.repeat(LIMITE.url))).toBe(false)
  })
})

describe('pareParola', () => {
  it('prinde „parola: …” în mai multe forme, nu și textul obișnuit', () => {
    expect(pareParola('parola: abc123')).toBe(true)
    expect(pareParola('Parolă = x')).toBe(true)
    expect(pareParola('password:x')).toBe(true)
    expect(pareParola('PIN: 1234')).toBe(true)
    expect(pareParola(null, 'obs', 'pwd=1')).toBe(true)
    expect(pareParola('parola contului: Abc123')).toBe(true)
    expect(pareParola('Parola noua=Abc')).toBe(true)
    expect(pareParola('PIN-ul: 1234')).toBe(true)
    expect(pareParola('psw: x')).toBe(true)
    expect(pareParola('parola：abc')).toBe(true)
    expect(pareParola('Parola\u0306: x'.replace('a\u0306', 'ă'))).toBe(true)
    expect(pareParola('https://x.ro/login?password=abc')).toBe(true)
    expect(pareParola('parolele stau în SecurePass')).toBe(false)
    expect(pareParola('opinie: bună')).toBe(false)
    expect(pareParola('Passport: 123')).toBe(false)
    expect(pareParola('locuri de consum: str. X; loc consum 700 = sediu')).toBe(false)
    // per câmp, nu concatenat (J17-2): fiecare câmp e verificat separat
    expect(pareParola('Proton Pass', 'Contact: IT')).toBe(false)
    expect(pareParola('utilizator@firma.test')).toBe(false)
    expect(pareParola('compass: nord')).toBe(false)
    expect(pareParola('login cu telefon')).toBe(false)
    expect(pareParola()).toBe(false)
  })
})

describe('filtreaza', () => {
  it('ascunde inactivele implicit; le arată la cerere', () => {
    expect(filtreaza(R).map(r => r.id)).toEqual([1, 2, 3, 4, 6])
    expect(filtreaza(R, { inactive: true }).map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('categorie, personal/firmă, text fără diacritice', () => {
    expect(filtreaza(R, { categorie: 'utilitati' }).map(r => r.id)).toEqual([1, 2, 3])
    expect(filtreaza(R, { tip: 'firma' }).map(r => r.id)).toEqual([4, 6])
    expect(filtreaza(R, { tip: 'personal' }).map(r => r.id)).toEqual([1, 2, 3])
    expect(filtreaza(R, { text: 'stefan' }).map(r => r.id)).toEqual([2])
    expect(filtreaza(R, { text: '90000000' }).map(r => r.id)).toEqual([1, 2])
    expect(filtreaza(R, { text: 'PERSOANA TREI' }).map(r => r.id)).toEqual([4])
    expect(filtreaza(null)).toEqual([])
  })
})

describe('grupeaza', () => {
  it('categorie în ordinea fixă → serviciu alfabetic; categorie necunoscută → altele', () => {
    const g = grupeaza(filtreaza(R, { inactive: true }))
    expect(g.map(x => x.categorie)).toEqual(['utilitati', 'institutii', 'firma', 'altele'])
    expect(g[0].servicii.map(s => s.serviciu)).toEqual(['Furnizor Curent', 'Furnizor Gaz'])
    expect(g[0].servicii[0].randuri.map(r => r.id)).toEqual([1, 2])
    expect(g[3].servicii[0].serviciu).toBe('Ciudat')
  })
  it('activele înaintea inactivelor în același serviciu', () => {
    const g = grupeaza([{ id: 1, categorie: 'firma', serviciu: 'X', activ: false }, { id: 2, categorie: 'firma', serviciu: 'X', activ: true }])
    expect(g[0].servicii[0].randuri.map(r => r.id)).toEqual([2, 1])
  })
})

describe('pregatesteRand', () => {
  const baza = { categorie: 'utilitati', serviciu: '  Furnizor Gaz ', url: '', utilizator: ' a@x.ro ', titular: '', cod_client: '', personal: true, observatii: '', locatie_ids: [] }
  it('curăță spațiile, golurile devin NULL', () => {
    const { rand, eroare } = pregatesteRand(baza, [1, 2])
    expect(eroare).toBeUndefined()
    expect(rand).toEqual({ categorie: 'utilitati', serviciu: 'Furnizor Gaz', url: null, utilizator: 'a@x.ro', titular: null, cod_client: null,
      personal: true, observatii: null, activ: true, locatie_ids: null })
  })
  it('refuză serviciu fără literă/cifră (tab, NBSP), link cu utilizator/parolă sau ?password=', () => {
    expect(pregatesteRand({ ...baza, serviciu: '\t\u00a0' }).eroare).toMatch(/obligatoriu/)
    expect(pregatesteRand({ ...baza, serviciu: '—' }).eroare).toMatch(/obligatoriu/)
    expect(pregatesteRand({ ...baza, url: 'https://admin:Parola1@192.168.1.1/' }).eroare).toMatch(/utilizator\/parol/)
    expect(pregatesteRand({ ...baza, url: 'HTTPS://admin@router.local' }).eroare).toMatch(/utilizator\/parol/)
    expect(pregatesteRand({ ...baza, url: 'https:////admin:abc123@example.com/' }).eroare).toMatch(/utilizator\/parol/)
    expect(pregatesteRand({ ...baza, url: 'https://x.ro\\cale' }).eroare).toMatch(/backslash/)
    expect(pregatesteRand({ ...baza, url: 'https://x.ro/login?password=abc' }).eroare).toMatch(/parol/)
    expect(pregatesteRand({ ...baza, url: 'https://x.ro/p?e=a@b.ro' }).rand.url).toBe('https://x.ro/p?e=a@b.ro')
  })
  it('refuză: fără categorie, fără serviciu, link nesigur, parolă, prea lung', () => {
    expect(pregatesteRand({ ...baza, categorie: 'banci' }).eroare).toMatch(/categorie/)
    expect(pregatesteRand({ ...baza, serviciu: '   ' }).eroare).toMatch(/obligatoriu/)
    expect(pregatesteRand({ ...baza, url: 'javascript:alert(1)' }).eroare).toMatch(/http/)
    expect(pregatesteRand({ ...baza, observatii: 'parola: secret' }).eroare).toMatch(/parol/)
    expect(pregatesteRand({ ...baza, utilizator: 'x'.repeat(201) }).eroare).toMatch(/prea lung/)
  })
  it('locații: doar id-uri cunoscute, fără dubluri; limita de 20', () => {
    expect(pregatesteRand({ ...baza, locatie_ids: [1, '1', 2, 99] }, [1, 2]).rand.locatie_ids).toEqual([1, 2])
    const multe = Array.from({ length: 21 }, (_, i) => i + 1)
    expect(pregatesteRand({ ...baza, locatie_ids: multe }, multe).eroare).toMatch(/20/)
  })
  it('editarea păstrează legăturile existente spre locații care nu mai sunt în listă (J16-3)', () => {
    expect(pregatesteRand({ ...baza, locatie_ids: [1, 99] }, [1, 2], [1, 99]).rand.locatie_ids).toEqual([1, 99])
    // scoasă explicit de om → dispare
    expect(pregatesteRand({ ...baza, locatie_ids: [1] }, [1, 2], [1, 99]).rand.locatie_ids).toEqual([1])
    // id-uri inventate care nu erau pe rând și nu sunt cunoscute → ignorate
    expect(pregatesteRand({ ...baza, locatie_ids: [1, 77] }, [1, 2], [1, 99]).rand.locatie_ids).toEqual([1])
  })
  it('activ=false se păstrează (ștergere = dezactivare)', () => {
    expect(pregatesteRand({ ...baza, activ: false }).rand.activ).toBe(false)
  })
})

describe('conturiPeLocatie', () => {
  it('doar conturile active legate de locație', () => {
    expect(conturiPeLocatie(R, 1).map(r => r.id)).toEqual([1, 2])
    expect(conturiPeLocatie(R, '3').map(r => r.id)).toEqual([2])
    expect(conturiPeLocatie(R, 7)).toEqual([])
  })
})

describe('compatibilitate browsere vechi', () => {
  it('sursa nu folosește lookbehind (Safari/iOS < 16.4 nu-l parsează, modulul e importat static)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./conturiUtil.js', import.meta.url), 'utf8')
    expect(/\(\?<[=!]/.test(src)).toBe(false)
  })
})
