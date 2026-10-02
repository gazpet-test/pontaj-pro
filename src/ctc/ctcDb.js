// ════════════════════════════════════════════════════════════════
// ctcDb.js — operațiuni pe BD / Storage pentru modulul CTC (tabelele ctc_*, bucket ctc-documente).
// Fiecare funcție aruncă Error cu mesaj în română; UI-ul o prinde și afișează toast.
// ════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase.js'
import { imageToPdf } from '../CitesteOricePanel.jsx'
import { clonarePozitii, pozitiiPentruUnitate, paginiDinBytes, slugFisier, MAX_BYTES, esteProba } from './ctcUtil.js'

export const BUCKET_CTC = 'ctc-documente'
export const BUCKET_COMENZI = 'comenzi-furnizor'

const ok = (res, ctx) => { if (res.error) throw new Error(`${ctx}: ${res.error.message}`); return res.data }

async function insereazaInChunks(rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 200) {
    const data = ok(await supabase.from('ctc_documente_carte').insert(rows.slice(i, i + 200)).select(), 'Inserare poziții')
    out.push(...data)
  }
  return out
}

export async function pozitiiTemplate(templateId) {
  return ok(await supabase.from('ctc_template_pozitii').select('*').eq('template_id', templateId).order('ordine'), 'Citire template')
}

// Populează checklist-ul unei cărți din template (la creare sau când cartea a rămas fără poziții).
export async function populeazaCarte(carte) {
  if (!carte.template_id) throw new Error('Cartea nu are template.')
  const poz = await pozitiiTemplate(carte.template_id)
  if (!poz.length) throw new Error('Template-ul nu are poziții.')
  return insereazaInChunks(clonarePozitii(poz, carte.tronsoane || [], carte.id))
}

export async function creeazaCarte(campuri, tronsoane) {
  const carte = ok(await supabase.from('ctc_carti').insert({ ...campuri, tronsoane }).select().single(), 'Creare carte')
  try { await populeazaCarte(carte) } catch (e) {
    // cartea există, dar fără checklist: din detaliu se poate repopula
    const err = new Error('Cartea s-a creat, dar checklist-ul nu s-a populat: ' + e.message); err.carte = carte; throw err
  }
  return carte
}

// Adaugă o unitate nouă (tronson sau probă) unei cărți existente și clonează pozițiile repetabile pe ea.
export async function adaugaUnitate(carte, unitate) {
  const existente = carte.tronsoane || []
  if (existente.includes(unitate)) throw new Error('Există deja: ' + unitate)
  const idx = existente.filter(t => esteProba(t) === esteProba(unitate)).length
  const noi = [...existente, unitate]
  ok(await supabase.from('ctc_carti').update({ tronsoane: noi }).eq('id', carte.id), 'Salvare tronsoane')
  if (carte.template_id) {
    const poz = await pozitiiTemplate(carte.template_id)
    const rows = pozitiiPentruUnitate(poz, unitate, idx, carte.id)
    if (rows.length) await insereazaInChunks(rows)
  }
  return noi
}

export async function actualizeazaDoc(id, patch) {
  return ok(await supabase.from('ctc_documente_carte').update(patch).eq('id', id).select().single(), 'Salvare poziție')
}

export async function adaugaPozitie(carteId, baza, ordine) {
  return ok(await supabase.from('ctc_documente_carte').insert({
    carte_id: carteId, categorie: baza.categorie, denumire_document: baza.denumire_document,
    tronson: baza.tronson ?? null, obligatoriu: baza.obligatoriu ?? false, ordine, status: 'lipsa',
  }).select().single(), 'Adăugare poziție')
}

export async function stergePozitie(id) {
  ok(await supabase.from('ctc_documente_carte').delete().eq('id', id), 'Ștergere poziție')
}

const esteProprie = (d) => d.sursa === 'upload' && d.fisier_bucket === BUCKET_CTC && d.fisier_path

async function stergeObiectProprie(d) {
  if (!esteProprie(d)) return
  try { await supabase.storage.from(BUCKET_CTC).remove([d.fisier_path]) } catch (_) { /* best-effort */ }
}

// Încarcă un fișier pe o poziție. Imaginile se convertesc în PDF în browser (decizia „TOTUL PDF").
export async function incarcaFisier({ carte, doc, file, profile }) {
  let f = file
  if (/^image\//.test(f.type)) {
    f = await imageToPdf(f)
  }
  if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) throw new Error('Doar PDF sau imagine (se convertește automat).')
  if (f.size > MAX_BYTES) throw new Error(`Fișierul are ${(f.size / 1048576).toFixed(1)} MB; limita e 50 MB. Împarte-l în două poziții.`)
  let pagini = null
  try { pagini = paginiDinBytes(new Uint8Array(await f.arrayBuffer())) } catch (_) { pagini = null }
  const path = `carte-${carte.id}/${doc.id}_${Date.now()}_${slugFisier(f.name)}`
  const up = await supabase.storage.from(BUCKET_CTC).upload(path, f, { contentType: 'application/pdf', upsert: false })
  if (up.error) throw new Error('Upload: ' + up.error.message)
  try {
    const row = await actualizeazaDoc(doc.id, {
      sursa: 'upload', fisier_bucket: BUCKET_CTC, fisier_path: path, fisier_nume: f.name, fisier_size_bytes: f.size,
      cfd_id: null, nr_pagini: pagini ?? doc.nr_pagini ?? null,
      status: 'incarcat', verificat_de: null, verificat_la: null,
      uploadat_de: profile?.id || null, uploadat_la: new Date().toISOString(),
    })
    await stergeObiectProprie(doc)   // fișierul vechi propriu, dacă exista
    return { row, paginiDetectate: pagini }
  } catch (e) {
    await supabase.storage.from(BUCKET_CTC).remove([path]).catch(() => {})
    throw e
  }
}

// Atașează un document din arhiva comenzilor furnizor, prin referință (fără copiere de fișier).
export async function ataseazaDinArhiva({ doc, cfd, profile }) {
  const row = await actualizeazaDoc(doc.id, {
    sursa: 'arhiva_comenzi', fisier_bucket: BUCKET_COMENZI, fisier_path: cfd.fisier_path,
    fisier_nume: cfd.fisier_nume || cfd.fisier_path.split('/').pop(), fisier_size_bytes: null, cfd_id: cfd.id,
    status: 'incarcat', verificat_de: null, verificat_la: null,
    uploadat_de: profile?.id || null, uploadat_la: new Date().toISOString(),
  })
  await stergeObiectProprie(doc)
  return row
}

// Scoate fișierul de pe poziție (poziția rămâne, cu status „lipsă"). Doar fișierele proprii se șterg din Storage.
export async function scoateFisier(doc) {
  const row = await actualizeazaDoc(doc.id, {
    fisier_path: null, fisier_nume: null, fisier_size_bytes: null, cfd_id: null, sursa: 'upload', fisier_bucket: BUCKET_CTC,
    nr_pagini: null, nr_pagina_start: null, nr_pagina_end: null, status: 'lipsa', verificat_de: null, verificat_la: null,
    uploadat_de: null, uploadat_la: null,
  })
  await stergeObiectProprie(doc)
  return row
}

export async function urlSemnat(bucket, path, nume, download = false) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120, download ? { download: nume || true } : undefined)
  if (error || !data?.signedUrl) throw new Error('Nu pot deschide fișierul: ' + (error?.message || 'fără URL'))
  return data.signedUrl
}
