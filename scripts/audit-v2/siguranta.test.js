import { describe, it, expect } from 'vitest'
import { verificaSandbox, verificaIds, caleSandbox } from './siguranta.js'
import { verificaPerechi, copiazaStorage } from './sandbox_storage_copy.mjs'
import { verdictAsertiuni } from './asertiuni.js'
import { CDP, urlSigur } from './cdp.mjs'
import { ruleaza, actiuneUI, verificaContextUI } from './scenariu.mjs'
import { mascheaza, salveazaJson, incarcaJson } from './dovezi.mjs'
import { mkdtemp, readdir, stat, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const tmpdir = () => fileURLToPath(new URL('./', import.meta.url))
import { join } from 'node:path'

describe('protecție anti-producție', () => {
  it('titlul copiat nu înlocuiește verificarea ID-ului selectat în UI', async () => {
    const d = { asteapta: async () => {}, observa: async () => ({ value: '5' }) }
    await expect(verificaContextUI(d, { id: 103, nr_anunt: 'SANDBOX-V2-DOMNESTI' }, { tip: 'select', selector: 'css=select' })).rejects.toThrow('nu indică clona')
  })
  it.each([null, { id: 5, nr_anunt: 'SANDBOX-V2-DOMNESTI' }, { id: 103, nr_anunt: 'SCN111' }, { id: 99, nr_anunt: 'SANDBOX-V2-DOMNESTI' }, { id: 103, nr_anunt: 'sandbox-v2-test' }])('refuză %j', lic => {
    expect(() => verificaSandbox(lic, { licitatie_id: 103 })).toThrow('REFUZ')
  })
  it('interzice licitația 5 chiar dacă numărul a fost schimbat', () => expect(() => verificaSandbox({ id: 5, nr_anunt: 'SANDBOX-V2-X' }, { licitatie_id: 5 })).toThrow())
  it('acceptă numai id-ul clonei cu prefixul exact', () => expect(verificaSandbox({ id: 103, nr_anunt: 'SANDBOX-V2-DOMNESTI' }, { licitatie_id: 103 })).toBe(true))
  it('respinge cerințe din original', () => expect(() => verificaIds({ licitatie_id: 103, cerinte: { D1: 1, D6: 2, D8: 3 } }, [1, 2, 3].map(id => ({ id, licitatie_id: 5 })))).toThrow())
  it.each(['5/a.pdf', 'sandbox-v2/5/../real.pdf', 'sandbox-v2/5/%2e%2e/a', 'sandbox-v2/5/..\\x'])('respinge destinația %s', p => expect(() => caleSandbox(p)).toThrow())
  it('verifică corespondența exactă source/destination', () => expect(() => verificaPerechi([{ cale_veche: '5/a', cale_noua: '103/b' }])).toThrow())
  it('niciun apel Storage dacă licitația nu este sandbox', async () => {
    let accesStorage = 0
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 5, nr_anunt: 'REAL' } }) }
    const db = { from: () => query, storage: { from: () => { accesStorage++; throw Error() } } }
    await expect(copiazaStorage(db, [{ cale_veche: '5/a', cale_noua: '103/a' }], { licitatie_id: 5 }, async () => {})).rejects.toThrow('REFUZ')
    expect(accesStorage).toBe(0)
  })
  it('scenariul apply refuză licitația reală înainte de conectarea CDP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audit-v2-guard-')); const exit = process.exitCode
    try {
      const fixtureFile = join(dir, 'fixture.json'); await writeFile(fixtureFile, JSON.stringify({ licitatie_id: 5, scenarii: {} }))
      let connects = 0
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 5, nr_anunt: 'REAL' } }) }
      const r = await ruleaza('01_seap_documente', ['--apply', '--fixture', fixtureFile], { dir, db: { from: () => query }, conecteaza: async () => { connects++; throw Error() } })
      expect(connects).toBe(0); expect(r.eroare).toContain('REFUZ'); expect(r.verdict).toBe('UNDETERMINED')
    } finally { process.exitCode = exit; await rm(dir, { recursive: true, force: true }) }
  })
  it.each([true, false])('Storage compară bytes sursă/read-back (identic=%s)', async identic => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 103, nr_anunt: 'SANDBOX-V2-DOMNESTI' } }) }
    let copie = 0; let salvat
    const db = { from: () => query, storage: { from: () => ({
      download: async p => ({ data: new Blob([p.startsWith('5/') || identic ? 'original' : 'diferit']) }),
      copy: async () => { copie++; return {} },
    }) } }
    const task = copiazaStorage(db, [{ cale_veche: '5/a', cale_noua: '103/a' }], { licitatie_id: 103 }, async value => { salvat = structuredClone(value) })
    if (identic) { await task; expect(salvat[0].stare).toBe('identic'); expect(salvat[0].sha256).toMatch(/^[a-f0-9]{64}$/) }
    else { await expect(task).rejects.toThrow('SHA-256'); expect(salvat[0].stare).toBe('diferit') }
    expect(copie).toBe(1)
  })
})
describe('verdict și dovezi', () => {
  it('observă un buton disabled fără să-l execute', async () => {
    let clicked = false
    const result = await actiuneUI({ observa: async () => ({ disabled: true }), click: () => { clicked = true } },
      { tip: 'observa', selector: 'text=Depune', asteptat: { disabled: true } })
    expect(result.trece).toBe(true); expect(clicked).toBe(false)
  })
  it('zero postcondiții nu înseamnă MATCH', () => expect(verdictAsertiuni([], {}, {}).verdict).toBe('UNDETERMINED'))
  it('all pe mulțime goală nu e adevăr', () => {
    const s = { tabele: { t: [] } }; expect(verdictAsertiuni([{ tip: 'all', tabela: 't', asteptat: { status: 'ok' } }], s, s).verdict).toBe('PARTIAL')
  })
  it('tabel necitit refuză evaluarea', () => expect(() => verdictAsertiuni([{ tip: 'count', tabela: 't', valoare: 0 }], {}, { tabele: {} })).toThrow())
  it('semnal BYPASS pe tranziție neașteptată', () => {
    const b = { tabele: { t: [{ id: 1, stare: 'aprobat' }] } }; const a = { tabele: { t: [{ id: 1, stare: 'propus' }] } }
    expect(verdictAsertiuni([{ tip: 'unchanged', tabela: 't', where: { id: 1 }, camp: 'stare', la_esec: 'BYPASS' }], b, a).verdict).toBe('BYPASS')
  })
  it('maschează Authorization și signed URLs', () => {
    expect(mascheaza({ Authorization: 'secret', nested: 'https://x/a?token=secret' })).toEqual({ Authorization: '[MASCAT]', nested: 'https://x/a?token=[MASCAT]' })
    expect(urlSigur('https://x.supabase.co/a?apikey=secret')).not.toContain('secret')
  })
  it('CDP log nu colectează corp sau header brut și măsoară durata', () => {
    const c = new CDP({ addEventListener() {} }, 'tab')
    c.event('Network.requestWillBeSent', { type: 'Fetch', requestId: '1', timestamp: 1, request: { method: 'POST', url: 'https://x.supabase.co/rest/v1/t', headers: { Authorization: 'secret' }, postData: 'password' } })
    c.event('Network.responseReceived', { requestId: '1', response: { status: 201 } }); c.event('Network.loadingFinished', { requestId: '1', timestamp: 1.5 })
    expect(c.jurnal()[0]).toMatchObject({ status: 201, durata_ms: 500, Authorization: '[MASCAT]' })
    expect(JSON.stringify(c.jurnal())).not.toContain('secret'); expect(JSON.stringify(c.jurnal())).not.toContain('password')
  })
  it('dovezi mari se păstrează integral cu fișiere sub 2 MB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audit-v2-test-'))
    try {
      const value = { pasaj: 'ă'.repeat(1500000) }; await salveazaJson(dir, 'mare', value)
      for (const p of await readdir(dir)) expect((await stat(join(dir, p))).size).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(await incarcaJson(dir, 'mare')).toEqual(value)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
