import { useState } from 'react';
import type { Evenement, FicheDetail } from '../api.js';
import { decoderEntites, type ActionRelance } from '../aideRelance.js';

const TYPES: Record<Evenement['type'], string> = {
  note: 'Note',
  appel: 'Appel',
  email: 'Mail',
  reunion: 'Réunion',
  compte_rendu: 'Compte rendu',
  activite: 'Activité faite',
  etape: 'Étape',
};
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const MAX_VISIBLE = 6;

// Les champs d'une fiche arrivent en JSON libre : seules les chaînes sont affichées.
const enTexte = (v: unknown) => (typeof v === 'string' ? v : '');

// Tout ce qui s'est passé avec le contact, hors les deux mails mis en avant au-dessus : notes,
// appels, rendez-vous, étapes, activités faites et mails plus anciens.
export function Chronologie({ evenements }: { evenements: Evenement[] }) {
  const [tout, setTout] = useState(false);
  if (evenements.length === 0) return null;
  const visibles = tout ? evenements : evenements.slice(0, MAX_VISIBLE);
  return (
    <div className="aide-chrono">
      <p className="aide-sous-titre">Autres échanges et événements</p>
      <ul>
        {visibles.map((e) => {
          const texte = decoderEntites(e.mail?.corps ?? e.texte ?? '').trim();
          const titre = e.mail?.objet ?? e.titre ?? TYPES[e.type];
          const entete = (
            <>
              <span className="muted">{jour(e.at)}</span>{' '}
              <span className="badge">
                {e.type === 'email' && e.mail?.sens === 'recu' ? 'Reçu' : TYPES[e.type]}
              </span>{' '}
              {titre}
            </>
          );
          return (
            <li key={e.id}>
              {texte ? (
                <details>
                  <summary>{entete}</summary>
                  <pre>{texte.slice(0, 1500)}</pre>
                </details>
              ) : (
                <div className="aide-chrono-ligne">{entete}</div>
              )}
            </li>
          );
        })}
      </ul>
      {evenements.length > MAX_VISIBLE && (
        <button className="btn sm ghost" type="button" onClick={() => setTout(!tout)}>
          {tout ? 'Réduire' : `Tout voir (${evenements.length})`}
        </button>
      )}
    </div>
  );
}

// Les faits utiles avant de décider : à qui l'on parle, comment le joindre, où en est l'affaire,
// ce qui est déjà prévu, et les diagnostics ou tests déjà faits avec lui.
export function Faits({
  action,
  email,
  telephone,
  contact,
  cible,
}: {
  action: ActionRelance;
  email: string | null;
  telephone: string | null;
  contact: FicheDetail | null;
  cible: FicheDetail | null;
}) {
  const fonction = enTexte(contact?.fiche.fonction);
  const maintenant = Date.now();
  const sources = [contact, cible].filter((f): f is FicheDetail => !!f);
  const aVenir = [...new Map(sources.flatMap((f) => f.aVenir).map((t) => [t.id, t])).values()];
  const rendezVous = [
    ...new Map(
      sources
        .flatMap((f) => f.rendezVous)
        .filter((r) => r.debut && Date.parse(r.debut) >= maintenant)
        .map((r) => [r.id, r]),
    ).values(),
  ];
  const diagnostics = [
    ...new Map(sources.flatMap((f) => f.diagnostics ?? []).map((d) => [d.id, d])).values(),
  ];
  const tests = [
    ...new Map(sources.flatMap((f) => f.testsVma ?? []).map((t) => [t.id, t])).values(),
  ];
  return (
    <dl className="aide-faits">
      {action.contact && (
        <>
          <dt>Contact</dt>
          <dd>{[action.contact, fonction].filter(Boolean).join(' · ')}</dd>
        </>
      )}
      <dt>Joindre</dt>
      <dd>
        {email ?? <span className="muted">pas d'adresse mail</span>} ·{' '}
        {telephone ?? <span className="muted">pas de numéro</span>}
      </dd>
      {(action.etape || action.montant !== null) && (
        <>
          <dt>Affaire</dt>
          <dd>
            {[
              action.etape,
              action.montant !== null ? `${action.montant.toLocaleString('fr-FR')} €` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </dd>
        </>
      )}
      {(aVenir.length > 0 || rendezVous.length > 0) && (
        <>
          <dt>Déjà prévu</dt>
          <dd>
            <ul>
              {rendezVous.map((r) => (
                <li key={r.id}>
                  Rendez-vous le {jour(r.debut as string)} : {r.titre}
                </li>
              ))}
              {aVenir.map((t) => (
                <li key={t.id}>
                  {t.titre}
                  {t.echeance ? ` (${jour(t.echeance)})` : ''}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {(diagnostics.length > 0 || tests.length > 0) && (
        <>
          <dt>Déjà fait</dt>
          <dd>
            <ul>
              {diagnostics.map((d) => (
                <li key={d.id}>
                  Diagnostic : {d.nom}
                  {d.statut ? ` (${d.statut})` : ''}
                </li>
              ))}
              {tests.map((t) => (
                <li key={t.id}>
                  Test de VMA : {t.nom}
                  {t.date ? ` (${jour(t.date)})` : ''}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
}
