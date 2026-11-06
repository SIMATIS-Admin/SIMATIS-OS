import { ProgressionRecherche } from './ProgressionRecherche.js';
import { useRecherche, signalRecherche } from './useRecherche.js';
import { useEffect, useState } from 'react';
import {
  lireRoutineProspects,
  noterContactsRechercheBase,
  creerImportBase,
  integrerImportBase,
  lancerRechercheProspects,
  continuerRechercheProspects,
  effacerRechercheProspects,
  type ProspectRecherche,
} from '../api.js';
import { Fenetre } from './Fenetre.js';

import { CIBLE } from '../../../src/enrichissement/cible.js';

const csv = (v: string | null) => '"' + (v ?? '').replaceAll('"', '""') + '"';

export function RechercheProspects({
  slug,
  fermer,
  termine,
}: {
  slug: string;
  fermer: () => void;
  termine: (message: string) => void;
}) {
  const { tache, setTache, charge, erreurSuivi } = useRecherche(slug);
  const enRecherche = tache?.etat === 'en_cours';
  const [consignes, setConsignes] = useState(CIBLE);
  useEffect(() => {
    let actif = true;
    void lireRoutineProspects(slug).then(
      (r) => {
        if (actif) setConsignes(r.consignes);
      },
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug]);
  const [nombre, setNombre] = useState(10);
  const [contacts, setContacts] = useState<ProspectRecherche[] | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const [imports, setImports] = useState<string[]>([]);

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true);
    setErreur('');
    try {
      await action();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    if (!tache) return;
    setNombre(tache.nombre);
    if (tache.consignes) setConsignes(tache.consignes);
    if (
      tache.etat === 'terminee' ||
      tache.etat === 'a_completer' ||
      (tache.etat === 'erreur' && tache.contacts?.length)
    ) {
      setContacts(tache.contacts ?? []);
      setSelection((tache.contacts ?? []).map((_, i) => i));
    }
  }, [tache?.id, tache?.etat]);

  const rechercher = () =>
    agir(async () => {
      setContacts(null);
      const resultat = await lancerRechercheProspects(slug, consignes, nombre);
      setTache(resultat);
      signalRecherche();
    });

  const integrer = () =>
    agir(async () => {
      const lignes = contacts?.filter((_, i) => selection.includes(i)) ?? [];
      let ids = imports;
      if (!ids.length) {
        const texte = [
          'Entreprise;Prénom;Nom;Fonction;Email;LinkedIn',
          ...lignes.map((c) =>
            [c.entreprise, c.prenom, c.nom, c.fonction, c.email, c.linkedin].map(csv).join(';'),
          ),
        ].join('\n');
        ids = (
          await creerImportBase(slug, {
            nomFichier: 'Recherche Codex.csv',
            provenance: 'Recherche Codex',
            texte,
          })
        ).map((i) => i.id);
        setImports(ids);
      }
      let creees = 0;
      let fusionnees = 0;
      for (const id of ids) {
        const bilan = await integrerImportBase(slug, id);
        creees += bilan.creees;
        fusionnees += bilan.fusionnees;
      }
      await noterContactsRechercheBase(slug, lignes);
      if (tache)
        await effacerRechercheProspects(slug, tache.id, {
          ajoutees: creees,
          rapprochees: fusionnees,
        });
      signalRecherche();
      termine(`${creees} fiche(s) ajoutée(s), ${fusionnees} fiche(s) rapprochée(s).`);
    });

  return (
    <Fenetre
      titre="Rechercher de nouveaux prospects"
      onFermer={() => {
        if (!occupe) fermer();
      }}
      pied={
        <>
          <button className="btn" disabled={occupe} onClick={fermer}>
            {enRecherche ? 'Mettre en arrière-plan' : 'Fermer'}
          </button>
          {contacts === null ? (
            <button
              className="btn primary"
              disabled={
                occupe ||
                enRecherche ||
                !charge ||
                !consignes.trim() ||
                !Number.isInteger(nombre) ||
                nombre < 10 ||
                nombre > 100
              }
              onClick={() => void rechercher()}
            >
              Lancer maintenant
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={occupe || !selection.length}
              onClick={() => void integrer()}
            >
              Ajouter la sélection ({selection.length})
            </button>
          )}
        </>
      }
    >
      {contacts === null ? (
        <div className="bv-enrichir">
          <label className="bv-champ">
            Consignes de recherche
            <textarea
              className="input"
              rows={8}
              maxLength={5000}
              disabled={occupe || enRecherche}
              value={consignes}
              onChange={(e) => setConsignes(e.target.value)}
            />
          </label>
          <label className="bv-champ">
            Nombre de contacts visé
            <input
              className="input"
              type="number"
              min={10}
              max={100}
              disabled={occupe || enRecherche}
              value={nombre}
              onChange={(e) => setNombre(e.target.valueAsNumber || 0)}
            />
          </label>
        </div>
      ) : (
        <>
          <p>
            {contacts.length} contact(s) retenu(s) sur {nombre} visés.
          </p>
          {contacts.map((c, i) => (
            <div key={i}>
              <label>
                <input
                  type="checkbox"
                  disabled={occupe || imports.length > 0}
                  checked={selection.includes(i)}
                  onChange={() =>
                    setSelection((s) => (s.includes(i) ? s.filter((n) => n !== i) : [...s, i]))
                  }
                />{' '}
                <strong>
                  {c.prenom} {c.nom} · {c.entreprise}
                </strong>
              </label>
              <p>
                {c.fonction} · {c.email ?? 'LinkedIn'} ·{' '}
                <a href={c.source} target="_blank" rel="noreferrer">
                  Source
                </a>
                {c.linkedin && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={c.linkedin} target="_blank" rel="noreferrer">
                      Profil LinkedIn
                    </a>
                  </>
                )}
              </p>
              <p>{c.qualification}</p>
            </div>
          ))}
        </>
      )}
      {tache && <ProgressionRecherche tache={tache} />}
      {tache?.message && <p role="status">{tache.message}</p>}
      {tache && (tache.etat === 'a_completer' || tache.etat === 'erreur') && (
        <label className="bv-champ">
          Critères pour compléter
          <textarea
            className="input"
            rows={4}
            maxLength={5000}
            value={consignes}
            onChange={(e) => setConsignes(e.target.value)}
            disabled={occupe}
          />
        </label>
      )}
      {tache && (tache.etat === 'a_completer' || tache.etat === 'erreur') && (
        <button
          className="btn primary"
          disabled={occupe}
          onClick={() =>
            void agir(async () => {
              const suite = await continuerRechercheProspects(slug, consignes);
              setContacts(null);
              setImports([]);
              setTache(suite);
              signalRecherche();
            })
          }
        >
          Poursuivre la recherche
        </button>
      )}
      {enRecherche && (
        <p role="status">
          Recherche en cours depuis{' '}
          {new Date(tache.debut).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Vous pouvez continuer à utiliser l’application. Les résultats resteront disponibles ici.
        </p>
      )}
      {tache?.etat === 'erreur' && <p role="alert">{tache.erreur}</p>}
      {erreurSuivi && <p role="alert">{erreurSuivi}</p>}
      {occupe && (
        <p role="status">
          {contacts === null ? 'Codex recherche les contacts…' : 'Ajout en cours…'}
        </p>
      )}
      {contacts !== null && (
        <button
          className="btn"
          disabled={occupe}
          onClick={() =>
            void agir(async () => {
              if (tache) await effacerRechercheProspects(slug, tache.id);
              setTache(null);
              setContacts(null);
              setImports([]);
              signalRecherche();
            })
          }
        >
          Nouvelle recherche
        </button>
      )}
      {erreur && <p role="alert">{erreur}</p>}
    </Fenetre>
  );
}
