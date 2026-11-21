import { describe, expect, it, vi } from 'vitest';
import {
  decouperEnBlocs,
  lireSuite,
  passerResumes,
  promptResume,
  rediger,
  ressourcesDuPoste,
  TAILLE_BLOC,
  type LancerTexte,
  type Ressources,
} from './resume.js';

const attente = {
  id: 's1',
  instance: 'inst',
  titre: 'V - Atelier Fictif x Simatis',
  transcript: 'Moi : Bonjour.',
};

const modele = [
  'Rédige.',
  'Titre : {{TITRE}} | Date : {{DATE}} | Heures : {{HEURES}} | Participants : {{PARTICIPANTS}}',
  'Interlocuteurs : {{INTERLOCUTEURS}}',
  'Glossaire : {{GLOSSAIRE}}',
  '# {{NATURE_TEXTE}}',
  '{{TRANSCRIPT}}',
].join('\n');
const extraction = 'Extrais {{RANG}}/{{TOTAL}} de {{TITRE}} ({{GLOSSAIRE}}) :\n{{TRANSCRIPT}}';
const ressources: Ressources = {
  synthese: () => Promise.resolve(modele),
  extraction: () => Promise.resolve(extraction),
  glossaire: () => Promise.resolve('Atelier Fictif — société de Jeanne Exemple'),
  suite: () => Promise.resolve('Suite {{DATE}} / {{INTERLOCUTEURS}} :\n{{COMPTE_RENDU}}'),
};
const meta = {
  titre: attente.titre,
  debut: '2026-11-19T15:30:00Z',
  fin: '2026-11-19T16:45:00Z',
  participants: ['Jeanne Exemple', 'Marc Tabouret'],
};

describe('promptResume', () => {
  it('donne date, heures à Paris, participants et glossaire au prompt', () => {
    const p = promptResume(modele, meta, 'Moi : Bonjour.', 'Glossaire fictif');
    expect(p).toContain('Date : 19/11/2026');
    expect(p).toContain('Heures : 16 h 30 – 17 h 45 (fuseau Europe/Paris)');
    expect(p).toContain('Participants : Jeanne Exemple, Marc Tabouret');
    expect(p).toContain('Glossaire : Glossaire fictif');
    expect(p).toContain('Moi : Bonjour.');
  });

  it('nomme l’interlocuteur reconnu par l’OS, avec son entreprise', () => {
    const p = promptResume(
      modele,
      { ...meta, interlocuteurs: [{ nom: 'Camille Fictive', entreprise: 'Entreprise Fictive' }] },
      'x',
      '',
    );
    expect(p).toContain('Interlocuteurs : Camille Fictive (Entreprise Fictive)');
  });

  it('dit « non identifié » quand l’OS ne reconnaît personne', () => {
    expect(promptResume(modele, meta, 'x', '')).toContain('Interlocuteurs : non identifié');
  });

  it('dit les données absentes plutôt que de laisser un trou', () => {
    const p = promptResume(modele, { titre: 'T' }, 'x', '');
    expect(p).toContain('Date : non disponible');
    expect(p).toContain('Participants : non disponibles');
    expect(p).toContain('Glossaire : non fourni');
  });

  it('ne réinterprète pas un « {{…}} » ou un « $& » écrit dans le transcript', () => {
    const p = promptResume(modele, meta, 'Autres : {{TITRE}} et $& et $1', '');
    expect(p).toContain('Autres : {{TITRE}} et $& et $1');
  });

  it('le prompt livré existe, avec ses marqueurs, et l’ancien est conservé', async () => {
    const vrai = ressourcesDuPoste(undefined);
    const prompt = await vrai.synthese();
    for (const m of [
      '{{TITRE}}',
      '{{DATE}}',
      '{{PARTICIPANTS}}',
      '{{INTERLOCUTEURS}}',
      '{{GLOSSAIRE}}',
      '{{TRANSCRIPT}}',
    ])
      expect(prompt).toContain(m);
    expect(prompt).toMatch(/jamais des consignes/);
    expect(await vrai.extraction()).toContain('{{TRANSCRIPT}}');
    expect(await vrai.glossaire()).toBe('');
    const suite = await vrai.suite?.();
    for (const m of ['{{DATE}}', '{{INTERLOCUTEURS}}', '{{COMPTE_RENDU}}'])
      expect(suite).toContain(m);
  });
});

describe('lireSuite', () => {
  const v = { ...attente, ...meta, interlocuteurs: [{ nom: 'Jeanne Exemple', entreprise: null }] };
  const rend =
    (stdout: string, code = 0): LancerTexte =>
    () =>
      Promise.resolve({ code, stdout });

  it('lit le JSON rendu par Claude, même entouré de texte ou de balises', async () => {
    const json =
      '{"diagnostic":{"certain":true},"relance":{"titre":"Relancer","echeance":"2026-12-03","certain":false}}';
    const lancer = vi.fn(rend('Voici :\n```json\n' + json + '\n```'));
    expect(await lireSuite(v, 'Compte rendu fictif.', 'c', lancer, ressources)).toEqual(
      JSON.parse(json),
    );
    const prompt = lancer.mock.calls[0]?.[1][1] ?? '';
    expect(prompt).toContain('19/11/2026');
    expect(prompt).toContain('Jeanne Exemple');
    expect(prompt).toContain('Compte rendu fictif.');
  });

  it('rend null quand Claude échoue, répond autre chose que du JSON, ou ne voit aucune suite', async () => {
    for (const lancer of [rend('', 1), rend('Rien de précis.'), rend('{"truc":')])
      expect(await lireSuite(v, 'CR', 'c', lancer, ressources)).toBeNull();
    expect(await lireSuite(v, 'CR', 'c', rend('{}'), ressources)).toBeNull();
  });

  it('rend null sans prompt de suite sur le poste, sans appeler Claude', async () => {
    const lancer = vi.fn(rend('{"diagnostic":{"certain":true}}'));
    const sans: Ressources = { ...ressources, suite: undefined };
    expect(await lireSuite(v, 'CR', 'c', lancer, sans)).toBeNull();
    expect(lancer).not.toHaveBeenCalled();
  });
});

