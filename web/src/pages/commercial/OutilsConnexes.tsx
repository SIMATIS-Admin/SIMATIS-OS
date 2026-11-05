import { useEffect, useState } from 'react';
import { fetchFiche, type FicheDetail, type RefFiche } from '../../api.js';
import { Icon } from '../../icons.js';

type Source = { nom: string; fiche: FicheDetail };
// Indirect associations are read-only: unlinking a tool here would change another record.
export function OutilsConnexes({
  slug,
  references = [],
  fiche,
  inclureDirect = true,
}: {
  slug: string;
  references?: RefFiche[];
  fiche?: FicheDetail;
  inclureDirect?: boolean;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [partiel, setPartiel] = useState(false);
  const cle = JSON.stringify(references);
  useEffect(() => {
    let actif = true;
    setSources([]);
    setPartiel(false);
    const refs = JSON.parse(cle) as RefFiche[];
    const uniques = refs.filter(
      (r, i) => refs.findIndex((x) => x.kind === r.kind && x.id === r.id) === i,
    );
    void Promise.allSettled(uniques.map((r) => fetchFiche(slug, r.kind, r.id))).then(
      (resultats) => {
        if (!actif) return;
        setPartiel(resultats.some((r) => r.status === 'rejected'));
        setSources(
          resultats.flatMap((r) =>
            r.status === 'fulfilled' && r.value?.fiche
              ? [
                  {
                    nom:
                      typeof r.value.fiche.nom === 'string'
                        ? r.value.fiche.nom
                        : typeof r.value.fiche.titre === 'string'
                          ? r.value.fiche.titre
                          : 'Fiche associée',
                    fiche: r.value,
                  },
                ]
              : [],
          ),
        );
      },
    );
    return () => {
      actif = false;
    };
  }, [slug, cle]);
  const direct = new Set([
    ...(fiche?.diagnostics ?? []).map((d) => `diagnostic:${d.id}`),
    ...(fiche?.testsVma ?? []).map((t) => `vma:${t.id}`),
  ]);
  const deja = new Set<string>();
  const toutes = [...(fiche && inclureDirect ? [{ nom: '', fiche }] : []), ...sources];
  const outils = toutes
    .flatMap((s) => [
      ...(s.fiche.diagnostics ?? []).map((d) => ({
        cle: `diagnostic:${d.id}`,
        nom: d.nom,
        detail: `Diagnostic · Étape ${d.etape}${d.statut ? ` · ${d.statut}` : ''}`,
        href: `#/${slug}/diagnostics/ouvrir/${d.id}`,
        via: s.nom,
        icon: 'radar',
      })),
      ...(s.fiche.testsVma ?? []).map((t) => ({
        cle: `vma:${t.id}`,
        nom: t.nom,
        detail: t.date ? 'Test VMA · Résultat reçu' : 'Test VMA · En attente de réponse',
        href: `#/${slug}/diagnostics/test/${t.id}`,
        via: s.nom,
        icon: 'pulse',
      })),
    ])
    .filter((o) => {
      if (deja.has(o.cle) || (!inclureDirect && direct.has(o.cle))) return false;
      deja.add(o.cle);
      return true;
    });
  if (!outils.length && !partiel) return null;
  return (
    <section className="panel com-outils-connexes" aria-label="Diagnostic et tests VMA associés">
      <header className="panel-h">
        <h2>Diagnostic & tests VMA</h2>
      </header>
      <div className="panel-b">
        {outils.map((o) => (
          <a key={o.cle} href={o.href} className="com-lien">
            <Icon name={o.icon} />
            <span>
              <strong>{o.nom}</strong>
              <small>{o.detail}</small>
              {o.via && <small>Via {o.via}</small>}
            </span>
          </a>
        ))}
        {partiel && (
          <p className="small muted" role="status">
            Certains liens n’ont pas pu être lus. Les fiches associées restent accessibles.
          </p>
        )}
      </div>
    </section>
  );
}

export const referencesLiees = (fiche: FicheDetail): RefFiche[] => [
  ...(fiche.liens.entreprises ?? (fiche.liens.entreprise ? [fiche.liens.entreprise] : [])).map(
    (e) => ({ kind: 'entreprise' as const, id: e.id }),
  ),
  ...(fiche.liens.contacts ?? (fiche.liens.contact ? [fiche.liens.contact] : [])).map((c) => ({
    kind: 'contact' as const,
    id: c.id,
  })),
];
