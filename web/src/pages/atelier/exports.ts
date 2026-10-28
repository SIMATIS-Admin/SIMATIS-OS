import { echeanceTrimestre, entonnoir } from './calcul.js';
import {
  CLES_ICP,
  CLES_PERSONA,
  ETAPES,
  NATURES,
  POIDS_TRIMESTRES,
  type EtatAtelier,
} from './etat.js';

export type ContexteExport = { entreprise: string };

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const eur = (n: number) => `${fmt(n)} €`;

// Feuille de route pour l'OS. Avec l'écran partagé actif, rien de ce qui est réservé à Marc n'en sort.
export function exportJson(etat: EtatAtelier, partage: boolean, ctx: ContexteExport): object {
  const f = entonnoir(etat.obj);
  const icp = etat.icps[etat.icp] ?? etat.icps[0];
  const objectifs: Record<string, unknown> = {
    ca_12_mois: Math.round(f.ca),
    scenario: etat.scenarios[etat.scen]?.name ?? '',
    panier_moyen: Math.round(f.panier),
    part_abonnement_pct: Math.round(f.part),
    ca_ponctuel: Math.round(f.caPonctuel),
    ca_recurrent: Math.round(f.caRecurrent),
    abonnement_mensuel: Math.round(f.abo),
    ventes: f.ventes,
    abonnes: f.abonnes,
    revenu_recurrent_mensuel_fin: Math.round(f.mrr),
    rendez_vous: f.rdv,
    contacts: f.contacts,
    valeurs_exemple: !!etat.obj.exemple,
  };
  const sortie: Record<string, unknown> = {
    schema: 'simatis-os/plan-action-brouillon',
    entreprise: ctx.entreprise,
    statut: 'brouillon',
    seance: etat.date,
    objectifs,
    offre_porteuse: etat.motors[etat.motor]?.name ?? '',
    cibles: {
      icps: etat.icps.map((x) => ({ code: x.code, nom: x.name, porte_entree: x.offer })),
      icp_travaille: icp?.code ?? '',
      pistes: etat.pistes.filter((p) => p.on).map((p) => p.name),
    },
    taches: etat.actions
      .filter((a) => a.on)
      .map((a) => ({
        titre: a.title,
        echeance: echeanceTrimestre(etat.date, a.q),
        priorite: `P${a.q + 1}`,
        bloc: a.bloc,
        responsable: a.owner,
        indicateur: a.metric,
      })),
  };
  if (!partage) {
    objectifs.commission_marc = Math.round(f.commission);
    objectifs.commission_recurrente_annuelle_fin = Math.round(f.commissionRecurrente);
    sortie.notes_marc = etat.notes.filter(Boolean);
  }
  return sortie;
}

const DIAG = { 'non-prevu': 'non prévu', 'a-faire': 'à réaliser', fait: 'réalisé' } as const;

