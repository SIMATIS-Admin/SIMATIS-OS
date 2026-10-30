import { useCallback, useEffect, useState } from 'react';
import {
  ajouterSignatureProspection,
  fetchProspection,
  modifierSignatureProspection,
  reglerObjectifProspection,
  remplacerImageSignature,
  supprimerSignatureProspection,
  urlImageSignature,
  type SignatureProspection,
} from '../../api.js';

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Lit un fichier image et renvoie son contenu en base64, sans le préfixe « data: ».
const lireFichier = (f: File) =>
  new Promise<{ typeMime: string; imageBase64: string }>((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Le fichier n'a pas pu être lu."));
    lecteur.onload = () =>
      resolve({
        typeMime: f.type,
        imageBase64: (lecteur.result as string).replace(/^data:[^,]*,/, ''),
      });
    lecteur.readAsDataURL(f);
  });

export function ProspectionReglages({ slug }: { slug: string }) {
  const [signatures, setSignatures] = useState<SignatureProspection[] | null>(null);
  const [objectif, setObjectif] = useState('30');
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [nom, setNom] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [renommer, setRenommer] = useState<{ id: string; nom: string } | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const v = await fetchProspection(slug);
    setSignatures(v.signatures);
    setObjectif(String(v.stats.objectif));
  }, [slug]);

  useEffect(() => {
    charger().catch((e: unknown) => setMessage({ texte: messageErreur(e), erreur: true }));
  }, [charger]);

  // Une action de l'écran : refus de l'API affiché tel quel, liste rechargée après un succès.
  const agir = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await charger();
      setMessage(ok ? { texte: ok, erreur: false } : null);
    } catch (e) {
      setMessage({ texte: messageErreur(e), erreur: true });
    }
  };

  const ajouter = () => {
    if (!nom.trim() || !fichier) {
      setMessage({ texte: 'Indiquez un nom et une image (PNG ou JPEG).', erreur: true });
      return;
    }
    void agir(async () => {
      await ajouterSignatureProspection(slug, { nom, ...(await lireFichier(fichier)) });
      setNom('');
      setFichier(null);
    }, 'Signature ajoutée.');
  };

  if (!signatures) return message ? <div className="empty">{message.texte}</div> : null;

  return (
    <div className="grid g2">
      <div className="panel">
        <div className="panel-h">
          <h2>Signatures</h2>
        </div>
        <div className="panel-b">
          {signatures.length === 0 ? (
            <p className="muted small">
              Aucune signature : les mails seront créés sans signature. Ajoutez-en une ci-dessous.
            </p>
          ) : (
            <table className="tbl small">
              <tbody>
                {signatures.map((s) => (
                  <tr key={s.id}>
                    <td style={{ width: 160 }}>
                      <img
                        src={urlImageSignature(slug, s.id)}
                        alt={`Aperçu de la signature ${s.nom}`}
                        style={{ maxWidth: 150, maxHeight: 60 }}
                      />
                    </td>
                    <td>
                      {renommer?.id === s.id ? (
                        <span style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="input"
                            aria-label={`Nouveau nom de ${s.nom}`}
                            value={renommer.nom}
                            onChange={(e) => setRenommer({ id: s.id, nom: e.target.value })}
                          />
                          <button
                            className="btn sm primary"
                            onClick={() => {
                              void agir(() =>
                                modifierSignatureProspection(slug, s.id, { nom: renommer.nom }),
                              );
                              setRenommer(null);
                            }}
                          >
                            Enregistrer le nom
                          </button>
                        </span>
                      ) : (
                        <b>{s.nom}</b>
                      )}
                      <div>
                        <label className="small">
                          <input
                            type="checkbox"
                            aria-label={`${s.nom} : par défaut`}
                            checked={s.defaut}
                            onChange={(e) =>
                              void agir(() =>
                                modifierSignatureProspection(slug, s.id, {
                                  defaut: e.target.checked,
                                }),
                              )
                            }
                          />{' '}
                          par défaut
                        </label>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn sm"
                        aria-label={`Renommer ${s.nom}`}
                        onClick={() => setRenommer({ id: s.id, nom: s.nom })}
                      >
                        Renommer
                      </button>{' '}
                      <label className="btn sm">
                        Remplacer l'image
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          aria-label={`Remplacer l'image de ${s.nom}`}
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f)
                              void agir(
                                async () =>
                                  remplacerImageSignature(slug, s.id, await lireFichier(f)),
                                'Image remplacée.',
                              );
                          }}
                        />
                      </label>{' '}
                      {aSupprimer === s.id ? (
                        <button
                          className="btn sm danger"
                          onClick={() => {
                            void agir(() => supprimerSignatureProspection(slug, s.id));
                            setASupprimer(null);
                          }}
                        >
                          Confirmer la suppression
                        </button>
                      ) : (
                        <button
                          className="btn sm ghost danger"
                          aria-label={`Supprimer ${s.nom}`}
                          onClick={() => setASupprimer(s.id)}
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 14 }}>
            <b className="small">Ajouter une signature</b>
            <div className="grid g2" style={{ marginTop: 6 }}>
              <label className="field">
                <span>Nom</span>
                <input
                  className="input"
                  aria-label="Nom de la nouvelle signature"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="Par exemple : Simatis et Kairos"
                />
              </label>
              <label className="field">
                <span>Image (PNG ou JPEG, 400 Ko au maximum)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Image de la nouvelle signature"
                  onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <button className="btn primary" onClick={ajouter}>
              Ajouter la signature
            </button>
          </div>
          {message && (
            <p
              className="small"
              role="status"
              style={{ color: message.erreur ? 'var(--red)' : undefined }}
            >
              {message.texte}
            </p>
          )}
          <p className="small muted">
            Chaque signature est une image intégrée au mail. Vous choisissez celle de chaque
            campagne ; une signature par défaut est proposée.
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">
          <h2>Objectif quotidien</h2>
        </div>
        <div className="panel-b">
          <label className="field">
            <span>Mails de prospection par jour (0 à 500)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={500}
              aria-label="Objectif quotidien"
              style={{ width: 120 }}
              value={objectif}
              onChange={(e) => setObjectif(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            onClick={() =>
              void agir(
                () => reglerObjectifProspection(slug, Number(objectif)),
                'Objectif enregistré.',
              )
            }
          >
            Enregistrer l'objectif
          </button>
          <p className="small muted">
            L'objectif alimente le compteur de l'écran Prospection et du Brief du jour. À 0, le
            compteur s'affiche sans jauge.
          </p>
        </div>
      </div>
    </div>
  );
}
