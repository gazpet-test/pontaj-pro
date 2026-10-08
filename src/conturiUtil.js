// 🔐 Conturi (Administrativ, owner-only) — partea PURĂ: categorii, filtrare, grupare, validare. Teste: conturiUtil.test.js.
// Tabelul public.conturi_registru (20261021a). FĂRĂ parole — stau în managerul de parole.

export const CATEGORII = {
  utilitati:  { label:'Utilități',  icon:'⚡' },
  aplicatii:  { label:'Aplicații',  icon:'📱' },
  institutii: { label:'Instituții', icon:'🏛' },
  firma:      { label:'Firmă',      icon:'🏢' },
  retea:      { label:'Rețea',      icon:'📶' },
  altele:     { label:'Altele',     icon:'📄' },
}
export const ORDINE_CATEGORII = ['utilitati', 'aplicatii', 'institutii', 'firma', 'retea', 'altele']

// Limitele din CHECK-urile tabelului (20261021a) — validate și în UI, ca eroarea să fie clară înainte de server.
export const LIMITE = { serviciu: 200, url: 500, utilizator: 200, titular: 200, cod_client: 100, observatii: 2000, locatii: 20 }

// Strict https?://<gazdă>[/?#…]: gazda fără „@”, fără slash-uri în plus, fără backslash, fără spații — orice altceva
// (javascript:, data:, https:////user:parola@…) nu devine link și nu se salvează. Același tipar ca CHECK-ul din BD (r2, J16-2).
const URL_SIGUR = /^https?:\/\/[^/?#@\s\\]+(?:[/?#]\S*)?$/i
export const urlSigur = (u) => typeof u === 'string' && URL_SIGUR.test(u.trim()) && !u.includes('\\') && u.trim().length <= LIMITE.url

// Plasă de siguranță: textul pare să conțină o parolă („parola: …”, „parola contului: …”, „PIN-ul: …”, „pass=…”,
// „?password=” într-un link). Nu e o garanție, doar o oprire pentru greșeala de a lipi parola din Excel în registrul fără
// parole. FĂRĂ lookbehind (aserțiune înapoi): Safari/iOS < 16.4 nu-l parsează, iar modulul e importat static (review intern, P1).
const TIPAR_PAROLA = /(?:^|[^\p{L}\p{N}])(?:parol\p{L}*|passw(?:or)?d|pass|psw|pwd|pin(?:-?ul)?)(?:\s+\p{L}+)?\s*[:=：]/iu
export const pareParola = (...texte) => texte.some(t => typeof t === 'string' && TIPAR_PAROLA.test(t.normalize('NFC')))

// Link cu utilizator (și eventual parolă) în el: https://admin:parola@router — refuzat, ca și în CHECK-ul din BD.
// (după oricâte slash-uri / backslash-uri: https:////admin:x@gazdă e tot un link cu credențiale)
export const urlCuCredentiale = (u) => typeof u === 'string' && /^[a-z][a-z0-9+.-]*:[/\\]*[^/?#\s\\]*@/i.test(u.trim())

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Filtrele ecranului: categorie ('toate' | cheie), tip ('toate' | 'personal' | 'firma'), text liber, inactive ascunse implicit.
export function filtreaza(randuri, { categorie = 'toate', tip = 'toate', text = '', inactive = false } = {}) {
  const q = norm(text).trim()
  return (randuri || []).filter(r => {
    if (!inactive && r.activ === false) return false
    if (categorie !== 'toate' && r.categorie !== categorie) return false
    if (tip === 'personal' && !r.personal) return false
    if (tip === 'firma' && r.personal) return false
    if (q && !norm([r.serviciu, r.utilizator, r.titular, r.cod_client, r.observatii].join(' ')).includes(q)) return false
    return true
  })
}

// Grupare categorie → serviciu, în ordinea fixă a categoriilor; serviciile alfabetic (ro), rândurile active întâi.
export function grupeaza(randuri) {
  const peCat = new Map()
  for (const r of randuri || []) {
    const cat = CATEGORII[r.categorie] ? r.categorie : 'altele'
    if (!peCat.has(cat)) peCat.set(cat, new Map())
    const cheie = String(r.serviciu || '').trim()
    const servicii = peCat.get(cat)
    if (!servicii.has(cheie)) servicii.set(cheie, [])
    servicii.get(cheie).push(r)
  }
  return ORDINE_CATEGORII.filter(c => peCat.has(c)).map(c => ({
    categorie: c,
    servicii: [...peCat.get(c).entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'ro'))
      .map(([serviciu, rows]) => ({
        serviciu,
        randuri: [...rows].sort((x, y) => (y.activ !== false) - (x.activ !== false) || (x.id ?? 0) - (y.id ?? 0)),
      })),
  }))
}

// Formularul → rândul de scris. Întoarce { eroare } sau { rand }. Câmpurile goale devin NULL; locațiile: id-uri cunoscute
// (din locatii_inchiriate) PLUS cele care erau deja pe rând (r2, J16-3: o locație ștearsă sau o listă incompletă nu mai șterge
// pe tăcute legătura la editare — o scoate doar omul, explicit); fără dubluri.
export function pregatesteRand(f, idLocatiiCunoscute = [], idLocatiiExistente = []) {
  const t = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
  const rand = {
    categorie: f.categorie,
    serviciu: t(f.serviciu),
    url: t(f.url),
    utilizator: t(f.utilizator),
    titular: t(f.titular),
    cod_client: t(f.cod_client),
    personal: !!f.personal,
    observatii: t(f.observatii),
    activ: f.activ !== false,
  }
  if (!CATEGORII[rand.categorie]) return { eroare: 'Alege o categorie.' }
  if (!rand.serviciu || !/[\p{L}\p{N}]/u.test(rand.serviciu)) return { eroare: 'Serviciul e obligatoriu (ex. Engie, ghiseul.ro).' }
  for (const k of ['serviciu', 'utilizator', 'titular', 'cod_client', 'observatii']) {
    if (rand[k] && rand[k].length > LIMITE[k]) return { eroare: `Câmpul „${k}” e prea lung (max. ${LIMITE[k]} caractere).` }
  }
  if (rand.url && urlCuCredentiale(rand.url)) return { eroare: 'Linkul conține utilizator/parolă (…@…) — scoate-le din link.' }
  if (rand.url && !urlSigur(rand.url)) return { eroare: 'Linkul trebuie să fie de forma https://adresa… (fără spații, fără backslash).' }
  if (pareParola(rand.serviciu, rand.url, rand.utilizator, rand.observatii, rand.cod_client, rand.titular)) {
    return { eroare: 'Pare că ai scris o parolă. Parolele nu intră aici — stau în managerul de parole.' }
  }
  const cunoscute = new Set([...idLocatiiCunoscute, ...(idLocatiiExistente || [])].map(Number))
  const ids = [...new Set((f.locatie_ids || []).map(Number))].filter(id => Number.isInteger(id) && cunoscute.has(id))
  if (ids.length > LIMITE.locatii) return { eroare: `Cel mult ${LIMITE.locatii} locații legate.` }
  rand.locatie_ids = ids.length ? ids : null
  return { rand }
}

// Conturile legate de o locație (pentru cardul din „Locații închiriate”).
export const conturiPeLocatie = (randuri, locatieId) =>
  (randuri || []).filter(r => r.activ !== false && Array.isArray(r.locatie_ids) && r.locatie_ids.map(Number).includes(Number(locatieId)))
