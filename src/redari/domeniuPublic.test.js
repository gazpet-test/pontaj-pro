// Redări — domeniul public redari.gazpet.ro: garda din client + regula din vercel.json. Date fictive, fără PII.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { tintaRedirectHostPublic, esteCalePublicaRedari, ORIGINE_PUBLICA_REDARI, ORIGINE_ERP, HOST_PUBLIC_REDARI } from './domeniuPublic.js'
import { CAMPURI_PROIECT } from './setari.js'

const TOK = 'tokenfictiv1234567890abcdefghijk'
const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))

// Tabelul de cazuri comun pentru garda din client și regula Vercel (aceeași definiție în ambele locuri)
const PAGINI_PUBLICE = [`/redari/raspuns/${TOK}`, `/redari/raspuns/${TOK}/`, '/redari/informare', '/redari/informare/']
const CAI_ERP = ['/', '/login', '/redari', '/redari/raspuns', '/redari/raspuns/', `/redari/raspuns/${TOK}/altceva`, '/redari/informare-x', '/hr', '/logistica', '/api/seap-import', '/q/12', '/aplica', '/sw.js', '/redari/sabloane/convocator.docx']

describe('constante', () => {
  it('originea publică e fixă, pe HTTPS', () => {
    expect(ORIGINE_PUBLICA_REDARI).toBe('https://redari.gazpet.ro')
    expect(HOST_PUBLIC_REDARI).toBe('redari.gazpet.ro')
    expect(ORIGINE_ERP).toBe('https://pontaj-pro-sooty.vercel.app')
  })
})

// Ruta /redari/informare vine cu PR #939 (pagina publică, cu banda PROIECT + noindex cât informarea nu e publicată).
// Calea poate apărea DOAR în fișierele #939; orice altă componentă care ar trimite la ea e o regresie.
describe('/redari/informare apare doar în fișierele #939', () => {
  const fisiere = (dir) => readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? fisiere(p) : [p]
  })
  it('Setări proiect: câmpul link_informare_gdpr nu are sugestie de link', () => {
    expect(CAMPURI_PROIECT.find(c => c.cheie === 'link_informare_gdpr').exemplu).toBeUndefined()
  })
  it('calea /redari/informare apare doar în ruta, pagina, formularul public și sursa informării', () => {
    const src = resolve(process.cwd(), 'src')
    const cuCalea = fisiere(src)
      .filter(p => /\.(jsx?|mjs)$/.test(p) && !/\.test\.(jsx?|mjs)$/.test(p))
      // calea de pagină, nu și importul modulului „./redari/informareGdpr.js”
      .filter(p => /redari\/informare(?![A-Za-z])/i.test(readFileSync(p, 'utf8')))
      .map(p => relative(src, p).split('\\').join('/'))
      .sort()
    expect(cuCalea).toEqual(['App.jsx', 'RedariInformarePublic.jsx', 'RedariRaspunsPublic.jsx', 'redari/docx.js', 'redari/informareGdpr.js'])
  })
})

describe('garda din client (tintaRedirectHostPublic)', () => {
  const pe = (hostname, pathname, search = '', hash = '') => tintaRedirectHostPublic({ hostname, pathname, search, hash })
  it('rută publică pe host-ul public → rămâne', () => {
    for (const p of PAGINI_PUBLICE) expect(pe('redari.gazpet.ro', p), p).toBeNull()
    expect(pe('REDARI.gazpet.ro', `/redari/raspuns/${TOK}`)).toBeNull()
  })
  it('rută ERP pe host-ul public → domeniul principal, aceeași cale + query + hash', () => {
    expect(pe('redari.gazpet.ro', '/hr', '?tab=1', '#x')).toBe('https://pontaj-pro-sooty.vercel.app/hr?tab=1#x')
    expect(pe('redari.gazpet.ro', '/')).toBe('https://pontaj-pro-sooty.vercel.app/')
    expect(pe('redari.gazpet.ro', '')).toBe('https://pontaj-pro-sooty.vercel.app/')
    for (const p of CAI_ERP) expect(pe('redari.gazpet.ro', p), p).toBe(`https://pontaj-pro-sooty.vercel.app${p}`)
  })
  it('pe alt host nu face nimic (domeniul principal, localhost, preview)', () => {
    for (const h of ['pontaj-pro-sooty.vercel.app', 'localhost', 'pontaj-pro-git-x.vercel.app', 'redari.gazpet.ro.exemplu.test'])
      for (const p of [...PAGINI_PUBLICE, ...CAI_ERP]) expect(pe(h, p), `${h}${p}`).toBeNull()
    expect(tintaRedirectHostPublic(null)).toBeNull()
  })
  it('resursă statică inexistentă care a căzut pe fallback-ul SPA (/assets/inexistent.js) → redirect, aplicația nu rămâne pe host-ul public', () => {
    expect(pe('redari.gazpet.ro', '/assets/inexistent.js')).toBe('https://pontaj-pro-sooty.vercel.app/assets/inexistent.js')
    expect(pe('redari.gazpet.ro', '/manifest.webmanifest')).toBe('https://pontaj-pro-sooty.vercel.app/manifest.webmanifest')
  })
})

describe('vercel.json', () => {
  const reguli = (vercel.redirects || []).filter(r => (r.has || []).some(h => h.type === 'host' && h.value === 'redari.gazpet.ro'))
  // Sursa e în sintaxa path-to-regexp „/:path(<regex>)”; o transformăm în RegExp JS ca să rulăm aceleași cazuri
  const rxSursa = (src) => {
    const m = /^\/:path\((.*)\)$/.exec(src)
    if (!m) throw new Error(`sursă neașteptată: ${src}`)
    return new RegExp(`^/(?:${m[1]})$`)
  }

  it('o singură regulă de redirect pe host-ul public, temporară (307), către domeniul principal cu aceeași cale', () => {
    expect(reguli).toHaveLength(1)
    const r = reguli[0]
    expect(r.has).toEqual([{ type: 'host', value: 'redari.gazpet.ro' }])
    expect(r.destination).toBe('https://pontaj-pro-sooty.vercel.app/:path*')
    expect(r.permanent).toBe(false)
  })
  it('regula lasă paginile publice și resursele statice, redirecționează restul (paritate cu garda din client)', () => {
    const rx = rxSursa(reguli[0].source)
    const statice = ['/assets/index-abc123.js', '/assets/index-abc123.css', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/favicon.ico']
    for (const p of [...PAGINI_PUBLICE, ...statice]) expect(rx.test(p), p).toBe(false)
    for (const p of CAI_ERP) expect(rx.test(p), p).toBe(true)
    for (const p of [...PAGINI_PUBLICE, ...CAI_ERP]) expect(!rx.test(p), p).toBe(esteCalePublicaRedari(p))
  })
  it('rewrite-ul SPA și headerele formularului public au rămas', () => {
    expect(vercel.rewrites).toContainEqual({ source: '/((?!api/).*)', destination: '/index.html' })
    const h = vercel.headers.find(x => x.source === '/redari/raspuns/(.*)')
    expect(h.headers.map(x => x.key).sort()).toEqual(['Cache-Control', 'Referrer-Policy', 'X-Robots-Tag'])
    expect(Object.keys(vercel.functions)).toContain('api/seap-import.js')
  })
  it('nicio regulă de redirect fără condiția de host (domeniul principal rămâne neatins)', () => {
    expect((vercel.redirects || []).every(r => (r.has || []).some(h => h.type === 'host'))).toBe(true)
  })
})
