/**
 * Règles de gestion de la prise de rendez-vous au guichet.
 *
 * Module pur : aucune base de données, aucun framework, aucune lecture de
 * l'horloge. L'heure courante est toujours passée en paramètre.
 *
 * Toutes les heures sont celles du Bénin (GMT+1). Elles sont manipulées comme
 * des heures « murales » (sans fuseau) au format AAAA-MM-JJTHH:MM, ce qui évite
 * toute conversion de fuseau : le module compare des heures du Bénin entre elles.
 */

export type Service = 'PASSEPORT' | 'CNI' | 'PERMIS';
export type Statut = 'confirme' | 'honore' | 'absent' | 'annule';

export interface RendezVous {
  id: number;
  npi: string;
  service: Service;
  /** AAAA-MM-JJTHH:MM, heure du Bénin. */
  dateHeure: string;
  statut: Statut;
}

export interface DemandeRendezVous {
  npi: unknown;
  service: unknown;
  dateHeure: unknown;
}

export type Resultat<T> =
  | { ok: true; valeur: T }
  | { ok: false; code: 400 | 409; message: string };

export const SERVICES: readonly Service[] = ['PASSEPORT', 'CNI', 'PERMIS'];
export const CAPACITE_CRENEAU = 3;
export const DELAI_ANNULATION_HEURES = 24;
export const PREMIER_CRENEAU = '08:00';
export const DERNIER_CRENEAU = '15:30';
export const TAILLE_PAGE = 10;

export const MESSAGES = {
  npiInvalide: 'Le NPI doit comporter exactement 10 chiffres.',
  serviceInconnu: 'Service inconnu : choisissez PASSEPORT, CNI ou PERMIS.',
  dateIllisible: 'Date et heure invalides (format attendu : AAAA-MM-JJTHH:MM).',
  datePassee: 'Impossible de prendre un rendez-vous dans le passé.',
  weekEnd: 'Le centre est fermé le week-end.',
  heureHorsGrille: 'Créneau invalide : de 08:00 à 15:30, toutes les 30 minutes.',
  dejaAVenir: 'Vous avez déjà un rendez-vous à venir.',
  creneauPlein: 'Ce créneau est complet.',
  annulationNonConfirme: 'Ce rendez-vous ne peut plus être annulé.',
  annulationTardive: 'Annulation impossible moins de 24 h avant le rendez-vous.',
  statutInconnu: 'Statut invalide : honore ou absent.',
  dejaCloture: 'Ce rendez-vous est déjà clôturé.',
} as const;

const refus = (code: 400 | 409, message: string): Resultat<never> => ({ ok: false, code, message });

// ---------------------------------------------------------------------------
// Dates : heures murales du Bénin, converties en millisecondes « naïves »
// ---------------------------------------------------------------------------

const FORMAT_DATE_HEURE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/;

/**
 * Lit AAAA-MM-JJTHH:MM (secondes facultatives, réservées à l'heure courante).
 * Renvoie null si le format est illisible ou si la date n'existe pas
 * (30 février, 25 h 00, etc.). Le résultat est un nombre de millisecondes
 * comparable à un autre, sans fuseau.
 */
export function lireDateHeure(texte: unknown): number | null {
  if (typeof texte !== 'string') return null;
  const m = FORMAT_DATE_HEURE.exec(texte);
  if (!m) return null;
  const [annee, mois, jour, heure, minute, seconde] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const ms = Date.UTC(annee, mois - 1, jour, heure, minute, seconde);
  const d = new Date(ms);
  const coherent =
    d.getUTCFullYear() === annee &&
    d.getUTCMonth() === mois - 1 &&
    d.getUTCDate() === jour &&
    d.getUTCHours() === heure &&
    d.getUTCMinutes() === minute &&
    d.getUTCSeconds() === seconde;
  return coherent ? ms : null;
}

const HEURE_EN_MS = 3_600_000;

function estWeekEnd(ms: number): boolean {
  const jour = new Date(ms).getUTCDay(); // 0 dimanche, 6 samedi
  return jour === 0 || jour === 6;
}

function estSurLaGrille(ms: number): boolean {
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const premier = 8 * 60;
  const dernier = 15 * 60 + 30;
  return d.getUTCSeconds() === 0 && minutes >= premier && minutes <= dernier && minutes % 30 === 0;
}

/** Un rendez-vous est « à venir » s'il est confirmé et n'est pas dans le passé. */
function estAVenir(rdv: RendezVous, maintenantMs: number): boolean {
  const ms = lireDateHeure(rdv.dateHeure);
  return rdv.statut === 'confirme' && ms !== null && ms >= maintenantMs;
}

// ---------------------------------------------------------------------------
// Prise de rendez-vous
// ---------------------------------------------------------------------------

export interface RendezVousValide {
  npi: string;
  service: Service;
  dateHeure: string;
}

/**
 * Contrôle une demande de prise de rendez-vous.
 *
 * Ordre des contrôles (le premier qui échoue est renvoyé) : NPI, service,
 * lisibilité de la date, date passée, week-end, grille horaire, rendez-vous
 * déjà à venir, créneau plein.
 *
 * @param existants rendez-vous déjà connus (tous usagers, tous statuts)
 * @param maintenant heure courante au format AAAA-MM-JJTHH:MM[:SS], heure du Bénin
 */
