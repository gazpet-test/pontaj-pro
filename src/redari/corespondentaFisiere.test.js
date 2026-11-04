import { describe, it, expect } from 'vitest'
import { roluriPermise, valideazaFisierCoresp, slugNume, stampilaUtc, caleFisierCoresp, sha8, sha256Hex, fisierDeAprobat, fisiereRand, mimeFisier,
  MAX_FISIER_CORESP, fmtMarime, aleator8, citesteFisiereProiect, citesteFisiereRand, listeazaFolder, orfani, folderCoresp, EMBED_PROIECT, gasesteOrfani,
  asiguraObiect, reconciliazaInregistrare, eAmbigua, registruIncercari } from './corespondentaFisiere.js'
import { mesajEroareCoresp, COL_CORESPONDENTA } from './corespondenta.js'

const SHA = 'ab'.repeat(32)

// fake pentru PostgREST + Storage: tabel cu keyset real (or created_at/id), plafon de server, insert cu 23505, storage cu upload / list / timeout
function fakeBD(randuri, opt = {}) {
  const tabel = randuri.map(r => ({ ...r }))
  const obiecte = (opt.obiecte || []).map(o => ({ ...o }))
  const apeluri = []
  const desc = (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  let tarziu = [...(opt.inregistrateTarziu || [])]
  const from = () => {
    const f = []
    const q = {
      select: (...a) => { f.push(['select', ...a]); return q },
      eq: (...a) => { f.push(['eq', ...a]); return q },
      or: (...a) => { f.push(['or', ...a]); return q },
      order: (...a) => { f.push(['order', ...a]); return q },
      limit: n => {
        f.push(['limit', n]); apeluri.push(['tabel', ...f])
        if (opt.citireCazuta) return Promise.reject(new Error('Failed to fetch'))
        let rez = [...tabel]
        for (const [op, k, v] of f) if (op === 'eq') {
          if (k === 'red_corespondenta.proiect_id') rez = rez.filter(r => r.red_corespondenta?.proiect_id === v)
          else if (k === 'path' && tarziu.includes(v)) { tarziu = tarziu.filter(x => x !== v); return Promise.resolve({ data: [{ id: 'tarziu' }], error: null }) }
          else rez = rez.filter(r => r[k] === v)
        }
        const o = f.find(x => x[0] === 'or')
        if (o) { const m = /^created_at\.lt\."(.*)",and\(created_at\.eq\."(.*)",id\.lt\.(.*)\)$/.exec(o[1]); rez = rez.filter(r => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3])) }
        rez.sort(desc)
        return Promise.resolve({ data: rez.slice(0, Math.min(n, opt.plafon || Infinity)), error: null })
      },
      insert: row => ({ select: () => {
        if (opt.timeoutLaInsert) return Promise.reject(new Error('Failed to fetch'))
        if (opt.refuzInsert) return Promise.resolve({ data: null, error: opt.refuzInsert })
        if (tabel.some(r => r.path === row.path)) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "red_corespondenta_fisiere_path_uq"' } })
        tabel.push({ id: 'nou', created_at: 'z', ...row })
        if (opt.timeoutDupaInsert) return Promise.reject(new Error('Failed to fetch'))
        return Promise.resolve({ data: [{ id: 'nou' }], error: null })
      } }),
    }
    return q
  }
  const storage = { from: () => ({
    list: (folder, o) => { apeluri.push(['list', folder, o])
      let l = obiecte.filter(x => !x.folder || x.folder === folder)
      if (o.search) l = l.filter(x => x.name.includes(o.search))
      return Promise.resolve({ data: l.slice(o.offset, o.offset + o.limit), error: null }) },
    upload: (path, blob) => {
      const i = path.lastIndexOf('/'), folder = path.slice(0, i), name = path.slice(i + 1)
      if (opt.refuzUpload) return Promise.resolve({ data: null, error: { statusCode: opt.refuzUpload, message: 'refuz' } })
      if (obiecte.some(x => x.folder === folder && x.name === name)) return Promise.resolve({ data: null, error: { statusCode: '409', message: 'The resource already exists' } })
      if (!opt.nuSalveaza) obiecte.push({ id: 'o' + obiecte.length, folder, name })
      if (opt.timeoutLaUpload) return Promise.reject(new Error('Failed to fetch'))
      return Promise.resolve({ data: { path }, error: null })
    },
  }) }
  return { apeluri, obiecte, from, storage, randuri: () => tabel.map(r => ({ ...r })) }
}

