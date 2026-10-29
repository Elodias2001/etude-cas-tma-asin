import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validerPriseRendezVous,
  validerAnnulation,
  validerChangementStatut,
  listerRendezVousUsager,
  MESSAGES,
  type RendezVous,
} from '../src/regles.ts';

const rdv = (id: number, npi: string, dateHeure: string, statut: RendezVous['statut'], service: RendezVous['service'] = 'CNI'): RendezVous => ({
  id, npi, service, dateHeure, statut,
});

// L'export a été réalisé le vendredi 20/11/2026 à 18 h : c'est « maintenant » dans les cas rejoués.
const EXPORT = '2026-11-20T18:00';

// --- TMA-101 : rendez-vous un samedi --------------------------------------
test('TMA-101 : un rendez-vous le samedi 14/11/2026 est refusé (centre fermé)', () => {
  const r = validerPriseRendezVous(
    { npi: '0614253647', service: 'PASSEPORT', dateHeure: '2026-11-14T10:00' },
    [],
    '2026-11-09T23:59',
  );
  assert.deepEqual(r, { ok: false, code: 409, message: MESSAGES.weekEnd });
  assert.equal(MESSAGES.weekEnd, 'Le centre est fermé le week-end.');
});

test('TMA-101 : le dimanche est refusé aussi, le vendredi est accepté', () => {
  const demande = (dateHeure: string) => ({ npi: '0614253647', service: 'PASSEPORT', dateHeure });
  assert.equal(validerPriseRendezVous(demande('2026-11-15T10:00'), [], '2026-11-09T09:00').ok, false);
  assert.equal(validerPriseRendezVous(demande('2026-11-13T10:00'), [], '2026-11-09T09:00').ok, true);
});

// --- TMA-102 : créneau plein ------------------------------------------------
test('TMA-102 : un 4e rendez-vous sur le créneau du 10/11/2026 à 9 h est refusé', () => {
  const existants = [
    rdv(632, '0638958971', '2026-11-10T09:00', 'confirme', 'PASSEPORT'),
    rdv(644, '0671968463', '2026-11-10T09:00', 'confirme', 'CNI'),
    rdv(681, '0609394161', '2026-11-10T09:00', 'confirme', 'PERMIS'),
  ];
  const r = validerPriseRendezVous(
    { npi: '0620214467', service: 'PERMIS', dateHeure: '2026-11-10T09:00' },
    existants,
    '2026-11-04T23:43',
  );
  assert.deepEqual(r, { ok: false, code: 409, message: MESSAGES.creneauPlein });
});

test('TMA-102 : un rendez-vous annulé libère sa place', () => {
  const existants = [
    rdv(1, '0000000001', '2026-11-10T09:00', 'confirme'),
    rdv(2, '0000000002', '2026-11-10T09:00', 'confirme'),
    rdv(3, '0000000003', '2026-11-10T09:00', 'annule'),
  ];
  const r = validerPriseRendezVous({ npi: '0620214467', service: 'CNI', dateHeure: '2026-11-10T09:00' }, existants, '2026-11-04T10:00');
  assert.equal(r.ok, true);
});

// --- TMA-103 : NPI illisible ----------------------------------------------
test('TMA-103 : un NPI avec une lettre donne un 400 expliqué, pas une erreur interne', () => {
  const r = validerPriseRendezVous(
    { npi: '06142A3647', service: 'CNI', dateHeure: '2026-11-23T09:00' },
    [],
    '2026-11-20T18:00',
  );
  assert.deepEqual(r, { ok: false, code: 400, message: 'Le NPI doit comporter exactement 10 chiffres.' });
});

test('TMA-103 : 9, 11 et 12 chiffres, vide, nombre et absent sont refusés sans exception', () => {
  for (const npi of ['061425364', '01234567890', '061425364711', '', 614253647, undefined, null]) {
    const r = validerPriseRendezVous({ npi, service: 'CNI', dateHeure: '2026-11-23T09:00' }, [], EXPORT);
    assert.deepEqual(r, { ok: false, code: 400, message: MESSAGES.npiInvalide }, `NPI ${String(npi)}`);
  }
});

// --- TMA-104 : annulation à 40 h -----------------------------------------
test('TMA-104 : annuler le 17/11 à 18 h un rendez-vous du 19/11 à 10 h (40 h avant) est accepté', () => {
  const r = validerAnnulation(rdv(709, '0339205992', '2026-11-19T10:00', 'confirme', 'PERMIS'), '2026-11-17T18:00');
  assert.deepEqual(r, { ok: true, valeur: { statut: 'annule' } });
});

