// ════════════════════════════════════════════════════════════════
// ofertarePachet.js — manifestul pachetului aprobat (P0.5).
//
// Întrebarea la care răspunde: „ce BYTES a aprobat persoana X la momentul Y?"
// Răspunsul: lista fișierelor cu SHA-256, legată de semnătura porții și de versiunile
// capitolelor/graficului care le-au produs. Un manifest aprobat e imuabil (RLS: fără UPDATE/DELETE
// pe fișiere); o schimbare = versiune nouă de pachet.
//
// Partea pură (fără React, fără Supabase) stă aici ca să fie testabilă. Hash-ul se face în browser
// cu SubtleCrypto — nu are nevoie de server, iar bytes-ii hash-uiți sunt EXACT cei urcați.
// ════════════════════════════════════════════════════════════════

const HEX = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('')

/** SHA-256 hex al unui Blob / ArrayBuffer / Uint8Array. */
export async function sha256Hex(data) {
  const buf = data instanceof Blob ? await data.arrayBuffer()
    : data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data
  const subtle = (globalThis.crypto && globalThis.crypto.subtle)
  if (!subtle) throw new Error('SubtleCrypto indisponibil (pagina nu e servită pe HTTPS?)')
  return HEX(await subtle.digest('SHA-256', buf))
}

/**
 * Amprenta versiunilor din care s-a produs propunerea: „capitole@{12:v3,13:v1}". Ordonată după id,
 * ca două manifeste produse din aceleași versiuni să aibă aceeași amprentă, indiferent de ordinea
 * din UI. Fără ea, hash-ul spune CE s-a aprobat, dar nu DIN CE.
 */
export function sursaVersiuneCapitole(capitole) {
  const perechi = [...capitole].sort((a, b) => a.id - b.id).map(c => `${c.id}:v${c.versiune || 1}`)
  return `capitole@{${perechi.join(',')}}`
}

/** Calea în bucket-ul `ofertare`, stabilă și fără caractere problematice. */
export const caleFisierPachet = (licId, versiune, nume) =>
  `pt/${licId}/v${versiune}/${String(nume).replace(/[^A-Za-z0-9._-]+/g, '_')}`

/**
 * Rândurile de manifest pentru un pachet. `fisiere` = [{ rol, nume, mime, blob }], deja hash-uite
 * de apelant (hash-ul e async, aici rămânem puri). Validează ce ar refuza oricum BD-ul (CHECK pe
 * sha256), dar mai devreme și cu mesaj citibil.
 */
export function construiesteManifest({ licitatieId, versiune, fisiere, sursaVersiune }) {
  if (!licitatieId || !(versiune >= 1)) throw new Error('manifest: licitație/versiune lipsă')
  if (!fisiere?.length) throw new Error('manifest: niciun fișier — un pachet gol nu se aprobă')
  return fisiere.map(f => {
    if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) throw new Error(`manifest: hash lipsă/invalid la ${f.nume}`)
    return {
      rol: f.rol, nume: f.nume, mime: f.mime || null, size_bytes: f.size ?? null,
      sha256: f.sha256, fisier_path: caleFisierPachet(licitatieId, versiune, f.nume),
      sursa_versiune: sursaVersiune || null,
    }
  })
}

/** Două manifeste sunt „aceiași bytes" dacă au aceleași (rol, sha256). Ordinea nu contează. */
export function manifesteIdentice(a, b) {
  const cheie = m => [...m].map(f => `${f.rol}|${f.sha256}`).sort().join('\n')
  return cheie(a) === cheie(b)
}
