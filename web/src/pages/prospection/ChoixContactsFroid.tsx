import { useCallback, useEffect, useState } from 'react';
import { fetchEchantillon, type ContactFroid } from '../../api.js';

// Échantillon de la base vivante : tiré au hasard parmi les contacts disponibles. Les règles
// d'exclusion s'appliquent à chaque tirage et sont affichées pour que rien ne soit caché.
export function ChoixContactsFroid({
  slug,
  onContinuer,
}: {
  slug: string;
  onContinuer: (baseIds: string[]) => void;
}) {
  const [nombre, setNombre] = useState(30);
  const [filtre, setFiltre] = useState('');
  const [contacts, setContacts] = useState<ContactFroid[] | null>(null);
  const [retires, setRetires] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  const tirer = useCallback(() => {
    setContacts(null);
    setRetires([]);
    fetchEchantillon(slug, nombre, filtre).then(setContacts, (e: unknown) =>
      setErreur(e instanceof Error ? e.message : String(e)),
    );
  }, [slug, nombre, filtre]);

  useEffect(() => {
    tirer();
    // Un tirage à l'ouverture ; ensuite, à la demande (bouton ou changement de champ validé).
  }, []);

  const retenus = (contacts ?? []).filter((c) => !retires.includes(c.id));
  return (
    <div className="grid g-main">
      <div className="panel">
        <div className="panel-h">
          <h2>Échantillon de la base vivante</h2>
          <button className="btn sm" onClick={tirer}>
            Tirer un autre échantillon
          </button>
        </div>
        <div className="panel-b">
          <div className="grid g2">
            <label className="field">
              <span>Nombre de contacts</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                aria-label="Nombre de contacts"
                value={nombre}
                onChange={(e) => setNombre(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                onBlur={tirer}
              />
            </label>
            <label className="field">
              <span>Filtre (société, fonction, domaine)</span>
              <input
                className="input"
                aria-label="Filtre"
                placeholder="par exemple : fonderie"
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                onBlur={tirer}
              />
            </label>
          </div>
          {erreur && <div className="empty">{erreur}</div>}
          {contacts && contacts.length === 0 && (
            <div className="alert amber">
              <div>
                Aucun contact ne correspond : élargissez le filtre ou importez des contacts dans les
                Bases vivantes.
              </div>
            </div>
          )}
          {contacts && contacts.length > 0 && (
            <table className="tbl small">
              <thead>
                <tr>
                  <th />
                  <th>Contact</th>
                  <th>Société</th>
                  <th>Fonction</th>
                  <th className="r">Touche</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Garder ${c.nom}`}
                        checked={!retires.includes(c.id)}
                        onChange={(e) =>
                          setRetires((r) =>
                            e.target.checked ? r.filter((x) => x !== c.id) : [...r, c.id],
                          )
                        }
                      />
                    </td>
                    <td>
                      <b>{c.nom}</b>
                    </td>
                    <td>{c.entreprise}</td>
                    <td>{c.fonction ?? '—'}</td>
                    <td className="r num">{c.touche}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 14 }}>
            <button
              className="btn primary"
              disabled={retenus.length === 0}
              onClick={() => onContinuer(retenus.map((c) => c.id))}
            >
              Continuer avec {retenus.length} {retenus.length > 1 ? 'contacts' : 'contact'}
            </button>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">
          <h2>Règles de sélection</h2>
        </div>
        <div className="panel-b">
          <ul className="checks small">
            <li>Contacts prospectables, avec une adresse mail valide</li>
            <li>
              Jamais contactés (ni dans l'OS, ni dans le CRM d'un mandat), ou en cours de séquence
            </li>
            <li>Au moins 14 jours depuis la touche précédente</li>
            <li>Plafond de touches non atteint, et pas marqués épuisés</li>
            <li>Opposition, exclusion (client, partenaire, concurrent) et réponses : exclus</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