export function validerPriseRendezVous(
  demande: DemandeRendezVous,
  existants: readonly RendezVous[],
  maintenant: string,
): Resultat<RendezVousValide> {
  const maintenantMs = lireDateHeure(maintenant);
  if (maintenantMs === null) throw new RangeError(`Heure courante illisible : ${String(maintenant)}`);

  const { npi, service, dateHeure } = demande;

  if (typeof npi !== 'string' || !/^[0-9]{10}$/.test(npi)) return refus(400, MESSAGES.npiInvalide);
  if (typeof service !== 'string' || !(SERVICES as readonly string[]).includes(service)) {
    return refus(400, MESSAGES.serviceInconnu);
  }

  const dateMs = lireDateHeure(dateHeure);
  if (dateMs === null || typeof dateHeure !== 'string' || dateHeure.length !== 16) {
    return refus(400, MESSAGES.dateIllisible);
  }

  if (dateMs < maintenantMs) return refus(409, MESSAGES.datePassee);
  if (estWeekEnd(dateMs)) return refus(409, MESSAGES.weekEnd);
  if (!estSurLaGrille(dateMs)) return refus(409, MESSAGES.heureHorsGrille);

  if (existants.some((r) => r.npi === npi && estAVenir(r, maintenantMs))) {
    return refus(409, MESSAGES.dejaAVenir);
  }

  const occupes = existants.filter((r) => r.statut !== 'annule' && lireDateHeure(r.dateHeure) === dateMs).length;
  if (occupes >= CAPACITE_CRENEAU) return refus(409, MESSAGES.creneauPlein);

  return { ok: true, valeur: { npi, service: service as Service, dateHeure } };
}

// ---------------------------------------------------------------------------
// Annulation
// ---------------------------------------------------------------------------

/**
 * Contrôle l'annulation d'un rendez-vous par l'usager.
 * Seul un rendez-vous confirmé peut être annulé, et au plus tard 24 h avant
 * l'heure prévue : exactement 24 h avant est encore autorisé.
 */
export function validerAnnulation(rdv: RendezVous, maintenant: string): Resultat<{ statut: 'annule' }> {
  const maintenantMs = lireDateHeure(maintenant);
  if (maintenantMs === null) throw new RangeError(`Heure courante illisible : ${String(maintenant)}`);

  if (rdv.statut !== 'confirme') return refus(409, MESSAGES.annulationNonConfirme);

  const rdvMs = lireDateHeure(rdv.dateHeure);
  if (rdvMs === null) throw new RangeError(`Date du rendez-vous illisible : ${rdv.dateHeure}`);

  if (rdvMs - maintenantMs < DELAI_ANNULATION_HEURES * HEURE_EN_MS) {
    return refus(409, MESSAGES.annulationTardive);
  }
  return { ok: true, valeur: { statut: 'annule' } };
}

// ---------------------------------------------------------------------------
// Changement de statut par un agent
// ---------------------------------------------------------------------------

/**
 * Contrôle le passage d'un rendez-vous confirmé à « honore » ou « absent ».
 * Les statuts honore, absent et annule sont définitifs.
 * Le statut demandé est vérifié avant l'état du rendez-vous.
 */
export function validerChangementStatut(
  rdv: RendezVous,
  statutDemande: unknown,
): Resultat<{ statut: 'honore' | 'absent' }> {
  if (statutDemande !== 'honore' && statutDemande !== 'absent') return refus(400, MESSAGES.statutInconnu);
  if (rdv.statut !== 'confirme') return refus(409, MESSAGES.dejaCloture);
  return { ok: true, valeur: { statut: statutDemande } };
}

// ---------------------------------------------------------------------------
// Liste des rendez-vous d'un usager
// ---------------------------------------------------------------------------

export interface PageRendezVous {
  page: number;
  parPage: number;
  total: number;
  rendezVous: RendezVous[];
}

/**
 * Rendez-vous d'un usager : le prochain rendez-vous (confirmé, à venir) en
 * tête, puis tous les autres du plus récent au plus ancien. Le tri porte sur
 * la date réelle, jamais sur un texte formaté.
 * Une page invalide (absente, < 1, non entière) est ramenée à 1.
 */
export function listerRendezVousUsager(
  rendezVous: readonly RendezVous[],
  npi: string,
  page: number,
  maintenant: string,
  parPage: number = TAILLE_PAGE,
): PageRendezVous {
  const maintenantMs = lireDateHeure(maintenant);
  if (maintenantMs === null) throw new RangeError(`Heure courante illisible : ${String(maintenant)}`);

  const ms = (r: RendezVous): number => {
    const v = lireDateHeure(r.dateHeure);
    if (v === null) throw new RangeError(`Date du rendez-vous illisible : ${r.dateHeure}`);
    return v;
  };

  const siens = rendezVous.filter((r) => r.npi === npi);
  const aVenir = siens.filter((r) => estAVenir(r, maintenantMs)).sort((a, b) => ms(a) - ms(b));
  const autres = siens.filter((r) => !estAVenir(r, maintenantMs)).sort((a, b) => ms(b) - ms(a));
  const tous = [...aVenir, ...autres];

  const pageValide = Number.isInteger(page) && page >= 1 ? page : 1;
  const debut = (pageValide - 1) * parPage;
  return { page: pageValide, parPage, total: tous.length, rendezVous: tous.slice(debut, debut + parPage) };
}