test('TMA-104 : la limite est à 24 h pile (autorisé), 23 h 59 est refusé', () => {
  const unRdv = rdv(1, '0000000001', '2026-11-19T10:00', 'confirme');
  assert.equal(validerAnnulation(unRdv, '2026-11-18T10:00').ok, true);
  assert.deepEqual(validerAnnulation(unRdv, '2026-11-18T10:01'), { ok: false, code: 409, message: MESSAGES.annulationTardive });
});

test('annulation : un rendez-vous déjà honoré, absent ou annulé ne peut plus être annulé', () => {
  for (const statut of ['honore', 'absent', 'annule'] as const) {
    const r = validerAnnulation(rdv(1, '0000000001', '2026-12-10T10:00', statut), '2026-11-20T18:00');
    assert.deepEqual(r, { ok: false, code: 409, message: MESSAGES.annulationNonConfirme });
  }
});

// --- TMA-105 : statut d'un rendez-vous annulé -------------------------------
test('TMA-105 : le rendez-vous annulé n° 292 ne peut pas passer à « honore »', () => {
  const r = validerChangementStatut(rdv(292, '0330677555', '2026-11-12T10:00', 'annule', 'PASSEPORT'), 'honore');
  assert.deepEqual(r, { ok: false, code: 409, message: 'Ce rendez-vous est déjà clôturé.' });
});

test('statut : un confirmé passe à honore ou absent, un statut inconnu est un 400', () => {
  const confirme = rdv(1, '0000000001', '2026-11-12T10:00', 'confirme');
  assert.equal(validerChangementStatut(confirme, 'honore').ok, true);
  assert.equal(validerChangementStatut(confirme, 'absent').ok, true);
  assert.deepEqual(validerChangementStatut(confirme, 'annule'), { ok: false, code: 400, message: MESSAGES.statutInconnu });
  assert.deepEqual(validerChangementStatut(confirme, 'xyz'), { ok: false, code: 400, message: 'Statut invalide : honore ou absent.' });
  const honore = rdv(2, '0000000002', '2026-11-12T10:00', 'honore');
  assert.deepEqual(validerChangementStatut(honore, 'absent'), { ok: false, code: 409, message: MESSAGES.dejaCloture });
});

// --- TMA-106 : tri et pagination -------------------------------------------
// Les 13 rendez-vous réels de l'usager 0203040506 dans l'export.
const USAGER_106 = '0203040506';
const rdvs106: RendezVous[] = [
  rdv(1, USAGER_106, '2026-01-05T08:30', 'honore', 'PASSEPORT'),
  rdv(2, USAGER_106, '2026-02-12T10:00', 'honore', 'CNI'),
  rdv(3, USAGER_106, '2026-03-03T14:30', 'absent', 'PERMIS'),
  rdv(4, USAGER_106, '2026-04-21T09:00', 'honore', 'PASSEPORT'),
  rdv(5, USAGER_106, '2026-05-08T11:30', 'honore', 'CNI'),
  rdv(6, USAGER_106, '2026-05-19T15:00', 'absent', 'PERMIS'),
  rdv(7, USAGER_106, '2026-06-02T08:00', 'honore', 'PASSEPORT'),
  rdv(8, USAGER_106, '2026-06-16T13:30', 'honore', 'CNI'),
  rdv(9, USAGER_106, '2026-07-07T10:30', 'honore', 'PERMIS'),
  rdv(10, USAGER_106, '2026-07-28T09:30', 'absent', 'PASSEPORT'),
  rdv(11, USAGER_106, '2026-08-11T14:00', 'honore', 'CNI'),
  rdv(259, USAGER_106, '2026-09-25T11:00', 'honore', 'PERMIS'),
  rdv(826, USAGER_106, '2026-12-02T08:30', 'confirme', 'PASSEPORT'),
  rdv(900, '0999999999', '2026-12-03T08:30', 'confirme'), // un autre usager, ne doit pas apparaître
];

test('TMA-106 : le prochain rendez-vous (02/12/2026) est en tête de la page 1', () => {
  const p = listerRendezVousUsager(rdvs106, USAGER_106, 1, EXPORT);
  assert.equal(p.total, 13);
  assert.equal(p.parPage, 10);
  assert.equal(p.rendezVous.length, 10);
  assert.equal(p.rendezVous[0].dateHeure, '2026-12-02T08:30');
});