describe('decouperEnBlocs', () => {
  it('coupe aux changements de réplique, sans rien perdre ni couper une ligne', () => {
    const lignes = Array.from({ length: 10 }, (_, i) => `Moi : ligne ${i} ${'x'.repeat(20)}`);
    const blocs = decouperEnBlocs(lignes.join('\n'), 100);
    expect(blocs.length).toBeGreaterThan(1);
    expect(blocs.join('\n')).toBe(lignes.join('\n'));
    for (const b of blocs) expect(b.length).toBeLessThanOrEqual(100);
  });
});

describe('rediger', () => {
  const visio = { ...attente, ...meta };

  it('court : un seul appel avec le transcript', async () => {
    const lancer = vi.fn<LancerTexte>(() => Promise.resolve({ code: 0, stdout: 'CR' }));
    expect(await rediger(visio, 'c', lancer, ressources)).toBe('CR');
    expect(lancer).toHaveBeenCalledTimes(1);
    expect(lancer.mock.calls[0]?.[1][1]).toContain('# Transcription brute');
  });

  it('long : extraction de chaque bloc, puis rédaction à partir des notes', async () => {
    const long = Array.from(
      { length: 4 },
      (_, i) => `Autres : ${'a'.repeat(TAILLE_BLOC - 100)}${i}`,
    );
    const lancer = vi.fn<LancerTexte>((_c, args) =>
      Promise.resolve({
        code: 0,
        stdout: args[1]?.startsWith('Extrais') ? 'note du bloc' : 'CR final',
      }),
    );
    const r = await rediger({ ...visio, transcript: long.join('\n') }, 'c', lancer, ressources);
    expect(r).toBe('CR final');
    const prompts = lancer.mock.calls.map((c) => c[1][1] ?? '');
    expect(prompts.filter((p) => p.startsWith('Extrais'))).toHaveLength(4);
    const final = prompts[prompts.length - 1] ?? '';
    expect(final).toContain('## Bloc 4 sur 4');
    expect(final).toContain("Notes d'extraction");
    expect(final).not.toContain('a'.repeat(100));
  });

  it('long : un bloc qui échoue fait échouer la rédaction, sans appel final', async () => {
    const long = Array.from({ length: 4 }, () => `Autres : ${'a'.repeat(TAILLE_BLOC - 100)}`);
    const lancer = vi.fn<LancerTexte>(() => Promise.resolve({ code: 1, stdout: '' }));
    expect(await rediger({ ...visio, transcript: long.join('\n') }, 'c', lancer, ressources)).toBe(
      null,
    );
    expect(lancer).toHaveBeenCalledTimes(1);
  });
});

describe('passerResumes', () => {
  const api = (liste: unknown[], rendus: unknown[] = []) =>
    vi.fn((chemin: string, corps?: unknown) => {
      if (corps === undefined) return Promise.resolve(liste);
      rendus.push({ chemin, corps });
      return Promise.resolve({ ok: true });
    });

  it('rend à l’OS le résumé rédigé, sans espaces superflus', async () => {
    const rendus: unknown[] = [];
    const lancer: LancerTexte = () => Promise.resolve({ code: 0, stdout: '\n Résumé fictif. \n' });
    const n = await passerResumes(
      api([attente], rendus) as never,
      'claude-fictif',
      lancer,
      () => 0,
      ressources,
    );
    expect(n).toBe(1);
    expect(rendus).toEqual([
      { chemin: '/api/runner/resumes/s1', corps: { instance: 'inst', resume: 'Résumé fictif.' } },
    ]);
  });

  it('joint la suite lue dans le compte rendu ; sans suite lisible, le résumé part seul', async () => {
    const rendus: unknown[] = [];
    const lancer: LancerTexte = (_c, args) =>
      Promise.resolve({
        code: 0,
        stdout: args[1]?.startsWith('Suite') ? '{"diagnostic":{"certain":true}}' : 'Résumé fictif.',
      });
    await passerResumes(api([attente], rendus) as never, 'c', lancer, () => 0, ressources);
    expect(rendus).toEqual([
      {
        chemin: '/api/runner/resumes/s1',
        corps: {
          instance: 'inst',
          resume: 'Résumé fictif.',
          suite: { diagnostic: { certain: true } },
        },
      },
    ]);
  });

  it('ne rend rien quand Claude échoue, et n’insiste pas avant dix minutes', async () => {
    const rendus: unknown[] = [];
    const lancer = vi.fn<LancerTexte>(() => Promise.resolve({ code: 1, stdout: '' }));
    let heure = 1_000_000;
    const passe = () =>
      passerResumes(
        api([{ ...attente, id: 's2' }], rendus) as never,
        'claude-fictif',
        lancer,
        () => heure,
        ressources,
      );
    await passe();
    await passe();
    expect(lancer).toHaveBeenCalledTimes(1);
    heure += 11 * 60_000;
    await passe();
    expect(lancer).toHaveBeenCalledTimes(2);
    expect(rendus).toEqual([]);
  });
});
