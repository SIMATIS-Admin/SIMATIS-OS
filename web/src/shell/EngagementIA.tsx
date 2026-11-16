import { useEffect, useState } from 'react';
import { fetchOptions, saveOptions, type Options } from '../api.js';
import claudeMark from '../assets/claude-mark.svg';
import openaiMark from '../assets/openai-mark.svg';

type Cle = 'claudeEngage' | 'chatgptEngage';

const IA: { cle: Cle; nom: string; marque: string; classe: 'claude' | 'chatgpt' }[] = [
  { cle: 'claudeEngage', nom: 'Claude', marque: claudeMark, classe: 'claude' },
  { cle: 'chatgptEngage', nom: 'ChatGPT', marque: openaiMark, classe: 'chatgpt' },
];

// Chaque IA s'engage ou se met de côté indépendamment (coupe la consommation quand le pilote est absent).
// Les tâches restent attribuées : Codex fait les recherches, Claude le reste.
export function EngagementIA() {
  const [engage, setEngage] = useState<Record<Cle, boolean>>({
    claudeEngage: true,
    chatgptEngage: true,
  });
  useEffect(() => {
    void fetchOptions().then(
      (o: Options | undefined) =>
        o &&
        setEngage({
          claudeEngage: o.claudeEngage !== false,
          chatgptEngage: o.chatgptEngage !== false,
        }),
      () => undefined,
    );
  }, []);
  // Le changement s'affiche tout de suite ; il revient en arrière si l'OS ne l'a pas enregistré.
  const basculer = (cle: Cle) => {
    const avant = engage[cle];
    setEngage((e) => ({ ...e, [cle]: !avant }));
    void saveOptions({ [cle]: !avant }).catch(() => setEngage((e) => ({ ...e, [cle]: avant })));
  };
  return (
    <div className="commutateur-moteur" role="group" aria-label="IA engagées">
      {IA.map((ia) => (
        <button
          key={ia.cle}
          type="button"
          aria-pressed={engage[ia.cle]}
          aria-label={ia.nom}
          title={`${ia.nom} ${engage[ia.cle] ? 'engagé' : 'non engagé'} : cliquer pour ${engage[ia.cle] ? 'le mettre de côté' : "l'engager"}`}
          className={`commutateur-moteur-option ${ia.classe} ${engage[ia.cle] ? 'actif' : ''}`}
          onClick={() => basculer(ia.cle)}
        >
          <span className="limite-ia-marque" aria-hidden="true">
            <img src={ia.marque} alt="" />
          </span>
        </button>
      ))}
    </div>
  );
}
