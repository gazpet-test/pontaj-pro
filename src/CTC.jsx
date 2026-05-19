// ════════════════════════════════════════════════════════════════
// CTC.jsx — Modulul CTC - CĂRȚI TEHNICE (placeholder Faza 1)
// LIVE: 19.05.2026 (Etapa 15 Faza 1)
// Owner principal: Apostol Andrut (cont de creat la Faza 5)
// Next: Faza 5 (UI vizualizare + arhivare documente recepție de la Achiziții)
// ════════════════════════════════════════════════════════════════
import ModulePlaceholder from './ModulePlaceholder.jsx'

export default function CTCPage() {
  return (
    <ModulePlaceholder
      icon="📑"
      title="CTC — Cărți Tehnice"
      subtitle="Arhivă documente recepție · Conformitate · Inspecții"
      color="#BC8CFF"
      faza={5}
      etapa="15.5"
      owner="Apostol Andrut (cont nou la Faza 5)"
      statusBd={true}
      statusUi={false}
      features={[
        'Inbox documente primite automat de la Achiziții după recepție marfă',
        'Vizualizare PDF inline (Factură + DoC + Cert + Altele)',
        'Filtrare după tip document + comandă + șantier + dată',
        'Marcare „arhivat" cu observații per document',
        'Search full-text în documente (numele furnizorului, nr factură)',
        'Dashboard KPI: documente noi azi / săptămâna asta / arhivate / restante',
        'Export Excel cu lista documentelor arhivate per perioadă',
        'Link bidirecțional cu comanda originală + șantierul beneficiar',
      ]}
    />
  )
}
