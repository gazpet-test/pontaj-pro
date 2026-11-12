// ════════════════════════════════════════════════════════════════════════════
// Citiri de bord (km / ore) — validare anti-typo comună (TKT-2026-0380)
// ════════════════════════════════════════════════════════════════════════════
// Kilometrajul curent al unui activ (v_active_km_ore) = cel mai MARE număr dintre: valoarea manuală
// de pe activ, maximul din alimentări, maximul din fișele de service, maximul din telemetrie.
// O singură cifră greșită (la o alimentare, o fișă sau în GPS) îl strică definitiv. De aceea:
//   - fișele de service (ServiceTab) ȘI alimentările (Logistica, importuri) trec prin aceeași
//     verificare: plafon absolut, salt imposibil, regres (o singură definiție a pragurilor, L19);
//   - referința unei alimentări vine din surse care nu sunt rândul verificat: mediana (inferioară)
//     ultimelor citiri din fișe și alimentări (o singură cifră greșită nu mută mediana);
//     telemetria NU e referință (odometrul GPS poate fi cu zeci de mii de km peste bord);
//   - unde un număr mare „ține” valoarea sus, arătăm sursa și rândul (sursaValoriiMari).
// Nimic de aici nu blochează: apelantul cere confirmare explicită (window.confirm).
// Capcane de nume: logistica_alimentari.active_id (cu E), logistica_service_fise.activ_id (fără E),
// logistica_telemetrie_zilnica.asset_id.

import { paginareKeyset } from '../hrDeciziiUtil.js'

// salt = cu cât poate crește peste referință fără să fie suspect; regres = cât poate scădea;
// plafon = peste el valoarea e imposibilă fizic; maxPeZi = creșterea maximă posibilă pe zi
// (24 h pe zi la ore; 1.000 km pe zi în medie, zi de zi, la km).
export const PRAG_CITIRI = {
  km:  { salt: 80000, regres: 2000, plafon: 1500000, maxPeZi: 1000, unit: 'km' },
  ore: { salt: 1500,  regres: 200,  plafon: 50000,   maxPeZi: 24,   unit: 'h' },
}
export const SALT_KM = PRAG_CITIRI.km.salt
export const REGRES_KM = PRAG_CITIRI.km.regres
export const MAX_KM = PRAG_CITIRI.km.plafon
export const SALT_ORE = PRAG_CITIRI.ore.salt
export const REGRES_ORE = PRAG_CITIRI.ore.regres
export const MAX_ORE = PRAG_CITIRI.ore.plafon

