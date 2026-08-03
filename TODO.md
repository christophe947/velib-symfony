# 🚲 Vélib Symfony

## Version actuelle

v0.3.0 - Carte + UX en cours

---

## ✅ Fait

* [x] Symfony 8.1
* [x] Git configuré
* [x] Branches Git (develop / feature)
* [x] Bootstrap installé
* [x] API Vélib connectée
* [x] Service VelibApiService
* [x] Liste des stations
* [x] Cards Bootstrap
* [x] Recherche instantanée
* [x] Recherche par nom
* [x] Recherche par adresse (si disponible)
* [x] Statut disponibilité vélo
* [x] Statut retour borne
* [x] Carte Leaflet affichée
* [x] Page carte séparée
* [x] Marqueurs personnalisés
* [x] Couleurs marqueurs selon disponibilité
* [x] Légende carte
* [x] Navigation active selon la page
* [x] Page accueil UX

---

## 🔜 En cours

✨ Idées UX

☑️ Badge popup selon mode
☑️ Hover desktop liste → marker
☑️ Footer
☑️ Responsive mobile
☑️ Animation sélection station
☑️ Favoris (V2)
☑️ Géolocalisation (V2)
☑️ Itinéraires (V4)

### Recherche stations

* [ ] Tri alphabétique
* [ ] Pagination des stations
* [ ] Filtres avancés

### Données stations

* [ ] Reverse geocoding (lat/long → adresse)
* [ ] Cache des adresses

### Carte UX

* [ ] Carte plein écran
* [ ] Panneau informations station
* [ ] Synchronisation liste ↔ carte
* [ ] Responsive mobile

### Pagination UX

* [ ] Ajouter pagination avancée
  Exemple : ‹ 1 ... 35 ... 70 ›
* [ ] Ajouter précédent / suivant avec texte

---

# 🚀 Après V1

* [ ] Docker
* [ ] Déploiement
* [ ] PWA mobile

---

# V2

* [ ] Comptes utilisateurs
* [ ] Favoris stations
* [ ] Géolocalisation utilisateur
* [ ] Distance utilisateur ↔ stations
* [ ] Rafraîchissement automatique des disponibilités
* [ ] Statistiques

---

# V3 - Assistant mobilité Vélib

* [ ] Recherche par destination
* [ ] Géocodage adresse → coordonnées GPS
* [ ] Recherche de stations proches d'un point donné
* [ ] Classement des meilleures stations selon :
  - distance
  - vélos disponibles
  - places disponibles
* [ ] Affichage de la position utilisateur sur la carte
* [ ] Calcul d'itinéraire jusqu'à une station
* [ ] Affichage du trajet directement dans Leaflet
* [ ] Choix du mode de déplacement :
  - piéton
  - vélo
  - Vélib
* [ ] Itinéraire complet Vélib :
  - marche jusqu'à la station de départ
  - trajet vélo
  - marche finale jusqu'à destination

---

# V4 - Fonctionnalités avancées

* [ ] Optimisation du choix station départ / arrivée
* [ ] Suggestions intelligentes selon la destination
* [ ] Historique des trajets
* [ ] Alertes disponibilité station favorite
* [ ] Mode mobile avancé type application de mobilité
* [ ] itineraire adresse astation / trajet complet velib gps ( bike mode)

---

## Notes

Projet portfolio Symfony moderne.

Objectif long terme :
Créer un assistant Vélib complet combinant données temps réel, carte interactive, géolocalisation et calcul d'itinéraires.



🚲 Vélib Tracker
Version actuelle

v1.0.0 - Prêt pour le déploiement

✅ V1.0 terminée
Projet
 Symfony 8
 Git (develop / feature)
 Bootstrap
 Leaflet
 Architecture JS modulaire
 Déploiement GitHub
API
 Connexion API Vélib
 VelibApiService
 Récupération des stations
Carte
 Carte Leaflet
 Marqueurs personnalisés
 Couleurs selon le pourcentage de disponibilité
 Deux modes :
🚲 Prendre
🅿️ Rendre
 Légende dynamique
 Synchronisation carte ↔ panneau station
 Synchronisation recherche ↔ carte
 Animation de sélection
 Hover desktop recherche → marqueur
 Responsive desktop/mobile
Recherche
 Recherche instantanée
 Recherche par nom
 Recherche par adresse API
Interface
 Page d'accueil
 Navigation active
 Footer
 Panneau d'informations station

🚀 V1.1
Données
 Reverse geocoding
 Cache des adresses
 Affichage des vélos :
électriques ⚡
mécaniques 🚲
 Rafraîchissement automatique des disponibilités
Recherche
 Recherche par adresse complète
 Recherche par arrondissement
 Recherche par ville

🚀 V1.2
 Géolocalisation utilisateur
 Stations proches
 Carte plein écran
 PWA

🚀 V1.3
 Docker
 Déploiement Docker
 CI/CD GitHub Actions

🚀 V2
 Comptes utilisateurs
 Favoris
 Synchronisation des favoris
 Statistiques
 Historique
 
🚀 V3 — Assistant mobilité
 Recherche par destination
 Géocodage adresse → GPS
 Recherche des meilleures stations
 Classement intelligent
 Calcul d'itinéraires
 Marche + Vélib + marche
 Affichage complet dans Leaflet
💡 Idées à conserver
 Hover sur les marqueurs (desktop uniquement selon le niveau de zoom)
 Popups légers au survol
 Optimisations des performances
 Animations UI
 Mode sombre
 Tests automatisés