test('TMA-106 : après le prochain rendez-vous, ordre décroissant réel (pas alphabétique) ; 3 éléments en page 2', () => {
  const p1 = listerRendezVousUsager(rdvs106, USAGER_106, 1, EXPORT);
  const p2 = listerRendezVousUsager(rdvs106, USAGER_106, 2, EXPORT);
  const dates = [...p1.rendezVous, ...p2.rendezVous].map((r) => r.dateHeure);
  assert.deepEqual(dates, [
    '2026-12-02T08:30', '2026-09-25T11:00', '2026-08-11T14:00', '2026-07-28T09:30', '2026-07-07T10:30',
    '2026-06-16T13:30', '2026-06-02T08:00', '2026-05-19T15:00', '2026-05-08T11:30', '2026-04-21T09:00',
    '2026-03-03T14:30', '2026-02-12T10:00', '2026-01-05T08:30',
  ]);
  assert.equal(p2.rendezVous.length, 3);
  assert.ok(p1.rendezVous.every((r) => r.npi === USAGER_106));
});

test('liste : une page absente ou invalide est ramenée à la page 1', () => {
  for (const page of [0, -3, 1.5, Number.NaN]) {
    assert.equal(listerRendezVousUsager(rdvs106, USAGER_106, page, EXPORT).page, 1);
  }
});

// --- TMA-107 : comportement conforme ---------------------------------------
test('TMA-107 (conforme) : un usager avec un rendez-vous confirmé à venir ne peut pas en prendre un second', () => {
  const existants = [rdv(800, '0102030405', '2026-11-26T10:00', 'confirme', 'PASSEPORT')];
  const r = validerPriseRendezVous({ npi: '0102030405', service: 'PERMIS', dateHeure: '2026-11-27T09:00' }, existants, EXPORT);
  assert.deepEqual(r, { ok: false, code: 409, message: 'Vous avez déjà un rendez-vous à venir.' });
});

test('TMA-107 : un rendez-vous annulé ou passé ne bloque pas une nouvelle prise', () => {
  const demande = { npi: '0102030405', service: 'PERMIS', dateHeure: '2026-11-27T09:00' };
  const annule = [rdv(1, '0102030405', '2026-11-26T10:00', 'annule')];
  const passe = [rdv(2, '0102030405', '2026-10-01T10:00', 'honore')];
  assert.equal(validerPriseRendezVous(demande, annule, EXPORT).ok, true);
  assert.equal(validerPriseRendezVous(demande, passe, EXPORT).ok, true);
});

// --- Autres règles de la section 2 -----------------------------------------
test('service inconnu, date illisible, date passée, heure hors grille', () => {
  const base = { npi: '0614253647', service: 'CNI', dateHeure: '2026-11-23T09:00' };
  const verifier = (demande: object, attendu: { code: 400 | 409; message: string }) =>
    assert.deepEqual(validerPriseRendezVous({ ...base, ...demande }, [], EXPORT), { ok: false, ...attendu });

  verifier({ service: 'VISA' }, { code: 400, message: MESSAGES.serviceInconnu });
  verifier({ dateHeure: '23/11/2026 09:00' }, { code: 400, message: MESSAGES.dateIllisible });
  verifier({ dateHeure: '2026-02-30T09:00' }, { code: 400, message: MESSAGES.dateIllisible });
  verifier({ dateHeure: '2026-11-23T09:00:15' }, { code: 400, message: MESSAGES.dateIllisible });
  verifier({ dateHeure: '2026-11-19T09:00' }, { code: 409, message: MESSAGES.datePassee });
  verifier({ dateHeure: '2026-11-23T07:30' }, { code: 409, message: MESSAGES.heureHorsGrille });
  verifier({ dateHeure: '2026-11-23T16:00' }, { code: 409, message: MESSAGES.heureHorsGrille });
  verifier({ dateHeure: '2026-11-23T09:15' }, { code: 409, message: MESSAGES.heureHorsGrille });
});

test('les créneaux de 08:00 à 15:30 toutes les 30 minutes sont acceptés', () => {
  for (const heure of ['08:00', '08:30', '12:00', '15:00', '15:30']) {
    const r = validerPriseRendezVous({ npi: '0614253647', service: 'CNI', dateHeure: `2026-11-23T${heure}` }, [], EXPORT);
    assert.equal(r.ok, true, heure);
  }
});
