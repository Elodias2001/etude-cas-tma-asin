# Étude de cas TMA : prise de rendez-vous au guichet

Module de règles de gestion (TypeScript, sans base de données ni framework), tests automatisés, requêtes d'impact et compte rendu des sept tickets.

## Lancer les tests

Prérequis : Node.js 22.18 ou plus (testé avec Node 26). Aucune dépendance à installer.

```bash
npm test
```

Résultat attendu : 18 tests, 18 réussis.

## Contenu

| Fichier | Rôle |
|---|---|
| `src/regles.ts` | Module de règles : prise de rendez-vous, annulation, changement de statut, liste paginée |
| `test/regles.test.ts` | Tests automatisés, au moins un par ticket |
| `requetes.sql` | Requêtes d'impact sur l'export (PostgreSQL) |

L'export `base_rendez_vous.sql` n'est pas versionné. Pour rejouer les requêtes : `psql -f base_rendez_vous.sql`, puis `psql -f requetes.sql`.

## Utiliser le module

Toutes les fonctions reçoivent l'heure courante en paramètre, au format `AAAA-MM-JJTHH:MM`, heure du Bénin. Elles renvoient `{ ok: true, valeur }` ou `{ ok: false, code, message }` avec le code HTTP et le message prévus.

```ts
validerPriseRendezVous({ npi, service, dateHeure }, rendezVousExistants, maintenant)
validerAnnulation(rendezVous, maintenant)
validerChangementStatut(rendezVous, statutDemande)
listerRendezVousUsager(rendezVous, npi, page, maintenant)
```

Ordre des contrôles d'une prise de rendez-vous : NPI, service, lisibilité de la date, date passée, week-end, grille horaire, rendez-vous déjà à venir, créneau plein.

## Les tickets

Les causes sont des hypothèses : le code de l'application n'est pas fourni, elles sont déduites des traces et de l'export.

### TMA-101 : rendez-vous pris un samedi

- **Qualification :** anomalie. Règle « le centre reçoit du lundi au vendredi ».
- **Cause probable :** le contrôle du jour de la semaine est absent. Le rendez-vous n° 742 du samedi 14/11/2026 a été créé le 09/11.
- **Correction :** refus 409 « Le centre est fermé le week-end. » (`estWeekEnd`).
- **Tests :** `TMA-101` (samedi, dimanche refusés, vendredi accepté).

### TMA-102 : quatre usagers sur un créneau de trois places

- **Qualification :** anomalie. Règle « un créneau accueille au plus 3 usagers ».
- **Cause probable :** le nombre de rendez-vous du créneau n'est pas contrôlé à la réservation, ou les annulés sont mal comptés. Les rendez-vous 632, 644, 681 et 697 du 10/11/2026 à 9 h sont tous non annulés.
- **Correction :** on compte les rendez-vous non annulés du créneau ; à 3, refus 409 « Ce créneau est complet. ». Un rendez-vous annulé libère sa place.
- **Tests :** `TMA-102` (4e refusé, un annulé libère sa place).

### TMA-103 : « Erreur interne du serveur » sur un NPI avec une lettre

- **Qualification :** anomalie. Règle « NPI composé d'exactement 10 chiffres » et « jamais par une erreur interne ».
- **Cause probable :** le NPI est converti ou traité comme un nombre avant d'être validé, d'où l'exception. L'export contient d'ailleurs deux NPI qui ne font pas 10 chiffres (n° 459 : 11 chiffres, n° 642 : 12), donc la longueur n'est pas non plus contrôlée.
- **Correction :** la validation se fait en premier, sur le texte, avec `^[0-9]{10}$` ; refus 400 « Le NPI doit comporter exactement 10 chiffres. » Aucune exception n'est levée sur une saisie utilisateur.
- **Tests :** `TMA-103` (lettre, 9, 11, 12 chiffres, vide, nombre, absent).

### TMA-104 : annulation refusée à 40 heures

- **Qualification :** anomalie. Règle « annuler jusqu'à 24 heures avant l'heure prévue ». Du 17/11 à 18 h au 19/11 à 10 h, il y a 40 heures.
- **Cause probable :** erreur de calcul du délai. Hypothèses : comparaison de l'heure du jour seule (18 h après 10 h) au lieu de la date complète, seuil de 48 h, ou comparaison des dates sans l'heure. La trace ne permet pas de trancher.
- **Correction :** le délai se calcule sur la date et l'heure complètes ; refus seulement si l'écart est strictement inférieur à 24 h, donc 24 h pile est autorisé.
- **Tests :** `TMA-104` (40 h accepté, 24 h pile accepté, 23 h 59 refusé).

