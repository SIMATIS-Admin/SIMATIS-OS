import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { fetchMailsFiche, type Evenement, type KindFiche } from '../api.js';

type Contexte = { slug: string; kind: KindFiche; id: string };
const date = (at: string) =>
  new Date(at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export function texteMail(texte: string) {
  const doc = new DOMParser().parseFromString('', 'text/html');
  const zone = doc.createElement('textarea');
  // Decode entities without interpreting tags or inserting mail content into the page.
  zone.innerHTML = texte.replace(/</g, '&lt;');
  return zone.value;
}

export function documentMail(html: string) {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'base',
      'meta',
      'link',
      'video',
      'audio',
      'svg',
      'math',
    ],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'poster', 'background'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    if (!/^(https?:|mailto:)/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href');
  });
  doc.querySelectorAll('img').forEach((img) => {
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.getAttribute('src') ?? '')) {
      img.removeAttribute('src');
      img.setAttribute('alt', img.getAttribute('alt') || 'Image — ouvrir l’original pour la voir');
    }
  });
  // Outlook marks the start of quoted history, which continues in sibling nodes.
  const outlook = doc.querySelector('#divRplyFwdMsg');
  if (outlook) {
    const range = doc.createRange();
    range.setStartBefore(outlook);
    range.setEnd(doc.body, doc.body.childNodes.length);
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    summary.textContent = 'Afficher les messages cités';
    details.append(summary, range.extractContents());
    doc.body.append(details);
  }
  doc
    .querySelectorAll(
      '.gmail_quote, blockquote, .gmail_signature, #Signature, .moz-signature, .yahoo_quoted, .protonmail_quote, [type="cite"]',
    )
    .forEach((node) => {
      if (node.closest('details')) return;
      const details = doc.createElement('details');
      const summary = doc.createElement('summary');
      summary.textContent = node.matches('.gmail_signature, #Signature, .moz-signature')
        ? 'Afficher la signature'
        : 'Afficher les messages cités';
      node.replaceWith(details);
      details.append(summary, node);
    });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 Arial,sans-serif;color:#172b45;margin:16px;overflow-wrap:anywhere}img,table{max-width:100%}details{margin:12px 0}summary{cursor:pointer;color:#62748a}pre{white-space:pre-wrap}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
}

export function regrouperMails(events: Evenement[]) {
  const fils = new Map<string, Evenement[]>();
  for (const e of events) {
    if (!e.mail) continue;
    const groupe = fils.get(e.mail.fil) ?? [];
    groupe.push(e);
    fils.set(e.mail.fil, groupe);
  }
  return fils;
}

function MessageMail({
  message,
  contexte,
  dernier,
  precedent,
}: {
  message: Evenement;
  contexte: Contexte;
  dernier: boolean;
  precedent?: Evenement;
}) {
  const [ouvert, setOuvert] = useState(dernier);
  const [detail, setDetail] = useState<Evenement | null>(null);
  const [erreur, setErreur] = useState('');
  const [essai, setEssai] = useState(0);
  useEffect(() => {
    if (!ouvert || detail) return;
    let actuel = true;
    setErreur('');
    fetchMailsFiche(contexte.slug, contexte.kind, contexte.id, message.id).then(
      (r) => {
        if (!actuel) return;
        const mail = r.mails.find((e) => e.id === message.id);
        if (!mail?.mail?.charge) setErreur('Le contenu complet est indisponible.');
        else setDetail(mail);
      },
      () => actuel && setErreur('Impossible de charger ce message.'),
    );
    return () => {
      actuel = false;
    };
  }, [ouvert, detail, contexte.slug, contexte.kind, contexte.id, message.id, essai]);
  const mail = message.mail!;
  const reponse = mail.reponse || (precedent && mail.sens !== precedent.mail?.sens);
  return (
    <details
      className="fi-mail-message"
      open={ouvert}
      onToggle={(e) => setOuvert(e.currentTarget.open)}
    >
      <summary>
        <span className={`badge ${mail.sens === 'recu' ? 'blue' : ''}`}>
          {mail.sens === 'recu' ? 'Reçu' : 'Envoyé'}
        </span>
        {reponse && <span className="small muted">Réponse dans ce fil</span>}
        <span className="fi-mail-personne">{mail.de || 'Expéditeur inconnu'}</span>
        <time className="small muted" dateTime={message.at}>
          {date(message.at)}
        </time>
      </summary>
      {ouvert && (
        <div className="fi-mail-detail">
          <div className="small muted">
            De : {mail.de || '—'}
            <br />À : {mail.a || '—'}
            {mail.cc && (
              <>
                <br />
                Cc : {mail.cc}
              </>
            )}
            {message.compte && (
              <>
                <br />
                Boîte : {message.compte}
              </>
            )}
          </div>
          {erreur ? (
            <p role="alert">
              {erreur}{' '}
              <button className="btn" onClick={() => setEssai(essai + 1)}>
                Réessayer
              </button>
            </p>
          ) : !detail ? (
            <p role="status">Chargement du message…</p>
          ) : detail.mail?.html ? (
            <iframe
              title={`Contenu du mail : ${mail.objet}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="fi-mail-html"
              srcDoc={documentMail(detail.mail.html)}
            />
          ) : (
            <div className="fi-mail-texte">
              {detail.mail?.corps ||
                'Ce message ne contient pas de corps lisible. Ouvrez l’original pour consulter ses éventuelles pièces jointes.'}
            </div>
          )}
          {mail.lien && (
            <a href={mail.lien} target="_blank" rel="noreferrer">
              Ouvrir dans la messagerie ↗
            </a>
          )}
        </div>
      )}
    </details>
  );
}

export function ConversationMail({
  messages,
  contexte,
}: {
  messages: Evenement[];
  contexte: Contexte;
}) {
  const [ouvert, setOuvert] = useState(false);
  const tries = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const dernier = tries[tries.length - 1]!;
  const mail = dernier.mail!;
  const interlocuteurs = [
    ...new Set(tries.map((e) => (e.mail?.sens === 'recu' ? e.mail.de : e.mail?.a)).filter(Boolean)),
  ].join(', ');
  return (
    <li className="fi-mail-conversation">
      <details open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)}>
        <summary className="fi-mail-ligne">
          <b>{texteMail(mail.objet.replace(/^(?:(?:re|tr|fwd?)\s*:\s*)+/i, ''))}</b>
          <span className="fi-mail-personne muted">{interlocuteurs || 'Email'}</span>
          <span className="small">
            {messages.length} message{messages.length > 1 ? 's' : ''}
          </span>
          <span className="small muted">
            {mail.sens === 'recu' ? 'Dernier reçu' : 'Dernier envoyé'} · {date(dernier.at)}
          </span>
        </summary>
        {ouvert && (
          <div className="fi-mail-fil">
            <div className="small muted">
              Messages présents dans l’historique de cette fiche · images distantes bloquées
            </div>
            {tries.map((message, index) => (
              <MessageMail
                key={message.id}
                message={message}
                contexte={contexte}
                dernier={index === tries.length - 1}
                precedent={tries[index - 1]}
              />
            ))}
          </div>
        )}
      </details>
    </li>
  );
}
