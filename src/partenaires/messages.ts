import { note, type Message } from 'os-agents-relay';
import { TYPES_MESSAGE, type TypeMessage } from './schema.js';

export type MessageLibre = {
  id: string;
  type: TypeMessage;
  sujet: string;
  texte: string;
  enReponseA: string | null;
};

// A free Markdown message, outside any mission: the rules of the shared space's `echanges/`
// folder (a type, a one-line subject, the message it answers).
export function messageLibre(m: {
  type: TypeMessage;
  sujet: string;
  texte: string;
  enReponseA?: string | null;
}): Message {
  return {
    ...note({ texte: m.texte }),
    metadata: {
      type: m.type,
      sujet: m.sujet,
      ...(m.enReponseA ? { en_reponse_a: m.enReponseA } : {}),
    },
  };
}

export function lireMessageLibre(m: Message): MessageLibre {
  const texte = m.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n');
  const meta = m.metadata ?? {};
  const type = TYPES_MESSAGE.find((t) => t === meta.type) ?? 'info';
  const sujet =
    typeof meta.sujet === 'string' && meta.sujet.trim()
      ? meta.sujet.trim().slice(0, 200)
      : (texte.split('\n')[0]?.trim().slice(0, 160) ?? '');
  const enReponseA =
    typeof meta.en_reponse_a === 'string' && meta.en_reponse_a ? meta.en_reponse_a : null;
  return { id: m.messageId, type, sujet: sujet || '(sans sujet)', texte, enReponseA };
}