### TMA-105 : un rendez-vous annulé passé à « honoré »

- **Qualification :** anomalie. Règle « honoré, absent et annulé sont des statuts définitifs ».
- **Cause probable :** le contrôle « déjà clôturé » ne couvre pas le statut `annule`. L'historique du rendez-vous 292 le confirme : confirmé → annulé (usager, 23/09), puis annulé → honoré (AG-04, 12/11).
- **Correction :** seul un rendez-vous confirmé peut changer de statut ; sinon 409 « Ce rendez-vous est déjà clôturé. ». Le statut demandé est vérifié avant (400 « Statut invalide : honore ou absent. »).
- **Tests :** `TMA-105` (annulé refusé) et le test de statuts.

### TMA-106 : le prochain rendez-vous n'est pas en tête de liste

- **Qualification :** anomalie. Règle « du plus récent au plus ancien, le prochain en tête, par pages de 10 ».
- **Cause probable :** le tri porte sur la date **formatée en texte** (JJ/MM/AAAA), pas sur la date. L'ordre de la trace (28/07, 25/09, 21/04, 19/05, 16/06, 12/02, 11/08, 08/05, 07/07…) est exactement l'ordre alphabétique décroissant du jour d'abord ; le 02/12 passe en 12e position, donc en page 2.
- **Correction :** tri sur la date réelle. Le prochain rendez-vous (confirmé, à venir) passe en tête, puis les autres du plus récent au plus ancien. Une page invalide est ramenée à 1.
- **Tests :** `TMA-106` rejoue les 13 rendez-vous réels de l'usager 0203040506 : le 02/12 est en tête, 10 éléments en page 1, 3 en page 2, ordre exact vérifié.

### TMA-107 : impossible de prendre un second rendez-vous

- **Qualification :** **conforme, pas une anomalie.** Règle « un usager ne peut avoir qu'un seul rendez-vous à venir, tous services confondus ». L'usager 0102030405 a le rendez-vous n° 800 (PASSEPORT, 26/11/2026, confirmé, créé le 16/11) : le refus est correct.
- **Correction :** aucune. Le module conserve ce comportement ; un rendez-vous annulé ou passé ne bloque pas une nouvelle prise.
- **Tests :** `TMA-107 (conforme)` et le test des rendez-vous annulés ou passés.

## Impact sur l'export (`requetes.sql`)

Export réalisé le vendredi 20/11/2026 à 18 h. Résultats obtenus avec PostgreSQL 18.

| Requête | Résultat |
|---|---|
| Confirmés à venir pris un samedi ou dimanche | 5 rendez-vous à prévenir : 680 (21/11), 730 (28/11), 834 et 857 (05/12), 874 (12/12) |
| Créneaux avec plus de 3 rendez-vous non annulés | 3 créneaux : 22/10 10:30 (502, 511, 517, 519), 10/11 09:00 (632, 644, 681, 697), 24/11 14:00 (728, 750, 763, 783) |
| Passés de « annulé » à un autre statut | 4 rendez-vous : 208, 231, 262, 292 |

Trois autres rendez-vous du week-end sont confirmés mais déjà passés au moment de l'export (475, 715, 742) : ils ne sont pas à venir, mais le dernier est celui du ticket TMA-101.

## Bonus : anomalies non signalées

Relevées sur l'export, et corrigées dans le module quand une règle existe.

1. **Heures hors grille** : 3 rendez-vous après 15 h 30 (n° 490 à 16:00, 698 à 16:30, 842 à 16:00). Le module refuse toute heure hors de 08:00-15:30 toutes les 30 minutes.
2. **Créneaux surchargés** : il y en a 3, pas un seul (voir ci-dessus). Le module plafonne à 3.
3. **NPI mal formés** : n° 459 (11 chiffres) et n° 642 (12 chiffres). Le module exige exactement 10 chiffres.
4. **Rendez-vous confirmés dont la date est passée, jamais clôturés** : n° 475, 715 et 742 (statut `confirme` alors que la date est antérieure à l'export). Un traitement de clôture ou de relance est à prévoir côté application ; le module ne les compte pas comme « à venir ».
5. **Transitions interdites** : les 4 passages de annulé vers honoré ou absent (voir ci-dessus).
