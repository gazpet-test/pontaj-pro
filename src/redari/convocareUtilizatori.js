// PR3a: aceeași poartă pentru lot și documentul individual; lipsă/NULL = neaprobat.
export const esteUtilizator = calitate => ['utilizator', 'arendas'].includes(calitate)
export const MESAJ_UTILIZATOR_NEAPROBAT = 'utilizator - convocare neaprobata'
export const motivPoartaUtilizatori = (proiect, detinator) =>
  esteUtilizator(detinator?.calitate) && proiect?.convocare_utilizatori_aprobata !== true ? MESAJ_UTILIZATOR_NEAPROBAT : null

// PR3b: șablonul juridic este disponibil; poarta owner rămâne obligatorie.
export const motivConvocatorUtilizator = motivPoartaUtilizatori

/** CAS pe exact starea confirmată de owner; identitatea și proveniența sunt impuse de trigger. */
export async function salveazaPoartaUtilizatori(client, proiect, aprobata) {
  const { data, error } = await client.from('red_proiecte')
    .update({ convocare_utilizatori_aprobata: aprobata })
    .eq('id', proiect.id).eq('versiune', proiect.versiune)
    .eq('convocare_utilizatori_aprobata', proiect.convocare_utilizatori_aprobata).select('id')
  if (error) throw error
  if (data?.length !== 1) throw new Error('Proiect modificat între timp; reîncarcă și confirmă din nou.')
}
