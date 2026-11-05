import { useState } from 'react';
import {
  analyserImport,
  validerImport,
  type AnalyseImport,
  type DecisionImport,
  type LigneImportAnalysee,
} from '../../api.js';
import { eurCents, jourCourt } from '../../gestion.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Le fichier voyage en base64 dans le JSON, comme les autres imports de l'OS.
function enBase64(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Ce fichier n’a pas pu être lu.'));
    lecteur.onload = () => {
      const octets = new Uint8Array(lecteur.result as ArrayBuffer);
      let binaire = '';
      for (let i = 0; i < octets.length; i += 0x8000)
        binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      resolve(btoa(binaire));
    };
    lecteur.readAsArrayBuffer(fichier);
  });
}

// Décision proposée au départ : le rapprochement s'il existe, sinon on importe la ligne telle quelle.
const parDefaut = (l: LigneImportAnalysee): DecisionImport =>
  l.rapprochement ? 'rapprocher' : 'importer';

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export function GestionImport({ slug, onImporte }: { slug: string; onImporte: () => void }) {
  const [fichier, setFichier] = useState<{ nom: string; base64: string } | null>(null);
  const [analyse, setAnalyse] = useState<AnalyseImport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DecisionImport>>({});
  const [resume, setResume] = useState<{
    importees: number;
    rapprochees: number;
    ignorees: number;
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const recommencer = () => {
    setFichier(null);
    setAnalyse(null);
    setDecisions({});
    setResume(null);
    setErreur(null);
  };

  const choisir = async (f: File | undefined) => {
    if (!f) return;
    setErreur(null);
    setEnCours(true);
    try {
      const base64 = await enBase64(f);
      const a = await analyserImport(slug, f.name, base64);
      setFichier({ nom: f.name, base64 });
      setAnalyse(a);
      setDecisions(
        Object.fromEntries(
          a.lignes.filter((l) => l.issue !== 'deja').map((l) => [l.cle, parDefaut(l)]),
        ),
      );
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  const retenues = Object.values(decisions).filter((d) => d !== 'ignorer').length;
  const valider = async () => {
    if (!fichier) return;
    setErreur(null);
    setEnCours(true);
    try {
      setResume(await validerImport(slug, fichier.nom, fichier.base64, decisions));
      onImporte();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  const etape = resume ? 3 : analyse ? 2 : 1;
  return (
    <>
      <div className="g-etapes">
        {['Choisir le fichier', 'Vérifier', 'Importé'].map((l, i) => (
          <span key={l} className={etape === i + 1 ? 'on' : ''}>
            {i + 1} · {l}
          </span>
        ))}
      </div>
      {erreur && (
        <div className="alert red" role="alert">
          {erreur}
        </div>
      )}

      {etape === 1 && (
        <>
          <div className="panel">
            <div className="panel-h">
              <h2>Où trouver le fichier dans Pennylane</h2>
            </div>
            <div className="panel-b">
              <ol className="g-how">
                <li>
                  Ouvrez <b>Gestion › Transactions</b> et choisissez la période voulue.
                </li>
                <li>Cochez la case en haut à gauche de la liste pour tout sélectionner.</li>
                <li>
                  Cliquez sur <b>Exporter</b>, puis récupérez le fichier dans <b>Plus › Exports</b>.
                </li>
              </ol>
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                Pennylane exporte en Excel (.xlsx) : l’OS lit aussi bien le .xlsx que le .csv. Le
                fichier n’est pas conservé après l’import, et rien n’est écrit dans Pennylane.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-b">
              <label className="btn primary" style={{ cursor: 'pointer' }}>
                {enCours ? 'Lecture…' : 'Choisir le fichier'}
                <input
                  type="file"
                  accept=".xlsx,.csv,text/csv"
                  aria-label="Fichier Pennylane"
                  disabled={enCours}
                  style={{ display: 'none' }}
                  onChange={(e) => void choisir(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        </>
      )}

      {etape === 2 && analyse && (
        <>
          <div className="g-compteurs">
            <div className="panel">
              <b data-testid="c-nouvelles">{analyse.compteurs.nouvelles}</b>
              <span>nouvelles lignes</span>
            </div>
            <div className="panel">
              <b data-testid="c-deja">{analyse.compteurs.deja}</b>
              <span>déjà dans l’OS, ignorées</span>
            </div>
            <div className="panel">
              <b data-testid="c-averifier">{analyse.compteurs.aVerifier}</b>
              <span>à vérifier</span>
            </div>
          </div>
          {analyse.compteurs.nonFinalisees > 0 && (
            <p className="small muted">
              {pluriel(
                analyse.compteurs.nonFinalisees,
                'ligne non finalisée ignorée',
                'lignes non finalisées ignorées',
              )}
              .
            </p>
          )}
          {analyse.avertissements.map((a) => (
            <p key={a} className="small muted">
              {a}
            </p>
          ))}
          <div className="panel">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Libellé</th>
                  <th className="r">Montant</th>
                  <th>État</th>
                  <th>Décision</th>
                </tr>
              </thead>
              <tbody>
                {analyse.lignes.map((l) => (
                  <tr key={l.cle} className={l.issue === 'deja' ? 'muted' : ''}>
                    <td className="num">{jourCourt(l.date)}</td>
                    <td className="g-lib">
                      <b>{l.libelle}</b>
                      {l.raison && <small>{l.raison}</small>}
                    </td>
                    <td className={`r num ${l.montantCents > 0 ? 'g-mv-pos' : ''}`}>
                      <b>
                        {l.montantCents > 0 ? '+' : '−'} {eurCents(Math.abs(l.montantCents))}
                      </b>
                    </td>
                    <td>
                      <span
                        className={`badge ${l.issue === 'nouvelle' ? 'green' : l.issue === 'a_verifier' ? 'amber' : ''}`}
                      >
                        {l.issue === 'nouvelle'
                          ? 'Nouvelle'
                          : l.issue === 'deja'
                            ? 'Déjà importée'
                            : 'À vérifier'}
                      </span>
                    </td>
                    <td>
                      {l.issue === 'deja' ? (
                        <span className="muted">–</span>
                      ) : (
                        <select
                          className="input"
                          aria-label={`Décision pour ${l.libelle}`}
                          value={decisions[l.cle]}
                          onChange={(e) =>
                            setDecisions({
                              ...decisions,
                              [l.cle]: e.target.value as DecisionImport,
                            })
                          }
                        >
                          {l.rapprochement && (
                            <option value="rapprocher">
                              Rapprocher avec « {l.rapprochement.libelle} »
                            </option>
                          )}
                          <option value="importer">
                            {l.sens === 'sortie'
                              ? 'Importer comme dépense'
                              : 'Importer comme recette'}
                          </option>
                          <option value="ignorer">Ignorer</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Une entrée est reprise telle que le relevé la donne (TVA non renseignée). Rien n’est
            écrit tant que vous n’avez pas validé.
          </p>
          <button className="btn" onClick={recommencer}>
            Choisir un autre fichier
          </button>{' '}
          <button className="btn primary" disabled={enCours} onClick={() => void valider()}>
            {`Importer ${pluriel(retenues, 'ligne', 'lignes')}`}
          </button>
        </>
      )}

      {etape === 3 && resume && (
        <div className="panel">
          <div className="panel-b">
            <b>
              {resume.importees} nouvelles,{' '}
              {pluriel(resume.rapprochees, 'rapprochée', 'rapprochées')},{' '}
              {pluriel(resume.ignorees, 'ignorée', 'ignorées')}
            </b>
            <p className="muted" style={{ margin: '8px 0 12px' }}>
              Mettez à jour le solde dans Pilotage, à la date du dernier mouvement importé : le
              fichier Pennylane ne le contient pas. Rien n’a été écrit dans Pennylane.
            </p>
            <button className="btn" onClick={recommencer}>
              Importer un autre fichier
            </button>
          </div>
        </div>
      )}
    </>
  );
}