const ZI = /^\d{4}-\d{2}-\d{2}$/
export const zi = v => (typeof v === 'string' && ZI.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const zileIntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
export const fmtZi = z => (zi(z) ? `${z.slice(8, 10)}.${z.slice(5, 7)}.${z.slice(0, 4)}` : '')
const fmtNr = n => Number(n).toLocaleString('ro-RO')
const numar = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

// Textul pentru om: de unde vine o valoare (și ce rând trebuie deschis ca s-o corecteze).
export function descrieSursa(c) {
  if (!c) return 'sursă necunoscută'
  const d = zi(c.data) ? ` din ${fmtZi(c.data)}` : ''
  const nr = c.id != null ? ` #${c.id}` : ''
  if (c.sursa === 'alimentare') return `alimentarea${nr}${d}`
  if (c.sursa === 'fisa') return `fișa de service${nr}${d}`
  if (c.sursa === 'telemetrie') return `telemetria GPS${d}`
  if (c.sursa === 'manual') return 'valoarea de pe fișa activului („km/ore actuali”)'
  return String(c.sursa || 'sursă necunoscută')
}

// Referința independentă pentru o citire făcută în ziua `dataCitirii`.
// citiri = [{ val, data, sursa: 'fisa' | 'alimentare' | 'manual', id }] — FĂRĂ rândul verificat.
// Din citirile valide (> 0, sub plafon) din aceeași zi sau dinainte se iau ultimele 5 fișe și
// ultimele 5 alimentări, iar referința = MEDIANA INFERIOARĂ a lor: un rând real (cu dată și număr,
// ca omul să-l poată deschide), pe care o singură cifră greșită nu-l poate muta (2 citiri, una
// greșită în sus → rămâne cea corectă). Fără nimic datat: valoarea manuală de pe activ.
// Întoarce { val, sursa, data, id } sau null (nu se poate judeca).
export function referintaIndependenta(citiri, dataCitirii, plafon) {
  const d = zi(dataCitirii)
  const ok = (citiri || []).filter(c => { const v = numar(c?.val); return v != null && v > 0 && v <= plafon })
  const inainte = c => { const z = zi(c.data); return !!z && (!d || z <= d) }
  const ultimele = sursa => ok.filter(c => c.sursa === sursa && inainte(c))
    .sort((a, b) => zi(b.data).localeCompare(zi(a.data)) || ((Number(b.id) || 0) - (Number(a.id) || 0)))
    .slice(0, 5)
  const pool = [...ultimele('fisa'), ...ultimele('alimentare')]
    .sort((a, b) => Number(a.val) - Number(b.val) || zi(a.data).localeCompare(zi(b.data)))
  if (pool.length) {
    const m = pool[Math.floor((pool.length - 1) / 2)]
    return { val: Number(m.val), sursa: m.sursa, data: zi(m.data), id: m.id ?? null }
  }
  const man = ok.find(c => c.sursa === 'manual')
  return man ? { val: Number(man.val), sursa: 'manual', data: null, id: null } : null
}

// Verificarea unei singure citiri. ref = număr sau { val, sursa, data, id }. Întoarce mesajul sau null.
// Cu ref număr (fișele de service) textele sunt cele vechi din ServiceTab, neschimbate.
export function verificaCitire(eticheta, val, ref, prag, dataCitirii = null) {
  const v = numar(val)
  if (v == null) return null
  const u = prag.unit
  if (v > prag.plafon) return `${eticheta}: ${fmtNr(v)} ${u} — valoare imposibilă (peste ${fmtNr(prag.plafon)} ${u}); citire de pe un contor defect?`
  const r = ref == null ? null : (typeof ref === 'object' ? ref : { val: ref })
  const rv = numar(r?.val)
  if (!rv) return null   // fără referință nu putem judeca saltul
  const din = r.sursa ? `, din ${descrieSursa(r)}` : ''
  if (v > rv + prag.salt) return `${eticheta}: ${fmtNr(v)} ${u} — cu ${fmtNr(Math.round(v - rv))} ${u} peste ultima valoare cunoscută (${fmtNr(rv)}${din})`
  if (v < rv - prag.regres) return `${eticheta}: ${fmtNr(v)} ${u} — SUB ultima valoare cunoscută (${fmtNr(rv)}${din}); contorul a fost înlocuit?`
  // Creștere imposibilă în timpul scurs de la referință (doar când știm ambele date)
  const d0 = zi(r.data), d1 = zi(dataCitirii)
  if (d0 && d1 && d1 >= d0 && prag.maxPeZi) {
    const zile = zileIntre(d0, d1) + 1
    if (v - rv > zile * prag.maxPeZi) return `${eticheta}: ${fmtNr(v)} ${u} — cu ${fmtNr(Math.round(v - rv))} ${u} peste ${fmtNr(rv)}${din}: imposibil în ${zile} ${zile === 1 ? 'zi' : 'zile'} (cel mult ~${fmtNr(zile * prag.maxPeZi)} ${u})`
  }
  return null
}

// Alimentarea { km_la_alimentare, ore_la_alimentare, data_alimentare } față de citiri = { km: [...], ore: [...] }.
export function verificaCitiriAlimentare(alim, citiri) {
  const out = []
  for (const [tip, camp, eticheta] of [['km', 'km_la_alimentare', 'Km la alimentare'], ['ore', 'ore_la_alimentare', 'Ore bord la alimentare']]) {
    if (numar(alim?.[camp]) == null) continue
    const prag = PRAG_CITIRI[tip]
    const ref = referintaIndependenta(citiri?.[tip], alim.data_alimentare, prag.plafon)
    const m = verificaCitire(eticheta, alim[camp], ref, prag, alim.data_alimentare)
    if (m) out.push(m)
  }
  return out
}

// Ce sursă ține valoarea afișată sus: candidatul egal cu valoarea (ordinea dată de apelant:
// alimentare, fișă, telemetrie, manual — manualul ultimul, pentru că poate fi copiat automat din
// celelalte); dacă niciunul nu e egal, cel mai mare, marcat exact:false.
export function sursaValoriiMari(valoare, candidati) {
  const v = numar(valoare)
  const ok = (candidati || []).filter(c => c && numar(c.val) != null)
  if (v == null || !ok.length) return null
  const egal = ok.find(c => Math.abs(Number(c.val) - v) < 0.5)
  if (egal) return { ...egal, exact: true }
  return { ...ok.reduce((a, b) => (Number(b.val) > Number(a.val) ? b : a)), exact: false }
}

// TKT-2026-0380 (c) „softul nu ne lasă să modificăm km”: ajustarea manuală (fișa activului sau
// fișa de service) scrie DOAR valoarea de pe activ, iar afișarea = maximul tuturor surselor. Dacă o
// alimentare / fișă / telemetrie are o cifră mai mare, valoarea afișată nu scade.
// Întoarce sursa (nu cea manuală) cu cea mai mare citire peste valoarea nouă, sau null.
export function sursaCareTineSus(valoareNoua, candidati) {
  const v = numar(valoareNoua)
  if (v == null) return null
  const peste = (candidati || []).filter(c => c && c.sursa !== 'manual' && numar(c.val) != null && Number(c.val) > v)
  if (!peste.length) return null
  return peste.reduce((a, b) => (Number(b.val) > Number(a.val) ? b : a))
}

// probleme = [{ tip: 'km' | 'ore', nou, sursa: { val, sursa, data, id } }]
export function textAjustareTinutaSus(probleme) {
  const linii = probleme.map(p => {
    const u = PRAG_CITIRI[p.tip]?.unit || ''
    return `• ${p.tip === 'km' ? 'Km' : 'Ore'}: scrii ${fmtNr(p.nou)} ${u}, dar ${descrieSursa(p.sursa)} are ${fmtNr(p.sursa.val)} ${u}.`
  })
  const tel = probleme.some(p => p.sursa?.sursa === 'telemetrie')
  return '⚠️ Ajustarea se salvează, dar valoarea afișată NU va scădea:\n\n' + linii.join('\n') +
    '\n\nValoarea afișată e cea mai mare citire din toate sursele (alimentări, fișe de service, telemetrie, valoarea de pe activ).' +
    ' Ca să scadă, corectează rândul de mai sus (alimentarea în Logistică → Alimentări, fișa în Service).' +
    (tel ? ' Telemetria GPS nu se corectează din ecran: cere corectarea coordonatorului.' : '') +
    '\n\nSalvez ajustarea oricum?'
}

// Pasul dinaintea ajustării manuale. valori = { km, ore } (null = neschimbat).
// true = se poate salva (nimic nu ține valoarea sus sau omul a confirmat); false = renunță.
export async function confirmaAjustareManuala(client, activId, valori, { confirma = m => window.confirm(m) } = {}) {
  const tipuri = ['km', 'ore'].filter(t => numar(valori?.[t]) != null)
  if (!tipuri.length || activId == null) return true
  let surse
  try {
    surse = await incarcaSurseMaxime(client, activId)
  } catch (e) {
    surse = { km: [], ore: [], erori: [e?.message || String(e)] }
  }
  const probleme = tipuri.map(t => ({ tip: t, nou: Number(valori[t]), sursa: sursaCareTineSus(valori[t], surse[t]) })).filter(p => p.sursa)
  if (probleme.length) return confirma(textAjustareTinutaSus(probleme))
  // L18: dacă o sursă nu s-a putut citi, nu spunem „totul e bine”
  if (surse.erori?.length) return confirma(`⚠️ Nu am putut verifica dacă altă citire ține valoarea afișată sus (${surse.erori.join('; ')}).\n\nSalvez ajustarea oricum?`)
  return true
}

// Textul pentru confirmare la salvare / import. probleme = [{ eticheta, mesaje: [] }].
export function textConfirmareCitiri(probleme, max = 12) {
  const linii = probleme.slice(0, max).map(p => `• ${p.eticheta ? p.eticheta + ' — ' : ''}${p.mesaje.join('\n   ')}`)
  const rest = probleme.length > max ? `\n… și încă ${probleme.length - max} ${probleme.length - max === 1 ? 'rând' : 'rânduri'}` : ''
  return '⚠️ Citiri de bord neobișnuite:\n\n' + linii.join('\n\n') + rest +
    '\n\nO cifră greșită aici strică permanent kilometrajul / orele afișate și alertele de service pentru utilaj.' +
    '\n\nVerifică cifra pe bon / la bord. Salvez oricum?'
}

// ─── Citiri din BD (client injectat = supabase; testabil fără rețea) ─────────────────────────
const bucati = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// Citirile de referință ale activelor: { [activId]: { km: [...], ore: [...] } }.
// excludeAlimIds = rândurile verificate (la editare nu se compară cu ele însele);
// deLa = 'AAAA-LL-ZZ' opțional, limitează istoricul alimentărilor (importuri mari).
// Erorile se aruncă (L18: apelantul spune „nu am putut verifica”, nu „totul e bine”).
export async function incarcaCitiriActive(client, activIds, { excludeAlimIds = [], deLa = null } = {}) {
  const ids = [...new Set((activIds || []).filter(x => x != null && x !== '').map(Number))].filter(Number.isFinite)
  const rez = new Map(ids.map(id => [id, { km: [], ore: [] }]))
  const exclude = new Set((excludeAlimIds || []).map(Number))
  for (const grup of bucati(ids, 100)) {
    const [fise, alim, active] = await Promise.all([
      paginareKeyset((ultim, pas) => {
        let q = client.from('logistica_service_fise')
          .select('id, activ_id, data_fisei, km_intrare, km_iesire, ore_intrare, ore_iesire')
          .in('activ_id', grup)
        if (ultim != null) q = q.gt('id', ultim)
        return q.order('id', { ascending: true }).limit(pas)
      }),
      paginareKeyset((ultim, pas) => {
        let q = client.from('logistica_alimentari')
          .select('id, active_id, data_alimentare, km_la_alimentare, ore_la_alimentare')
          .in('active_id', grup)
          .or('km_la_alimentare.not.is.null,ore_la_alimentare.not.is.null')
        if (deLa) q = q.gte('data_alimentare', deLa)
        if (ultim != null) q = q.gt('id', ultim)
        return q.order('id', { ascending: true }).limit(pas)
      }),
      client.from('logistica_active').select('id, km_actuali, ore_functionare_actuale').in('id', grup)
        .then(({ data, error }) => { if (error) throw error; return data || [] }),
    ])
    for (const f of fise) {
      const r = rez.get(Number(f.activ_id)); if (!r) continue
      for (const [tip, a, b] of [['km', 'km_intrare', 'km_iesire'], ['ore', 'ore_intrare', 'ore_iesire']]) {
        const v = Math.max(numar(f[a]) ?? -Infinity, numar(f[b]) ?? -Infinity)
        if (Number.isFinite(v)) r[tip].push({ val: v, data: f.data_fisei, sursa: 'fisa', id: f.id })
      }
    }
    for (const a of alim) {
      if (exclude.has(Number(a.id))) continue
      const r = rez.get(Number(a.active_id)); if (!r) continue
      if (numar(a.km_la_alimentare) != null) r.km.push({ val: Number(a.km_la_alimentare), data: a.data_alimentare, sursa: 'alimentare', id: a.id })
      if (numar(a.ore_la_alimentare) != null) r.ore.push({ val: Number(a.ore_la_alimentare), data: a.data_alimentare, sursa: 'alimentare', id: a.id })
    }
    for (const a of active) {
      const r = rez.get(Number(a.id)); if (!r) continue
      if (numar(a.km_actuali) != null) r.km.push({ val: Number(a.km_actuali), data: null, sursa: 'manual', id: null })
      if (numar(a.ore_functionare_actuale) != null) r.ore.push({ val: Number(a.ore_functionare_actuale), data: null, sursa: 'manual', id: null })
    }
  }
  return rez
}

// Pasul de verificare înaintea scrierii alimentărilor (formular, editare, import).
// randuri = [{ active_id, data_alimentare, km_la_alimentare, ore_la_alimentare, eticheta? }].
// true = se poate scrie (nimic suspect sau omul a confirmat); false = omul a renunțat.
export async function confirmaCitiriAlimentari(client, randuri, { excludeAlimIds = [], deLa = null, confirma = m => window.confirm(m) } = {}) {
  const deVerificat = (randuri || []).filter(r => r && r.active_id != null && (numar(r.km_la_alimentare) != null || numar(r.ore_la_alimentare) != null))
  if (!deVerificat.length) return true
  let citiri
  try {
    citiri = await incarcaCitiriActive(client, deVerificat.map(r => r.active_id), { excludeAlimIds, deLa })
  } catch (e) {
    return confirma(`⚠️ Nu am putut verifica citirile de bord (km / ore) față de istoric: ${e?.message || e}\n\nSalvez fără verificare?`)
  }
  const probleme = []
  for (const r of deVerificat) {
    const mesaje = verificaCitiriAlimentare(r, citiri.get(Number(r.active_id)))
    if (mesaje.length) probleme.push({ eticheta: r.eticheta || '', mesaje })
  }
  return probleme.length ? confirma(textConfirmareCitiri(probleme)) : true
}

// Maximul fiecărei surse pentru un activ (pentru „de unde vine valoarea mare”).
// Întoarce { km: [cand], ore: [cand], erori: [] }; o sursă care nu s-a putut citi apare în erori.
export async function incarcaSurseMaxime(client, activId) {
  const id = Number(activId)
  const out = { km: [], ore: [], erori: [] }
  if (!Number.isFinite(id)) return out
  const max = (col) => client.from('logistica_alimentari').select(`id, data_alimentare, ${col}`)
    .eq('active_id', id).not(col, 'is', null).order(col, { ascending: false }).order('id', { ascending: false }).limit(1)
  const [aKm, aOre, fise, tel, act] = await Promise.all([
    max('km_la_alimentare'), max('ore_la_alimentare'),
    client.from('logistica_service_fise').select('id, data_fisei, km_intrare, km_iesire, ore_intrare, ore_iesire').eq('activ_id', id),
    client.from('logistica_telemetrie_zilnica').select('data, km_sfarsit_zi').eq('asset_id', id)
      .not('km_sfarsit_zi', 'is', null).order('km_sfarsit_zi', { ascending: false }).limit(1),
    client.from('logistica_active').select('km_actuali, ore_functionare_actuale').eq('id', id).maybeSingle(),
  ].map(p => Promise.resolve(p).catch(e => ({ data: null, error: e }))))
  const err = (r, nume) => { if (r?.error) { out.erori.push(`${nume}: ${r.error.message || r.error}`); return true } return false }
  if (!err(aKm, 'alimentări') && aKm.data?.[0]) out.km.push({ val: Number(aKm.data[0].km_la_alimentare), sursa: 'alimentare', data: aKm.data[0].data_alimentare, id: aKm.data[0].id })
  if (!err(aOre, 'alimentări (ore)') && aOre.data?.[0]) out.ore.push({ val: Number(aOre.data[0].ore_la_alimentare), sursa: 'alimentare', data: aOre.data[0].data_alimentare, id: aOre.data[0].id })
  if (!err(fise, 'fișe de service')) {
    for (const [tip, a, b] of [['km', 'km_intrare', 'km_iesire'], ['ore', 'ore_intrare', 'ore_iesire']]) {
      let best = null
      for (const f of fise.data || []) {
        const v = Math.max(numar(f[a]) ?? -Infinity, numar(f[b]) ?? -Infinity)
        if (Number.isFinite(v) && (!best || v > best.val)) best = { val: v, sursa: 'fisa', data: f.data_fisei, id: f.id }
      }
      if (best) out[tip].push(best)
    }
  }
  if (!err(tel, 'telemetrie') && tel.data?.[0]) out.km.push({ val: Number(tel.data[0].km_sfarsit_zi), sursa: 'telemetrie', data: tel.data[0].data, id: null })
  if (!err(act, 'activ') && act.data) {
    if (numar(act.data.km_actuali) != null) out.km.push({ val: Number(act.data.km_actuali), sursa: 'manual', data: null, id: null })
    if (numar(act.data.ore_functionare_actuale) != null) out.ore.push({ val: Number(act.data.ore_functionare_actuale), sursa: 'manual', data: null, id: null })
  }
  return out
}
