// ════════════════════════════════════════════════════════════════
// Magazie.jsx — Modulul MAGAZIE (placeholder Faza 1)
// LIVE: 19.05.2026 (Etapa 15 Faza 1)
// Owner principal: Magazioner (cont de creat la Faza 6)
// Next: Faza 6 (UI tabletă magazioner +/- buttons + PV transport intern + semnătură MP)
// ════════════════════════════════════════════════════════════════
import ModulePlaceholder from './ModulePlaceholder.jsx'

export default function MagaziePage() {
  return (
    <ModulePlaceholder
      icon="📦"
      title="Magazie"
      subtitle="Stocuri sediu + per proiect · Transport intern · PV-uri"
      color="#FF7B72"
      faza={6}
      etapa="15.6"
      owner="Magazioner (cont nou la Faza 6)"
      statusBd={true}
      statusUi={false}
      features={[
        'UI mobil/tabletă pentru magazioner — listă stocuri sediu cu butoane +/-',
        'Scădere stoc → modal pentru destinație proiect → PV auto-generat PDF',
        'Transport intern: status pregătit → în_tranzit → livrat',
        'Notificare MP la livrare în șantier — semnătură electronică confirmare',
        'Vizualizare stoc per proiect (cine ce material are în șantier)',
        'Transferuri interne sediu ↔ proiect cu istoric complet',
        'Audit log toate intrările/ieșirile cu user + data + cantitate',
        'Dashboard KPI: stoc total / valoare estimată / mișcări săptămâna',
        'Integrare cu Achiziții: marfă recepționată merge direct în stoc',
      ]}
    />
  )
}
