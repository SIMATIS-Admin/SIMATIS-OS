import { useEffect, useState } from 'react';
import {
  fetchFiche,
  fetchRdv,
  type FicheDetail,
  type KindFiche,
  type RdvFiche,
} from '../../api.js';
import { Icon } from '../../icons.js';
import { Fenetre } from '../Fenetre.js';
import { OutilsConnexes, referencesLiees } from './OutilsConnexes.js';
import { Identite } from './commun.js';

export type ReferenceCommerciale = { kind: KindFiche | 'rdv'; id: string };
const texte = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
export const lienFiche = (slug: string, r: ReferenceCommerciale) =>
  `#/${slug}/fiche/${r.kind}/${encodeURIComponent(r.id)}`;
const date = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

export function ApercuCommercial({
  slug,
  reference,
  onFermer,
}: {
  slug: string;
  reference: ReferenceCommerciale;
  onFermer: () => void;
}) {
  const [pile, setPile] = useState<ReferenceCommerciale[]>([reference]);
  const courant = pile[pile.length - 1]!;
  const ouvrir = (r: ReferenceCommerciale) => setPile((p) => [...p, r]);
  useEffect(() => {
    window.addEventListener('hashchange', onFermer);
    return () => window.removeEventListener('hashchange', onFermer);
  }, [onFermer]);
  return (
    <Contenu
      key={`${courant.kind}-${courant.id}`}
      slug={slug}
      reference={courant}
      onFermer={onFermer}
      onOuvrir={ouvrir}
      retour={pile.length > 1 ? () => setPile((p) => p.slice(0, -1)) : undefined}
    />
  );
}

function Contenu({
  slug,
  reference,
  onFermer,
  onOuvrir,
  retour,
}: {
  slug: string;
  reference: ReferenceCommerciale;
  onFermer: () => void;
  onOuvrir: (r: ReferenceCommerciale) => void;
  retour?: () => void;
}) {
  const [data, setData] = useState<FicheDetail | null>(null);
  const [rdv, setRdv] = useState<RdvFiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    const echoue = (e: unknown) => {
      if (actif) setErreur(e instanceof Error ? e.message : String(e));
    };
    if (reference.kind === 'rdv')
      void fetchRdv(slug, reference.id).then((r) => {
        if (actif) setRdv(r);
      }, echoue);
    else
      void fetchFiche(slug, reference.kind, reference.id).then((r) => {
        if (actif) setData(r);
      }, echoue);
    return () => {
      actif = false;
    };
  }, [slug, reference]);
  const nom = rdv?.titre || texte(data?.fiche.nom) || texte(data?.fiche.titre) || 'Aperçu';
  const lien = (
    kind: ReferenceCommerciale['kind'],
    id: string,
    nom: string,
    sous?: string | null,
  ) => (
    <button key={`${kind}-${id}`} className="com-lien" onClick={() => onOuvrir({ kind, id })}>
      <Icon
        name={
          kind === 'contact'
            ? 'users'
            : kind === 'entreprise'
              ? 'building'
              : kind === 'rdv'
                ? 'cal'
                : 'kanban'
        }
      />
      <span>
        <strong>{nom}</strong>
        {sous && <small>{sous}</small>}
      </span>
      <Icon name="down" />
    </button>
  );
  return (
    <div className="com-apercu-voile">
      <Fenetre
        titre={nom}
        tiroir
        sousTitre="Aperçu rapide"
        onFermer={onFermer}
        pied={
          <a className="btn primary" href={lienFiche(slug, reference)} onClick={onFermer}>
            <Icon name="file" />
            Ouvrir la fiche complète
          </a>
        }
      >
        <div className="com-apercu">
          {retour && (
            <button className="btn ghost sm" onClick={retour}>
              ‹ Fiche précédente
            </button>
          )}
          {erreur && <p role="alert">{erreur}</p>}
          {!data && !rdv && !erreur && <p role="status">Chargement de la fiche…</p>}
          {data && (
            <>
              <Identite
                nom={nom}
                detail={texte(data.fiche.fonction) || texte(data.fiche.secteur)}
                carre={reference.kind !== 'contact'}
              />
              {data.fiche.email || data.fiche.telephone ? (
                <div className="com-coordonnees">
                  {texte(data.fiche.email) && (
                    <a href={`mailto:${texte(data.fiche.email)}`}>
                      <Icon name="mail" />
                      {texte(data.fiche.email)}
                    </a>
                  )}
                  {texte(data.fiche.telephone) && (
                    <a href={`tel:${texte(data.fiche.telephone)}`}>
                      <Icon name="phone" />
                      {texte(data.fiche.telephone)}
                    </a>
                  )}
                </div>
              ) : null}
              <section className="com-apercu-section">
                <h3>Prochaine action</h3>
                {data.aVenir[0] ? (
                  <>
                    <b>{data.aVenir[0].titre}</b>
                    <p className="small muted">{date(data.aVenir[0].echeance)}</p>
                  </>
                ) : (
                  <p className="small muted">Aucune activité prévue.</p>
                )}
              </section>
              <section className="com-apercu-section">
                <h3>Personnes, entreprises & affaires</h3>
                {(
                  data.liens.entreprises ?? (data.liens.entreprise ? [data.liens.entreprise] : [])
                ).map((c) => lien('entreprise', c.id, c.nom))}
                {(data.liens.contacts ?? (data.liens.contact ? [data.liens.contact] : [])).map(
                  (c) => lien('contact', c.id, c.nom),
                )}
                {data.liens.affaires?.map((a) =>
                  lien(
                    'affaire',
                    a.id,
                    a.titre,
                    a.clos ? (a.clos === 'gagne' ? 'Gagnée' : 'Perdue') : 'Affaire ouverte',
                  ),
                )}
              </section>
              <OutilsConnexes slug={slug} fiche={data} references={referencesLiees(data)} />
              <section className="com-apercu-section">
                <h3>Rendez-vous</h3>
                {data.rendezVous.map((r) => lien('rdv', r.id, r.titre, date(r.debut)))}
                {!data.rendezVous.length && <p className="small muted">Aucun rendez-vous lié.</p>}
              </section>
              <p className="small muted">
                Mails, historique et gestion des liens dans la fiche complète.
              </p>
            </>
          )}
          {rdv && (
            <>
              <p className="com-prochain-rdv">
                {date(rdv.debut)}
                {rdv.lieu ? ` · ${rdv.lieu}` : ''}
              </p>
              <section className="com-apercu-section">
                <h3>Liens du rendez-vous</h3>
                {rdv.entreprises.map((c) => lien('entreprise', c.id, c.nom))}
                {rdv.contacts.map((c) => lien('contact', c.id, c.nom))}
                {rdv.affaires.map((a) => lien('affaire', a.id, a.nom))}
              </section>
              <section className="com-apercu-section">
                <h3>Compte rendu</h3>
                {rdv.compteRendu ? (
                  <p className="com-extrait">{rdv.compteRendu.texte}</p>
                ) : (
                  <p className="small muted">À rédiger après l’échange.</p>
                )}
              </section>
              <OutilsConnexes
                slug={slug}
                references={[
                  ...rdv.entreprises.map((e) => ({ kind: 'entreprise' as const, id: e.id })),
                  ...rdv.contacts.map((c) => ({ kind: 'contact' as const, id: c.id })),
                  ...rdv.affaires.map((a) => ({ kind: 'affaire' as const, id: a.id })),
                ]}
              />
              <p className="small muted">
                Préparation, participants et tous les liens sont accessibles dans la fiche complète.
              </p>
            </>
          )}
        </div>
      </Fenetre>
    </div>
  );
}
