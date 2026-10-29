-- Requêtes d'impact sur l'export base_rendez_vous.sql (réalisé le vendredi 20/11/2026 à 18 h, heure du Bénin).
-- Écrites pour PostgreSQL. Équivalent SQLite signalé en commentaire quand il diffère.
-- Chargement : psql -f base_rendez_vous.sql

-- 1. Rendez-vous confirmés à venir pris un samedi ou un dimanche (usagers à prévenir).
--    « À venir » = postérieur à l'heure de l'export ; EXTRACT(DOW) : 0 dimanche, 6 samedi.
--    SQLite : strftime('%w', date_heure) IN ('0','6')
SELECT id, npi, service, date_heure
FROM rendez_vous
WHERE statut = 'confirme'
  AND date_heure >= TIMESTAMP '2026-11-20 18:00:00'
  AND EXTRACT(DOW FROM date_heure) IN (0, 6)
ORDER BY date_heure, id;

-- 2. Créneaux qui comptent plus de 3 rendez-vous non annulés.
--    SQLite : group_concat(id) au lieu de string_agg(id::text, ', ' ORDER BY id)
SELECT date_heure,
       COUNT(*)                            AS nb_rendez_vous,
       string_agg(id::text, ', ' ORDER BY id) AS ids
FROM rendez_vous
WHERE statut <> 'annule'
GROUP BY date_heure
HAVING COUNT(*) > 3
ORDER BY date_heure;

-- 3. Rendez-vous passés du statut « annulé » à un autre statut (transitions interdites).
SELECT h.rendez_vous_id, h.ancien_statut, h.nouveau_statut, h.modifie_le, h.modifie_par,
       r.npi, r.service, r.date_heure, r.statut AS statut_actuel
FROM historique_statuts h
JOIN rendez_vous r ON r.id = h.rendez_vous_id
WHERE h.ancien_statut = 'annule'
  AND h.nouveau_statut <> 'annule'
ORDER BY h.modifie_le;
