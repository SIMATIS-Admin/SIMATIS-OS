import type { Brouillon, Evenement, Fil } from '../connecteurs/google/google.js';

// What the Inbox routine reads in the pilot's tools, filtered here so the rules are tested once:
// only the instance's known people, only after a working day, only meetings with outsiders.

const FUSEAU = 'Europe/Paris';
const JOUR = 864e5;

// Free mail providers: their domain says nothing about the company someone works for.
const GENERIQUES = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'yahoo.com',
  'yahoo.fr',
  'icloud.com',
  'orange.fr',
  'free.fr',
  'wanadoo.fr',
  'laposte.net',
]);

export type Annuaire = {
  contacts: { id: string; email: string | null; entrepriseId: string | null }[];
  entreprises: { id: string; domaine: string | null }[];
};

export type MailSansReponse = Fil & {
  lien: string;
  contactId: string | null;
  entrepriseId: string | null;
};

export type RendezVousPasse = {
  eventId: string;
  titre: string;
  debut: string;
  fin: string;
  participants: string[];
  lien: string | null;
  contactId: string | null;
  entrepriseId: string | null;
};

// « Paul Client <Paul@Client.example> » → paul@client.example.
export const adresseDe = (de: string | null): string | null => {
  if (!de) return null;
  const m = /<([^>]+)>/.exec(de);
  return (m?.[1] ?? de).trim().toLowerCase() || null;
};

export const domaineDe = (adresse: string) => adresse.split('@')[1]?.toLowerCase() ?? '';

const weekend = (d: Date) =>
  ['Sat', 'Sun'].includes(d.toLocaleDateString('en-US', { weekday: 'short', timeZone: FUSEAU }));

// True once a whole working day has gone by: Friday 10:00 waits until Monday 10:00.
export function plusDunJourOuvre(date: Date, maintenant: Date): boolean {
  let limite = new Date(date.getTime() + JOUR);
  while (weekend(limite)) limite = new Date(limite.getTime() + JOUR);
  return maintenant >= limite;
}

// The instance's contact with this address, else the company owning its (non generic) domain.
export function rattacher(
  adresse: string,
  a: Annuaire,
): { contactId: string | null; entrepriseId: string | null } | null {
  const contact = a.contacts.find((c) => c.email?.toLowerCase() === adresse);
  if (contact) return { contactId: contact.id, entrepriseId: contact.entrepriseId };
  const domaine = domaineDe(adresse);
  if (!domaine || GENERIQUES.has(domaine)) return null;
  const entreprise = a.entreprises.find((e) => e.domaine?.toLowerCase() === domaine);
  return entreprise ? { contactId: null, entrepriseId: entreprise.id } : null;
}

const lienGmail = (moi: string, ancre: string) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(moi)}#${ancre}`;

export function mailsARepondre(
  fils: Fil[],
  moi: string,
  a: Annuaire,
  maintenant: Date,
  lienFil = (threadId: string) => lienGmail(moi, `all/${threadId}`),
): MailSansReponse[] {
  return fils.flatMap((f) => {
    const de = adresseDe(f.de);
    const date = f.date ? new Date(f.date) : null;
    if (!de || de === moi.toLowerCase() || !date || Number.isNaN(date.getTime())) return [];
    if (!plusDunJourOuvre(date, maintenant)) return [];
    const lien = rattacher(de, a);
    return lien ? [{ ...f, lien: lienFil(f.threadId), ...lien }] : [];
  });
}

export function brouillonsAnciens(b: Brouillon[], jours: number, maintenant: Date): Brouillon[] {
  return b.filter((x) => {
    const date = x.date ? new Date(x.date) : null;
    return date !== null && maintenant.getTime() - date.getTime() > jours * JOUR;
  });
}

export function rendezVousExternes(
  evenements: Evenement[],
  domaineMoi: string,
  a: Annuaire,
  maintenant: Date,
): RendezVousPasse[] {
  return evenements.flatMap((e) => {
    if (e.journee || e.fin > maintenant) return [];
    const exterieurs = e.participants.filter((p) => domaineDe(p) !== domaineMoi.toLowerCase());
    if (exterieurs.length === 0) return [];
    const lien = exterieurs.map((p) => rattacher(p, a)).find((x) => x !== null) ?? null;
    return [
      {
        eventId: e.id,
        titre: e.titre,
        debut: e.debut.toISOString(),
        fin: e.fin.toISOString(),
        participants: exterieurs,
        lien: e.lien,
        contactId: lien?.contactId ?? null,
        entrepriseId: lien?.entrepriseId ?? null,
      },
    ];
  });
}
