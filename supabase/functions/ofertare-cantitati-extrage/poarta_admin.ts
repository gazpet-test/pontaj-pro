// Poarta ADMIN pentru modul `structurat` (decizia Răzvan 17.10.2026, „B”: pipeline-ul nu se blochează când owner-ul lipsește).
// Owner-ul și responsabilul licitației trec ca până acum (poarta.ts, neatinsă — copie identică în ofertare-plansa-citeste).
// Un ADMIN Ofertare (user_module_access module='ofertare', access_level='admin' — aceeași definiție ca fn_ofertare_cb_este_admin din
// 20261031d) pornește modul structurat DOAR dacă, simultan:
//   (1) cerere_id din corp e o cerere ACTIVĂ, nexpirată, a ACESTEI licitații, pe scopul cant_extragere;
//   (2) plafonul curent din ofertare_ai_buget pe (licitație, 'cant_extragere') e ≤ 5,00 USD (un plafon > 5 = pus de owner → adminul nu
//       pornește; owner / responsabil rămân ca acum);
//   (3) bugetul NU e blocat.
// Funcție pură (testată în poarta_admin_test.ts + poarta_test.ts). Citirile le face handler-ul: user_module_access cu service_role,
// cererea și bugetul cu clientul UTILIZATORULUI (20261031a revocă service_role pe ele; SELECT doar authenticated, cu fn_are_acces_ofertare).
// Întoarce null = trece; altfel motivul refuzului. Fail-closed: orice lipsă / valoare neinterpretabilă = refuz.
export const PLAFON_ADMIN_USD = 5

export type CererePoarta = { id: number | string; licitatie_id: number | string; scop: string; stare: string; valabil_pana: string } | null
export type BugetPoarta = { plafon_usd: number | string | null; blocat: boolean | null } | null
export type MotivAdmin = 'nu_e_admin' | 'cerere' | 'buget_lipsa' | 'plafon_peste_admin' | 'buget_blocat'

export function motivRefuzAdmin(p: {
  este_admin: boolean; licitatie_id: number; cerere_id: number
  cerere: CererePoarta; buget: BugetPoarta; acum: number
}): MotivAdmin | null {
  if (p.este_admin !== true) return 'nu_e_admin'
  const c = p.cerere
  const exp = c ? Date.parse(c.valabil_pana) : NaN
  if (!c || !p.cerere_id || Number(c.id) !== p.cerere_id || Number(c.licitatie_id) !== p.licitatie_id || c.scop !== 'cant_extragere'
    || c.stare !== 'activa' || !Number.isFinite(exp) || exp <= p.acum) return 'cerere'
  const b = p.buget
  if (!b || b.plafon_usd === null || b.plafon_usd === undefined || String(b.plafon_usd).trim() === '') return 'buget_lipsa'
  const plafon = Number(b.plafon_usd)
  if (!Number.isFinite(plafon)) return 'buget_lipsa'
  if (plafon > PLAFON_ADMIN_USD) return 'plafon_peste_admin'
  if (b.blocat !== false) return 'buget_blocat'
  return null
}

export const MESAJ_ADMIN: Record<MotivAdmin, string> = {
  nu_e_admin: 'Extragerea costă — o pornește doar ownerul sau responsabilul licitației.',
  cerere: 'Admin Ofertare: extragerea pornește doar pe o cerere de cheltuială activă a acestei licitații (scop cant_extragere), iar cerere_id trebuie să fie exact acea cerere.',
  buget_lipsa: 'Admin Ofertare: nu există plafon pentru cant_extragere pe această licitație.',
  plafon_peste_admin: 'Admin Ofertare: plafonul curent e peste 5,00 USD (pus de owner) — extragerea o pornește doar owner-ul sau responsabilul licitației.',
  buget_blocat: 'Admin Ofertare: bugetul e blocat — îl deblochează doar owner-ul.',
}