describe('fisierele corespondentei', () => {
  it('de_trimis nu se mai urca dupa trimis / raspuns / anulat; restul rolurilor oricand', () => {
    expect(roluriPermise({ stare: 'draft' })).toEqual(['de_trimis', 'dovada_trimitere', 'raspuns', 'altul'])
    expect(roluriPermise({ stare: 'aprobat' })).toContain('de_trimis')
    for (const stare of ['trimis', 'raspuns_primit', 'anulat']) expect(roluriPermise({ stare })).toEqual(['dovada_trimitere', 'raspuns', 'altul'])
  })
  it('validarea fisierului: tip, gol, 25 MB', () => {
    expect(valideazaFisierCoresp({ name: 'a.PDF', size: 10 })).toEqual([])
    expect(valideazaFisierCoresp({ name: 'a.docx', size: MAX_FISIER_CORESP })).toEqual([])
    expect(valideazaFisierCoresp({ name: 'a.exe', size: 10 })).toHaveLength(1)
    expect(valideazaFisierCoresp({ name: 'a.pdf', size: 0 })).toEqual(['Fișierul e gol.'])
    expect(valideazaFisierCoresp({ name: 'a.pdf', size: MAX_FISIER_CORESP + 1 })).toEqual(['Fișierul depășește 25 MB.'])
    expect(valideazaFisierCoresp(null)).toEqual(['Alege un fișier.'])
    expect(mimeFisier({ name: 'x.JPG', type: '' })).toBe('image/jpeg')
  })
  it('slug: fara diacritice / spatii, extensia in litere mici, nume gol -> fisier', () => {
    expect(slugNume('Scrisoare Transgaz – plan rev9 (final).PDF')).toBe('scrisoare-transgaz-plan-rev9-final.pdf')
    expect(slugNume('ăîșțâ.docx')).toBe('aista.docx')
    expect(slugNume('....pdf')).toBe('fisier.pdf')
    expect(slugNume('x'.repeat(100) + '.png')).toBe('x'.repeat(60) + '.png')
  })
  it('calea: {proiect}/corespondenta/{cod}/{AAAAMMDD-HHmmss}-{sha8}-{aleator8}-{slug}, in forma ceruta de trigger', () => {
    const d = new Date(Date.UTC(2026, 10, 4, 9, 5, 7))
    expect(stampilaUtc(d)).toBe('20261104-090507')
    const c = caleFisierCoresp({ proiectCod: 'LOT1-PRUNISOR-JUPA', corespCod: 'A1', sha256: SHA, nume: 'Scrisoare rev9.pdf', data: d, aleator: '0123abcd' })
    expect(c).toBe('LOT1-PRUNISOR-JUPA/corespondenta/A1/20261104-090507-abababab-0123abcd-scrisoare-rev9.pdf')
    // aceeasi regula ca fn_red_coresp_fisier_inainte (numele fisierului)
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(pdf|docx|jpe?g|png)$/i.test(c.split('/').pop())).toBe(true)
    expect(folderCoresp('P', 'A1')).toBe('P/corespondenta/A1')
    expect(() => caleFisierCoresp({ proiectCod: '../x', corespCod: 'A1', sha256: SHA, nume: 'a.pdf' })).toThrow(/invalidă/)
    expect(() => caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: 'x', nume: 'a.pdf' })).toThrow(/sha256/)
  })
  it('Copilot C-P3-02: doua cai generate in aceeasi secunda, acelasi continut si nume, sunt diferite', () => {
    const d = new Date(Date.UTC(2026, 10, 4, 9, 5, 7))
    const a = caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: SHA, nume: 'x.pdf', data: d })
    const b = caleFisierCoresp({ proiectCod: 'P', corespCod: 'A1', sha256: SHA, nume: 'x.pdf', data: d })
    expect(a).not.toBe(b)
    expect(aleator8()).toMatch(/^[0-9a-f]{8}$/)
  })
  it('sha256 hex (WebCrypto) si sha8', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha8(SHA)).toBe('abababab')
  })
  it('Jakarinos J-P1-2 (paritate cu PostgreSQL): helperii NU re-sorteaza — pastreaza ordinea din query (created_at desc, id desc)', () => {
    // ordinea PostgreSQL: 10:00:00.12 > 10:00:00 (ca text, '…00+00:00' vs '…00.12+00:00' s-ar fi comparat altfel)
    const dinBD = [
      { id: 'a', rol: 'de_trimis', created_at: '2026-11-04T10:00:00.12+00:00', corespondenta_id: 'r1' },
      { id: 'b', rol: 'de_trimis', created_at: '2026-11-04T10:00:00+00:00', corespondenta_id: 'r1' },
    ]
    expect(fisierDeAprobat(dinBD).id).toBe('a')
    expect(fisierDeAprobat([...dinBD].reverse()).id).toBe('b')   // nicio sortare locala: primul primit e cel ales
    const f = [{ id: 'c', rol: 'dovada_trimitere', corespondenta_id: 'r1' }, ...dinBD, { id: 'z', rol: 'de_trimis', corespondenta_id: 'r2' }]
    expect(fisiereRand(f, 'r1').map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(fisierDeAprobat(fisiereRand(f, 'r1')).id).toBe('a')
    expect(fisierDeAprobat(f.filter(x => x.rol !== 'de_trimis'))).toBeNull()
  })
  it('L23 / r2 J-P2-1: keyset (created_at desc, id desc), oprire DOAR la pagina goala — si cu plafon de server sub pagina, peste 1000 de randuri', async () => {
    const pad = n => String(n).padStart(5, '0')
    const randuri = Array.from({ length: 1203 }, (_, i) => ({ id: `f${pad(i)}`, created_at: `2026-11-04T10:${pad(Math.floor(i / 3))}`, corespondenta_id: 'r1', red_corespondenta: { proiect_id: 'p' } }))
    const sb = fakeBD(randuri, { plafon: 100 })   // serverul taie la 100, clientul cere 500
    const r = await citesteFisiereProiect(sb, 'p', { pagina: 500 })
    expect(r).toHaveLength(1203); expect(new Set(r.map(x => x.id)).size).toBe(1203)
    expect(r[0].created_at >= r[1202].created_at).toBe(true); expect(r[0].red_corespondenta).toBeUndefined()
    expect(sb.apeluri.length).toBe(14)   // 12 pagini plafonate la 100 + una de 3 + una goala
    const [, sel, eq, ...rest1] = sb.apeluri[0]
    expect(sel[1]).toContain(EMBED_PROIECT); expect(eq).toEqual(['eq', 'red_corespondenta.proiect_id', 'p'])
    expect(rest1).toEqual([['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 500]])
    expect(sb.apeluri[1].find(a => a[0] === 'or')[1]).toMatch(/^created_at\.lt\."[^"]+",and\(created_at\.eq\."[^"]+",id\.lt\.f\d+\)$/)
    expect(await citesteFisiereRand(fakeBD(randuri), 'r1', { pagina: 500, esteCurent: () => false })).toBeNull()
  })
  it('C-P2-01 / r2 J-P2-1: orfanii = obiecte din folder fara rand (dedup, verificare finala pe path, lista posibil incompleta)', async () => {
    const ob = [{ id: '1', name: 'a.pdf', metadata: { size: 5 } }, { id: null, name: 'sub' }, { id: '2', name: 'b.pdf' }, { id: '3', name: 'c.pdf' }, { id: '3', name: 'c.pdf' }]
    const sb = fakeBD([{ id: 'x', created_at: 't', path: 'P/corespondenta/A1/b.pdf', corespondenta_id: 'r1' }], { obiecte: ob, inregistrateTarziu: ['P/corespondenta/A1/c.pdf'] })
    const { lista, incompleta } = await listeazaFolder(sb, 'P/corespondenta/A1', { pagina: 2 })
    expect(lista.map(o => o.nume)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']); expect(incompleta).toBe(true)   // dublura c.pdf
    const rez = await gasesteOrfani(sb, { folder: 'P/corespondenta/A1', randId: 'r1' })
    expect(rez.lista.map(o => o.nume)).toEqual(['a.pdf'])   // c.pdf a aparut in tabel intre timp -> eliminat la verificarea finala
    expect(rez.incompleta).toBe(true)
    expect(orfani([{ path: 'x' }, { path: 'y' }], [{ path: 'y' }]).map(o => o.path)).toEqual(['x'])
  })
  it('r2 J-P2-2 / C-P2-01: storage salveaza, clientul primeste timeout -> obiectul e gasit, fara reupload; reincercarea pe aceeasi cale nu creeaza alt obiect', async () => {
    const sb = fakeBD([], { timeoutLaUpload: true })
    const f = new Blob(['x'], { type: 'application/pdf' })
    expect(await asiguraObiect(sb, 'P/corespondenta/A1/f.pdf', f, 'application/pdf')).toBe('exista')
    expect(await asiguraObiect(sb, 'P/corespondenta/A1/f.pdf', f, 'application/pdf')).toBe('exista')   // retry: 409, nimic nou
    expect(sb.obiecte.filter(o => o.name === 'f.pdf')).toHaveLength(1)
    expect(await asiguraObiect(fakeBD([]), 'P/corespondenta/A1/g.pdf', f, 'application/pdf')).toBe('urcat')
    const pierdut = fakeBD([], { timeoutLaUpload: true, nuSalveaza: true })
    expect(await asiguraObiect(pierdut, 'P/corespondenta/A1/h.pdf', f, 'application/pdf')).toBe('neconfirmat')
    await expect(asiguraObiect(fakeBD([], { refuzUpload: 403 }), 'P/corespondenta/A1/i.pdf', f, 'application/pdf')).rejects.toMatchObject({ statusCode: 403 })
    expect(eAmbigua({ message: 'Failed to fetch' })).toBe(true); expect(eAmbigua({ statusCode: 503 })).toBe(true); expect(eAmbigua({ statusCode: 400 })).toBe(false)
  })
  it('r2 C-P2-03: reconcilierea INSERT compara payload-ul semantic (corespondenta_id, rol, sha256, path)', async () => {
    const pl = { corespondenta_id: 'r1', rol: 'de_trimis', path: 'P/corespondenta/A1/f.pdf', sha256: SHA }
    // timeout dupa INSERT reusit -> randul identic exista -> ok
    expect((await reconciliazaInregistrare(fakeBD([], { timeoutDupaInsert: true }), pl)).rez).toBe('ok')
    // 23505: aceeasi cale, alt rol -> conflict (NU ok)
    const ex = fakeBD([{ id: 'x', ...pl, rol: 'altul', created_at: 't' }])
    const c = await reconciliazaInregistrare(ex, pl)
    expect(c.rez).toBe('conflict'); expect(c.rand.rol).toBe('altul')
    // refuz clar al BD-ului (trigger) si randul nu exista -> arunca
    await expect(reconciliazaInregistrare(fakeBD([], { refuzInsert: { code: '23514', message: 'redari: fisierul lipseste din Storage (x)' } }), pl)).rejects.toMatchObject({ code: '23514' })
    // retea cazuta si la citire -> neconfirmat
    expect((await reconciliazaInregistrare(fakeBD([], { timeoutLaInsert: true, citireCazuta: true }), pl)).rez).toBe('neconfirmat')
    expect((await reconciliazaInregistrare(fakeBD([]), pl)).rez).toBe('ok')
  })
  it('r3 C-P2-02: timeout dupa INSERT, reluare cu observatii / nume diferite -> conflict explicit (toate campurile imutabile)', async () => {
    const pl = { corespondenta_id: 'r1', rol: 'de_trimis', path: 'P/corespondenta/A1/f.pdf', sha256: SHA, nume_original: 'f.pdf', observatii: 'prima' }
    const sb = fakeBD([], { timeoutDupaInsert: true })
    expect((await reconciliazaInregistrare(sb, pl)).rez).toBe('ok')   // randul a ajuns, raspunsul s-a pierdut
    const dupa = fakeBD(sb.randuri())
    expect((await reconciliazaInregistrare(dupa, { ...pl, observatii: 'alta' })).rez).toBe('conflict')
    expect((await reconciliazaInregistrare(dupa, { ...pl, nume_original: 'alt.pdf' })).rez).toBe('conflict')
    expect((await reconciliazaInregistrare(dupa, { ...pl })).rez).toBe('ok')   // acelasi payload (cum il reia UI-ul) -> ok
    expect((await reconciliazaInregistrare(fakeBD([{ id: 'x', created_at: 't', ...pl, observatii: null }]), { ...pl, observatii: undefined })).rez).toBe('ok')   // null ~ lipsa
  })
  it('r3 J-P2-1 / C-P2-03: doua incercari suprapuse A -> B rezolvate in ordine inversa: A nu atinge incercarea activa B (succes / ambiguu / refuz)', () => {
    for (const rezultatA of [null, { stare: 'neconfirmat' }, { stare: 'refuzat' }]) {
      for (const rezultatB of [null, { stare: 'neconfirmat' }, { stare: 'refuzat' }]) {
        const vazute = []
        const reg = registruIncercari(v => vazute.push(v))
        const A = reg.porneste({ path: 'a', stare: 'in_curs' })
        const B = reg.porneste({ path: 'b', stare: 'in_curs' })   // ex. proiect schimbat / sesiune noua, alt upload
        expect(reg.actualizeaza(B.id, rezultatB)).toBe(true)        // B se termina primul
        const dupaB = reg.curenta()
        expect(reg.actualizeaza(A.id, rezultatA)).toBe(false)       // A, terminat mai tarziu, e ignorat
        expect(reg.curenta()).toBe(dupaB)
        expect(dupaB === null ? null : dupaB.path).toBe(rezultatB === null ? null : 'b')
      }
    }
    const reg = registruIncercari()
    const A = reg.porneste({ path: 'a' }); expect(reg.actualizeaza(A.id, { stare: 'neconfirmat' })).toBe(true)
    expect(reg.curenta()).toMatchObject({ id: A.id, path: 'a', stare: 'neconfirmat' })
    reg.reseteaza(); expect(reg.actualizeaza(A.id, null)).toBe(false); expect(reg.curenta()).toBeNull()
  })
  it('mesajele noi din BD sunt traduse; coloanele noi sunt citite', () => {
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: aproba doar dupa ce ai urcat fisierul de trimis' })).toMatch(/Urcă întâi/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: intre timp s-a urcat alt fisier de trimis; reincarca si verifica' })).toMatch(/Între timp/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: aprobarea trebuie sa indice fisierul de trimis confirmat; reincarca si verifica' })).toMatch(/confirmat/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: obiectul nu are amprenta (eTag) in Storage; reincearca urcarea' })).toMatch(/eTag/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul de trimis nu se mai urca dupa trimitere / anulare; urca dovada sau raspunsul' })).toMatch(/dovada trimiterii/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierul lipseste din Storage (x)' })).toMatch(/Storage/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: fisierele corespondentei sunt imutabile; urca o varianta noua' })).toMatch(/nu se modifică/)
    expect(COL_CORESPONDENTA).toMatch(/aprobat_fisier_id, aprobat_sha256, aprobat_storage_etag/)
    expect(fmtMarime(2048)).toBe('2 KB'); expect(fmtMarime(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