// Fiche de cadrage pour le second cerveau (statut brouillon). Mêmes règles de confidentialité.
export function exportMarkdown(etat: EtatAtelier, partage: boolean, ctx: ContexteExport): string {
  const f = entonnoir(etat.obj);
  const L: string[] = [];
  const nature = (k: keyof typeof NATURES) => NATURES[k];
  L.push(
    '---',
    'type: Cadrage stratégique',
    `title: ${ctx.entreprise} — cadrage stratégique (atelier du ${etat.date})`,
    'status: draft',
    `date_updated: ${etat.date}`,
    `entreprise: ${ctx.entreprise}`,
    '---',
    '',
    `# ${ctx.entreprise} — cadrage stratégique`,
    '',
    `Produit par l’atelier stratégique le ${etat.date}. Brouillon : à relire avant tout passage en verified.`,
    '',
    '## 1. Entrées utilisées',
    '',
    `- Diagnostic d’endurance : ${DIAG[etat.diag]}${etat.diagNote ? ` — ${etat.diagNote}` : ''}`,
    `- Test de VMA : ${etat.vma === 'passe' ? 'passé' : 'à passer'}${etat.vmaNote ? ` — ${etat.vmaNote}` : ''}`,
    '',
    '## 2. Situation connue',
    '',
  );
  for (const x of etat.facts) {
    if (partage && x.prive) continue;
    L.push(`- **${x.k}** : ${x.v} _(${nature(x.tag)}${x.src ? `, ${x.src}` : ''})_`);
  }
  L.push('', '### SWOT', '');
  for (const q of etat.swot) {
    L.push(`**${q.t}**`);
    for (const it of q.items) if (it.v) L.push(`- ${it.v} _(${nature(it.tag)})_`);
    L.push('');
  }
  L.push(
    '## 3. Stratégie et modèle',
    '',
    `- Vision : ${etat.vision.annee ? `d’ici ${etat.vision.annee}, ` : ''}${etat.vision.phrase || 'à formuler'}`,
    `- Offre qui porte l’année : ${etat.motors[etat.motor]?.name ?? ''}`,
    '',
    '## 4. Objectifs',
    '',
    `- CA visé sur 12 mois : ${eur(f.ca)}`,
    `- Part en abonnement : ${Math.round(f.part)} % (${eur(f.caRecurrent)} récurrents, ${eur(f.caPonctuel)} ponctuels)`,
    `- Panier moyen (ponctuel) : ${eur(f.panier)}`,
    `- Ventes ponctuelles à signer : ${fmt(f.ventes)}`,
    `- Abonnement mensuel moyen : ${eur(f.abo)} ; nouveaux abonnés à signer : ${fmt(f.abonnes)} ; revenu mensuel récurrent en fin de période : ${eur(f.mrr)}`,
    `- Rendez-vous à obtenir : ${fmt(f.rdv)} ; contacts à atteindre : ${fmt(f.contacts)}`,
    `- Trajectoire : ${POIDS_TRIMESTRES.map((p, i) => `T${i + 1} ${eur((f.ca * p) / 100)}`).join(', ')}`,
  );
  if (!partage)
    L.push(
      `- Commission (${etat.obj.taux} %, même taux sur le récurrent tant que l’affaire court) : ${eur(f.commission)} sur 12 mois ; ${eur(f.commissionRecurrente)} par an sur les abonnements en cours en fin de période`,
    );
  L.push('', '## 5. Cibles', '');
  for (const c of etat.icps) {
    L.push(`### ${c.code}${c.name ? ` — ${c.name}` : ''}`, '', c.offer, '', '**ICP**');
    CLES_ICP.forEach((k, j) => L.push(`- ${k} : ${c.icp[j] || 'à compléter'}`));
    L.push('', '**Persona**');
    CLES_PERSONA.forEach((k, j) => L.push(`- ${k} : ${c.persona[j] || 'à compléter'}`));
    L.push('');
  }
  L.push('Pistes de ciblage retenues :');
  for (const p of etat.pistes.filter((x) => x.on))
    L.push(`- ${p.name}${p.note ? ` : ${p.note}` : ''}`);
  L.push('', '## 6. Feuille de route', '');
  for (let qi = 0; qi < 4; qi++) {
    const its = etat.actions.filter((a) => a.q === qi && a.on);
    L.push(`### Trimestre ${qi + 1} — échéance ${echeanceTrimestre(etat.date, qi)}`);
    if (!its.length) L.push('- (aucune action)');
    for (const a of its)
      L.push(`- [ ] ${a.title} — ${a.owner} — mesure : ${a.metric} _(${a.bloc})_`);
    L.push('');
  }
  if (!partage && etat.notes.some(Boolean)) {
    L.push('## Notes réservées', '');
    etat.notes.forEach((n, i) => {
      if (n) L.push(`- ${ETAPES[i]} : ${n}`);
    });
    L.push('');
  }
  L.push('## 7. Questions ouvertes', '');
  const ouvertes = etat.facts
    .filter((x) => x.tag === 'open' && !(partage && x.prive))
    .map((x) => `${x.k} : ${x.v}${x.src ? ` (${x.src})` : ''}`);
  for (const q of etat.swot)
    for (const it of q.items) if (it.tag === 'open' && it.v) ouvertes.push(`${q.t} : ${it.v}`);
  if (!ouvertes.length) L.push('- Aucune.');
  for (const o of ouvertes) L.push(`- ${o}`);
  return L.join('\n');
}
