// Rândul de cantitate scris din traseul măsurat într-un desen CAD (DXF / DWG convertit) — folosit de cad-parse.js.
//
// R5 (Copilot 25.09.2026): „extras" ≠ aprobat, iar aprobat = status 'validat' = bifa unui OM în 📋 Cantități.
// Până la 25.09 rândul intra direct cu status 'validat' — o măsurătoare automată trecea drept cantitate aprobată
// în poarta graficului și în poarta propunerii. Caz real: lic. 3, rândul 9 („Traseu rețea măsurat din desenul
// proiectantului", 35.620,59 m), 'validat' cu created_at = updated_at = 28.08.2026 20:19:55, fără niciun om.
// Acum: rând nou => 'extras'.
//
// R5 runda 4 (verificator R3, MAJOR): „aprobat = validat" trebuie să acopere și cantitate_plansa — cu baza „planșe",
// graficul folosește tocmai coloana asta. Până acum rândul VALIDAT primea tăcut o măsurătoare nouă în cantitate_plansa
// („nu i se schimbă nici cifra" era adevărat doar pentru `cantitate`), deci o cifră automată neverificată trecea drept
// aprobată. Regula (aceeași ca în supabase/functions/ofertare-plansa-citeste/handler.ts, `cifraSchimbata`):
//   măsurătoarea nouă diferă de cifra pe care rândul o avea deja (cantitate_plansa; dacă n-are, cantitate; dacă n-are niciuna,
//   orice cifră e nouă) => status 'diferenta' și validarea se reface. Runda 1b (Copilot, închiderea R4/R5): „diferă” = ORICE
//   diferență de valoare canonică (`aceeasiValoare`, fără prag de 1 m); nota spune severitatea („diferență mică: +0,61 m, …”).
// Statusul pleacă în patch ORICARE ar fi statusul citit: între SELECT-ul din cad-parse.js și UPDATE un om poate valida
// rândul, iar UPDATE-ul nu are gardă pe status; cu 'diferenta' în patch, o validare dată pe cifra veche nu rămâne peste
// cifra nouă. Doar ACEEAȘI valoare re-măsurată (35.620,59 = 35.620,590) nu atinge statusul: validarea rămâne.
// Rândul validat își păstrează `cantitate` (cifra omului); cel nevalidat primește măsurătoarea și în `cantitate`.
// R5 (Copilot 26.09.2026, condiția 1): regula stă într-un singur loc — _cantitatiInvalidare.js (copie identică a
// src/ofertareCantitatiInvalidare.js); „cifra schimbată” = schimbarea RELEVANTĂ a cifrei din planșă efective.
// R5 runda 5 (verificator): (MAJOR 1) rândul INVALIDAT (nevalidat, cu prefixul regulii în notă) își păstrează prefixul când
// măsurătoarea îi rescrie nota; (MAJOR 2) pe rândul VALIDAT, regula se aplică față de valoarea APROBATĂ (`referinta`, din istoric —
// cad-parse.js o citește din ofertare_cantitati_istoric; lipsă = rândul de acum).
import { aplicaRegulaAprobare, DE_REVERIFICAT_CITIRE, descrieDiferenta, fmtRo, pastreazaInvalidarea, schimbariRelevante } from './_cantitatiInvalidare.js'
export const referintaCitire = r =>
  r?.cantitate_plansa != null ? Number(r.cantitate_plansa) : r?.cantitate != null ? Number(r.cantitate) : null
export const cifraSchimbata = (r, nou) =>
  nou != null && schimbariRelevante(r, { cantitate_plansa: Number(nou) }).relevante.some(x => x.camp === 'cantitate_plansa')
const fmt = fmtRo   // runda 1b: zecimal exact, ca în notele regulii (înainte toFixed + toLocaleString)
// runda 1b: severitatea (doar text) — „ (diferență mică: +0,61 m, sub 0,01 %)”; aceeași valoare / cifră lipsă => ''
const sev = (ref, nou) => { const d = descrieDiferenta(ref, nou); return d ? ` (${d})` : '' }

export function randCantitateCad(date, existent = null, referinta = null) {
  const r = randCantitateCadBrut(date, existent, referinta)
  if (r.op !== 'update') return r
  return { ...r, patch: aplicaRegulaAprobare(existent, pastreazaInvalidarea(existent, r.patch), referinta).patch }
}
function randCantitateCadBrut({ licitatieId, denumire, c, notaAnaliza }, existent = null, referinta = null) {
  const l3d = c.lungime_3d_m
  const nota = `Măsurat din desen: ${l3d.toLocaleString('ro-RO')} m în spațiu, ${c.lungime_2d_m.toLocaleString('ro-RO')} m în plan` +
    `${c.numar > 1 ? `, pe ${c.numar} trasee` : ''}. ${notaAnaliza || ''}`.trim()
  if (!existent) {
    return { op: 'insert', rand: { licitatie_id: licitatieId, denumire, cantitate: l3d, um: 'm', cantitate_plansa: l3d, status: 'extras', diferenta_nota: nota } }
  }
  // runda 1b: pe rândul VALIDAT, comparația și nota se fac față de valoarea APROBATĂ (`referinta`, din istoric), dacă există —
  // nota numește cifra aprobată, nu o stare intermediară; altfel față de rândul de acum
  const baza = existent.status === 'validat' && referinta ? referinta : existent
  const ref = referintaCitire(baza)
  const schimbat = cifraSchimbata(baza, l3d)   // pe validat, cu referință: față de valoarea aprobată (ca trigger-ul)
  const deUnde = baza.cantitate_plansa != null ? 'măsurătoarea anterioară' : 'cantitatea'
  if (existent.status === 'validat') {
    return { op: 'update', id: existent.id, patch: { cantitate_plansa: l3d,
      diferenta_nota: schimbat
        ? `Rândul era VALIDAT cu ${ref === null ? 'nicio cifră' : `${deUnde} ${fmt(ref)} m`}; noua măsurătoare diferă${sev(ref, l3d)} — ${DE_REVERIFICAT_CITIRE}validarea se reface. ` + nota
        : nota,
      ...(schimbat ? { status: 'diferenta' } : {}) } }
  }
  return { op: 'update', id: existent.id, patch: { cantitate: l3d, um: 'm', cantitate_plansa: l3d,
    diferenta_nota: schimbat && ref !== null ? `Măsurătoarea diferă de ${deUnde} ${fmt(ref)} m${sev(ref, l3d)}. ` + nota : nota,
    ...(schimbat ? { status: 'diferenta' } : {}) } }
}
