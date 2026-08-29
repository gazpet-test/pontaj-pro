// Scoate continutul real dintr-un fisier semnat electronic (.p7s — container CMS/PKCS#7).
//
// SEAP publica fiecare document semnat, iar continutul sta intr-un OCTET STRING ASN.1
// care, la fisierele mari, e FRAGMENTAT in bucati de cate ~64KB (codificare
// "constructed"). Fiecare bucata are propriul antet de cativa octeti.
//
// Decuparea naiva — "ia de la %PDF pana la ultimul %%EOF" — pastreaza antetele alea
// in mijlocul fisierului. Efectul, masurat pe documentatia Manastirea: din 27 de
// fisiere semnate, TOATE 27 ieseau alterate. PDF-urile mici tot se deschideau (cititorii
// trec peste octeti straini), dar plansele scanate se decodau doar pe primele randuri
// si restul iesea gri, iar fisierele .docx si .dwg nu se extrageau deloc, fiindca nu
// incep cu %PDF.
//
// Aici se parcurge structura ASN.1 si se lipesc fragmentele in ordine — singurul mod
// de a obtine fisierul asa cum l-a semnat emitentul.

// Citeste un antet ASN.1: intoarce tipul, lungimea si unde incepe continutul.
// Lungimea null = forma "nedefinita" (se termina la marcajul de sfarsit 00 00).
function antet(b, i) {
  const tip = b[i]
  i += 1
  let lung = b[i]
  i += 1
  if (lung === 0x80) return { tip, lung: null, start: i }
  if (lung & 0x80) {
    const n = lung & 0x7f
    lung = 0
    for (let k = 0; k < n; k++) lung = lung * 256 + b[i + k]
    i += n
  }
  return { tip, lung, start: i }
}

// Lipeste fragmentele unui OCTET STRING "constructed", inclusiv imbricate.
function lipesteFragmente(b, start, capat) {
  const bucati = []
  let i = start
  while (i < capat && i < b.length) {
    const a = antet(b, i)
    if (a.tip === 0x00) break                       // marcaj de sfarsit
    if (a.lung === null) {                          // fragment cu lungime nedefinita
      bucati.push(lipesteFragmente(b, a.start, capat))
      break
    }
    if (a.tip === 0x04) bucati.push(b.subarray(a.start, a.start + a.lung))
    else if (a.tip === 0x24) bucati.push(lipesteFragmente(b, a.start, a.start + a.lung))
    i = a.start + a.lung
  }
  return Buffer.concat(bucati)
}

// OID 1.2.840.113549.1.7.1 = "data", adica tipul continutului incapsulat.
const OID_DATA = Buffer.from('06092A864886F70D010701', 'hex')

/**
 * Intoarce { continut, forma } sau null daca nu arata a container semnat.
 * forma: 'primitive' (o singura bucata) sau 'constructed' (fragmentat).
 */
export function desfaP7s(buf) {
  const poz = buf.indexOf(OID_DATA)
  if (poz < 0) return null
  const dupaOid = antet(buf, poz + OID_DATA.length)
  if (dupaOid.tip !== 0xa0) return null              // asteptam [0] EXPLICIT
  const capat = dupaOid.lung === null ? buf.length : dupaOid.start + dupaOid.lung

  const c = antet(buf, dupaOid.start)
  if (c.tip === 0x04 && c.lung !== null) {
    return { continut: buf.subarray(c.start, c.start + c.lung), forma: 'primitive' }
  }
  if (c.tip === 0x24 || c.lung === null) {
    const sfarsit = c.lung === null ? capat : c.start + c.lung
    return { continut: lipesteFragmente(buf, c.start, sfarsit), forma: 'constructed' }
  }
  return null
}

/**
 * Pentru fisierele din arhivele SEAP: daca numele se termina in .p7s, scoate
 * continutul si taie extensia. Altfel intoarce fisierul neatins.
 * Daca desfacerea esueaza, pastreaza fisierul asa cum e — mai bine un fisier
 * cu antet in plus decat niciunul.
 */
export function continutSemnat(buf, nume) {
  if (!/\.p7s$/i.test(nume)) return { buf, nume, desfacut: false }
  const r = desfaP7s(buf)
  if (!r || !r.continut.length) return { buf, nume: nume.replace(/\.p7s$/i, ''), desfacut: false }
  return { buf: r.continut, nume: nume.replace(/\.p7s$/i, ''), desfacut: true, forma: r.forma }
}
