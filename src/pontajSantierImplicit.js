// Șantierul implicit al angajatului în pontaj (TKT-2026-0360, decizia owner-ului 13.11.2026): implicit rămâne șantierul din ziua precedentă.
//
// Regula (o singură definiție, folosită și la afișare și la salvare):
//   1. rândul ZILEI (pontaj_records pe ziua aleasă) cu șantier = alegerea făcută deja (manual sau salvată) — are prioritate;
//   2. altfel, ultimul șantier pe care angajatul a fost pontat EFECTIV: cea mai recentă zi ANTERIOARĂ cu rând în pontaj_records care are
//      șantier și e zi de lucru (are oră de intrare, sau nu e marcată cu o normă de absență: CO / CM / BO / LL ...);
//   3. altfel (niciun pontaj anterior), șantierul din fișa angajatului (employees.site_id);
//   4. altfel, niciunul („⚠ Nealocate”, ca azi).
// Cazurile cerute în raport:
//   * două șantiere în aceeași zi: pontaj_records are UNIQUE (employee_id, date), deci un singur rând pe zi; dacă ar apărea totuși două,
//     câștigă cel cu id-ul mai mare (ultimul scris) — ordinea (date desc, id desc) e și ordinea interogării;
//   * zile libere / concediu între timp: rândurile de absență (normă fără oră de intrare) se sar, ca și zilele fără rând (weekend, sărbători):
//     contează ultima zi LUCRATĂ, nu ultima zi din calendar; concediul scris în avans (cu șantierul din fișă) nu „resetează” șantierul;
//   * prima zi a lunii: căutarea nu e limitată la lună — se ia ultima zi lucrată din luna (sau lunile) anterioare;
//   * eroare la citire ≠ „fără pontaj anterior”: funcția de încărcare aruncă, iar ecranul spune explicit că folosește fișa (L18).
// Citirea e EXACTĂ și paginată (L23): fără fereastră de zile și fără limita tăcută de 1000 de rânduri a serverului (max-rows).

// zi lucrată cu șantier: are șantier și (oră de intrare SAU nicio normă de absență)
export const esteZiLucrataCuSantier = (r) =>
  !!r && r.site_id != null && (r.check_in != null || r.norma == null || r.norma === '')

// ordinea „mai recent întâi”: data desc, apoi id desc
const maiRecent = (a, b) => (a.date !== b.date ? (a.date > b.date ? -1 : 1) : (Number(b.id) - Number(a.id)))

// din rânduri (orice ordine) → Map(employee_id → { site_id, date }) cu ultima zi lucrată STRICT înainte de `zi` ('YYYY-MM-DD')
export function ultimulSantierDinRanduri(randuri, zi) {
  const m = new Map()
  const bune = (randuri || []).filter(r => r && typeof r.date === 'string' && r.date < zi && esteZiLucrataCuSantier(r)).sort(maiRecent)
  for (const r of bune) if (!m.has(r.employee_id)) m.set(r.employee_id, { site_id: r.site_id, date: r.date })
  return m
}

// regula 1–4. rec = rândul zilei (sau null), ultim = { site_id, date } (sau undefined), emp = fișa
export function santierImplicit({ rec, ultim, emp }) {
  if (rec && rec.site_id != null) return { site_id: rec.site_id, sursa: 'zi', data: null }
  if (ultim && ultim.site_id != null) return { site_id: ultim.site_id, sursa: 'precedent', data: ultim.date }
  if (emp && emp.site_id != null) return { site_id: emp.site_id, sursa: 'fisa', data: null }
  return { site_id: null, sursa: null, data: null }
}

// Citirea din BD: pentru fiecare angajat, ultima zi lucrată cu șantier înainte de `zi`.
// Pe bucăți de id-uri (URL-ul lui .in() rămâne scurt); în fiecare bucată, aceeași interogare ordonată (date desc, id desc) se repetă DOAR
// pentru angajații încă nerezolvați: primul rând al unui angajat într-o pagină e chiar ultima lui zi (rândurile lui mai noi ar fi apărut
// înaintea tăieturii), deci fiecare pagină nevidă rezolvă cel puțin un angajat; se oprește la pagina GOALĂ sau când toți sunt rezolvați
// (nu la „pagină mai scurtă decât pasul”: serverul poate tăia la mai puțin). Un răspuns care nu respectă filtrul / ordinea = eroare, nu buclă.
export async function incarcaUltimulSantier(sb, ids, zi, { pas = 1000, bucata = 100 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(zi))) throw new Error('ziua pontajului e invalidă')
  const rez = new Map()
  const toate = [...new Set((ids || []).filter(x => x != null))]
  for (let i = 0; i < toate.length; i += bucata) {
    const ramase = new Set(toate.slice(i, i + bucata))
    for (let pagina = 0; ramase.size > 0; pagina++) {
      if (pagina > bucata + 1) throw new Error('citirea ultimului șantier nu se termină (răspuns neașteptat)')
      const { data, error } = await sb.from('pontaj_records')
        .select('id,employee_id,date,site_id,check_in,norma')
        .in('employee_id', [...ramase])
        .lt('date', zi)
        .not('site_id', 'is', null)
        .or('check_in.not.is.null,norma.is.null')
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(pas)
      if (error) throw new Error('citirea ultimului șantier pontat: ' + (error.message || 'eroare'))
      if (!Array.isArray(data)) throw new Error('citirea ultimului șantier pontat: răspuns fără rânduri')
      if (data.length === 0) break
      let rezolvati = 0
      for (let k = 0; k < data.length; k++) {
        const r = data[k]
        if (k > 0 && maiRecent(data[k - 1], r) > 0) throw new Error('citirea ultimului șantier pontat: rânduri în altă ordine decât cea cerută')
        if (!(typeof r.date === 'string' && r.date < zi) || !esteZiLucrataCuSantier(r)) throw new Error('citirea ultimului șantier pontat: rând în afara filtrului')
        if (ramase.has(r.employee_id)) { rez.set(r.employee_id, { site_id: r.site_id, date: r.date }); ramase.delete(r.employee_id); rezolvati++ }
      }
      if (rezolvati === 0) throw new Error('citirea ultimului șantier pontat: pagină fără angajații ceruți')
    }
  }
  return rez
}
