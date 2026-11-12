import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.js';
import { jour } from '../listes/Tableau.js';

export function EnteteCommercial({
  description,
  children,
}: {
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="com-entete">
      <div>
        <span className="com-repere">Relation commerciale</span>
        <p>{description}</p>
      </div>
      <div className="com-actions">{children}</div>
    </header>
  );
}

export function Identite({
  nom,
  detail,
  carre = false,
}: {
  nom: string;
  detail?: string | null;
  carre?: boolean;
}) {
  const initiales = nom
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((mot) => mot[0])
    .join('')
    .toLocaleUpperCase('fr');
  return (
    <span className="com-identite">
      <span className={`com-avatar ${carre ? 'carre' : ''}`} aria-hidden="true">
        {initiales}
      </span>
      <span>
        <strong>{nom}</strong> {detail && <small>{detail}</small>}
      </span>
    </span>
  );
}

export function ProchaineActivite({ date }: { date: string | null }) {
  const retard =
    !!date &&
    date.slice(0, 10) < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return (
    <span className={`com-prochaine ${retard ? 'retard' : ''}`}>
      <Icon name={date ? 'clock' : 'info'} />
      <span>
        {date ? jour(date) : 'À planifier'}
        {retard && <small>En retard</small>}
      </span>
    </span>
  );
}

// Search and view choices survive a visit to a complete record, without changing its URL.
export function useChoixCommercial<T extends string = string>(cle: string, defaut: NoInfer<T>) {
  const [valeur, setValeur] = useState<T>(() => {
    try {
      return (sessionStorage.getItem(`simatis.commercial.${cle}`) as T | null) ?? defaut;
    } catch {
      return defaut;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`simatis.commercial.${cle}`, valeur);
    } catch {
      /* Visit-only choice when storage is unavailable. */
    }
  }, [cle, valeur]);
  return [valeur, setValeur] as const;
}
