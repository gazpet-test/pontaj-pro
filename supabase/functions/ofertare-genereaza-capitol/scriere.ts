// Scrierea capitolului generat + urma pentru cerințele neconfirmate (INTERDICȚIILE 3, 4, 5), separată de index.ts ca să fie
// testată cu BD simulată (scriere_test.ts).
// Fix 17.10.2026: în v2.3 urma se scria DUPĂ text, iar ramura de conflict / eroare citea `obsId` înaintea lui `let obsId`.
// Rezultatul era ReferenceError (TDZ), prins de catch-ul general ca „Eroare neasteptata”: mesajul de conflict (INTERDICȚIA 4) nu
// ajungea la om. În plus, dacă urma eșua, textul era deja scris, deși mesajul spunea „NU s-a salvat”. Acum ordinea e cea din
// comentariul INTERDICȚIEI 5: întâi urma, apoi textul. Urma eșuată → textul NU se scrie. Textul nescris (conflict / eroare) →
// urma se închide ('rezolvata' + rezolvat_la + raspuns, cum cere CHECK-ul tabelei), ca să nu rămână o observație despre un text
// inexistent; dacă închiderea eșuează, eroarea se loghează și pleacă în răspuns (urma_neinchisa), nu se înghite.
type Bd = { from: (t: string) => any }
export type Cerinta = { id: number; text_cerinta?: string | null }
export type UrmaNeinchisa = { obsId: number; eroare: string }
export type Rezultat =
  | { ok: true; obsId: number | null }
  | { ok: false; motiv: 'fara_urma' | 'eroare' | 'conflict'; mesaj: string; urma_neinchisa?: UrmaNeinchisa }

export async function amprenta(c: Cerinta): Promise<string> {
  // SHA-256 COMPLET (Copilot 24.09: identificarea exactă a intrării folosite; Web Crypto n-are MD5).
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(c.text_cerinta || '')))
  return `#${c.id}:sha256:${Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export async function scrieCapitolCuUrma(supabase: Bd, p: {
  capId: number; licitatieId: number; versiune: number; text: string; neconfirmate: Cerinta[]; actorUid: string | null
}): Promise<Rezultat> {
  // INTERDICȚIA 5, urma persistentă — ÎNAINTE de scrierea textului: observație DESCHISĂ pe capitol cu actorul care a
  // confirmat, id-urile cerințelor neconfirmate și amprenta (SHA-256) textelor trimise modelului. Dacă urma nu se poate scrie,
  // textul NU se salvează (refuz) — flagul cu_neconfirmate nu înlocuiește urma. Costul modelului e deja plătit; e prețul
  // corect față de un capitol „generat complet” fără urmă.
  let obsId: number | null = null
  if (p.neconfirmate.length) {
    const amprente = await Promise.all(p.neconfirmate.map(amprenta))
    const { data: obsRow, error: eObs } = await supabase.from('ofertare_pt_observatii').insert({
      licitatie_id: p.licitatieId, capitol_id: p.capId, cerut_de: p.actorUid, stare: 'deschisa',
      text: `⚠️ Generare v${p.versiune + 1} cu ${p.neconfirmate.length} cerințe NECONFIRMATE de om (fără E2), confirmată explicit de ${p.actorUid || 'service_role'}: ${amprente.join(', ')} (id:sha256 al textului trimis modelului). ` +
            'Răspunsurile la ele nu sunt bază verificată: confirmă cerințele în registru (sau exceptează-le) și regenerează / corectează textul înainte de depunere.',
    }).select('id').single()
    if (eObs || !obsRow?.id) return { ok: false, motiv: 'fara_urma', mesaj: 'Urma pentru cerințele neconfirmate nu s-a putut scrie (' + (eObs?.message || '?') + ') — textul generat NU s-a salvat.' }
    obsId = obsRow.id
  }

  // INTERDICȚIA 3 — sursa='ai' mereu. De aici încolo poarta ține capitolul blocat până când
  // un om îl deschide, îl citește și îl salvează (UI-ul pune atunci sursa='om').
  // INTERDICȚIA 4 (18.09.2026, găsită de o recenzie independentă) — scrierea e condiționată de
  // VERSIUNEA citită la început. Verificările de mai sus (lacăt, text de om) se fac înainte de
  // apelurile la model, care durează minute: dacă între timp un om a editat capitolul, scrierea
  // după `id` îi ștergea munca fără să se vadă. Acum, dacă versiunea s-a schimbat, nu scriem.
  const { data: scris, error: eUpd } = await supabase.from('ofertare_pt_capitole')
    .update({ continut: p.text, sursa: 'ai' }).eq('id', p.capId).eq('versiune', p.versiune)
    .select('id')
  let urma: UrmaNeinchisa | undefined
  if ((eUpd || !scris?.length) && obsId) {
    // urma nu descrie nicio versiune scrisă → o închidem, ca să nu rămână o observație despre un text inexistent.
    // CHECK ofertare_pt_observatii_inchidere_chk (20260913_ofertare_pt_revizii.sql): stare <> 'deschisa' cere rezolvat_la + raspuns
    // (Jakarinos r1 #756 P1: fără rezolvat_la UPDATE-ul era respins, eroarea ignorată, urma rămânea deschisă). Eroarea închiderii NU se
    // înghite: se loghează și pleacă în răspuns (urma_neinchisa), ca omul să știe că observația a rămas deschisă.
    const { error: eInch } = await supabase.from('ofertare_pt_observatii').update({
      stare: 'rezolvata', rezolvat_la: new Date().toISOString(), rezolvat_de: p.actorUid,
      raspuns: 'generarea nu s-a salvat (conflict de versiune / eroare la scriere)',
    }).eq('id', obsId)
    if (eInch) {
      console.error('[ofertare-genereaza-capitol] urma ' + obsId + ' nu s-a putut închide: ' + (eInch.message || eInch))
      urma = { obsId, eroare: String(eInch.message || eInch) }
    }
  }
  const nota = urma ? ` ATENȚIE: observația #${urma.obsId} (cerințe neconfirmate) a rămas DESCHISĂ — închiderea a eșuat (${urma.eroare}); închide-o manual.` : ''
  if (eUpd) return { ok: false, motiv: 'eroare', mesaj: 'textul nu s-a salvat: ' + eUpd.message + nota, ...(urma ? { urma_neinchisa: urma } : {}) }
  if (!scris?.length) return { ok: false, motiv: 'conflict', mesaj: 'Capitolul a fost modificat de altcineva cat timp se genera — textul generat NU s-a scris, ca sa nu se piarda munca lui. Reincarca si porneste din nou daca mai e nevoie.' + nota, ...(urma ? { urma_neinchisa: urma } : {}) }
  return { ok: true, obsId }
}
