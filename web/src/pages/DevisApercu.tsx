import type { ContenuDevis } from '../api.js';
import { calculer } from '../devis.js';

const eur2 = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const jour = (s: string | Date) => new Date(s).toLocaleDateString('fr-FR');

const Liste = ({ texte }: { texte: string }) => (
  <ul>
    {texte
      .split('\n')
      .filter((x) => x.trim())
      .map((x, i) => (
        <li key={i}>{x}</li>
      ))}
  </ul>
);
const AFixer = ({ children }: { children: string }) => <span className="d-vide">{children}</span>;

// La page que recevra le client : même rendu à l'écran qu'au PDF de la livraison suivante.
export function DevisApercu({
  contenu: c,
  numero,
  client,
  contact,
  date,
}: {
  contenu: ContenuDevis;
  numero: string;
  client: string | null;
  contact: string | null;
  date: string;
}) {
  const t = calculer(c);
  const echeance = new Date(new Date(date).getTime() + c.validiteJours * 864e5);
  const clauses = c.clauses.filter((x) => x.active);
  return (
    <div className="d-page" aria-label="Aperçu du devis">
      <div className="entete">
        <div>
          <div className="logo">
            SIMATIS <span>OS</span>
          </div>
          <div>Direction commerciale à temps partagé</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <b>DEVIS {numero}</b>
          <br />
          Émis le {jour(date)}
          <br />
          Valable jusqu’au {jour(echeance)}
        </div>
      </div>
      <div>
        <b>{client ?? '—'}</b>
        {contact && (
          <>
            <br />À l’attention de {contact}
          </>
        )}
      </div>
      <h1 style={{ marginTop: 14 }}>{c.titre}</h1>
      {(c.contexte || c.objectifs) && (
        <>
          <h2>Contexte et objectifs</h2>
          <p>{c.contexte}</p>
          <Liste texte={c.objectifs} />
        </>
      )}
      <h2>Périmètre de la mission</h2>
      <b>Inclus</b>
      {c.inclus.trim() ? (
        <Liste texte={c.inclus} />
      ) : (
        <p>
          <AFixer>à préciser</AFixer>
        </p>
      )}
      <b className="hors">Exclu</b>
      {c.exclu.trim() ? (
        <Liste texte={c.exclu} />
      ) : (
        <p>
          <AFixer>non précisé</AFixer>
        </p>
      )}
      {c.livrables.trim() && (
        <>
          <h2>Livrables</h2>
          <Liste texte={c.livrables} />
        </>
      )}
      <h2>Calendrier</h2>
      <p>
        Début : {c.debut ? jour(c.debut) : <AFixer>à préciser</AFixer>} · Durée :{' '}
        {c.duree || <AFixer>à préciser</AFixer>}
      </p>
      <h2>Prix</h2>
      <table>
        <thead>
          <tr>
            <th>Prestation</th>
            <th className="r">Qté</th>
            <th className="r">PU HT</th>
            <th className="r">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {c.lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.libelle || <AFixer>…</AFixer>}</td>
              <td className="r">
                {l.quantite} {l.unite}
              </td>
              <td className="r">
                {l.prixUnitaire === null ? <AFixer>à fixer</AFixer> : eur2(l.prixUnitaire)}
              </td>
              <td className="r">
                {l.prixUnitaire === null ? '' : eur2(l.prixUnitaire * l.quantite)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ width: '55%', marginLeft: 'auto' }}>
        <tbody>
          {c.remisePct > 0 && (
            <tr>
              <td>Remise {c.remisePct} %</td>
              <td className="r">− {eur2(t.remise)}</td>
            </tr>
          )}
          <tr>
            <td>Total HT</td>
            <td className="r">{eur2(t.ht)}</td>
          </tr>
          <tr>
            <td>TVA 20 %</td>
            <td className="r">{eur2(t.tva)}</td>
          </tr>
          <tr>
            <td>
              <b>Total TTC</b>
            </td>
            <td className="r">
              <b>{eur2(t.ttc)}</b>
            </td>
          </tr>
          {c.acomptePct > 0 && (
            <tr>
              <td>Acompte {c.acomptePct} % à la commande</td>
              <td className="r">{eur2(t.acompte)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p>
        Frais de déplacement :{' '}
        {c.frais === 'inclus' ? 'inclus dans le prix.' : 'refacturés au réel, sur justificatifs.'}
      </p>
      {clauses.length > 0 && (
        <>
          <h2>Conditions de vente</h2>
          <div className="cgv">
            {clauses.map((x, i) => (
              <p key={i}>
                <b>
                  {i + 1}. {x.titre}.
                </b>{' '}
                {x.texte}
              </p>
            ))}
          </div>
        </>
      )}
      <div className="signature">
        <div>
          <b>Pour SIMATIS</b>
          <br />
          Date et signature
        </div>
        <div>
          <b>Pour {client ?? 'le client'}</b>
          <br />
          Date, signature et mention « Bon pour accord »
        </div>
      </div>
    </div>
  );
}
