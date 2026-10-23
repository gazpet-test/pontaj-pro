// TKT-0353 / TKT-0354: logică pură, fără acces la Supabase sau la ceasul sistemului.
export function dataAziBucuresti(instant) {
  return instant.toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })
}

function numarValid(valoare) {
  return (typeof valoare === 'number' || typeof valoare === 'string') &&
    String(valoare).trim() !== '' && Number.isFinite(Number(valoare))
}

export function eroareTotalEchipament(total, asignat = 0) {
  if (!numarValid(total) || Number(total) < 0) {
    return 'Completează totalul în evidență cu un număr mai mare sau egal cu 0.'
  }
  if (!numarValid(asignat) || Number(asignat) < 0) {
    return 'Cantitatea asignată nu este validă. Reîncarcă lista de echipamente.'
  }
  if (Number(total) < Number(asignat)) {
    return `Totalul în evidență nu poate fi mai mic decât cantitatea asignată acum (${asignat}).`
  }
  return ''
}

export function eroareCantitatePredare(cantitate, disponibil) {
  if (!numarValid(cantitate) || Number(cantitate) <= 0) {
    return 'Completează cantitatea de predat cu un număr mai mare decât 0.'
  }
  if (!numarValid(disponibil) || Number(disponibil) < 0) {
    return 'Cantitatea disponibilă nu este validă. Reîncarcă lista de echipamente.'
  }
  if (Number(cantitate) > Number(disponibil)) {
    return `Cantitatea depășește disponibilul (${disponibil}).`
  }
  return ''
}

function dataCalendaristicaValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  const [an, luna, zi] = data.split('-').map(Number)
  if (an < 1 || luna < 1 || luna > 12 || zi < 1) return false
  const bisect = an % 4 === 0 && (an % 100 !== 0 || an % 400 === 0)
  const zile = [31, bisect ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return zi <= zile[luna - 1]
}

export function eroareDataPredare(data, azi) {
  if (!dataCalendaristicaValida(data)) return 'Completează o dată validă pentru predare.'
  if (!dataCalendaristicaValida(azi)) return 'Data curentă nu este validă.'
  if (data > azi) return 'Data predării nu poate fi în viitor.'
  return ''
}
