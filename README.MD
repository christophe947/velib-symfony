# 🚲 Velib Tracker

Application web permettant de consulter la disponibilité des stations Vélib en temps réel grâce à une carte interactive.

Le projet a pour objectif de proposer une expérience simple et rapide pour trouver un vélo ou une place disponible, tout en évoluant progressivement vers des fonctionnalités d'analyse du réseau.

## ✨ Fonctionnalités actuelles

* 🗺️ Carte interactive avec affichage des stations
* 🚲 Disponibilité des vélos en temps réel
* 🅿️ Nombre de places disponibles
* 🔎 Recherche de stations
* 📍 Focus automatique sur une station sélectionnée
* 🎨 Affichage dynamique selon le niveau de disponibilité
* 📱 Interface responsive adaptée mobile
* 👆 Interaction tactile optimisée
* 🔄 Gestion des états de recherche et navigation
* 📊 Affichage détaillé d'une station

## 🛠️ Technologies utilisées

### Backend

* PHP
* Symfony
* API Vélib

### Frontend

* JavaScript ES Modules
* Leaflet
* Bootstrap
* CSS responsive

### Outils

* Git / GitHub
* AssetMapper Symfony
* Apache
* o2switch (hébergement)

## 🏗️ Architecture du projet

Le JavaScript est organisé par responsabilités :

```
assets/js/

├── map.js
├── markers.js
├── search.js
├── searchResults.js
├── navigation.js
├── state.js
├── legend.js
└── stationPanel.js
```

Cette séparation permet de faire évoluer progressivement l'application sans mélanger la logique métier et l'affichage.

## 🚀 Installation locale

Cloner le projet :

```bash
git clone https://github.com/christophe947/velib-symfony.git
```

Installer les dépendances :

```bash
composer install
```

Configurer l'environnement :

```bash
cp .env .env.local
```

Créer la base de données si nécessaire :

```bash
php bin/console doctrine:migrations:migrate
```

Lancer le serveur Symfony :

```bash
symfony server:start
```

## 📦 Déploiement

Après une mise à jour :

```bash
git pull origin develop

php bin/console asset-map:compile
php bin/console cache:clear
```

## 🗺️ Roadmap

### Prochaines améliorations

* Affichage vélos électriques / mécaniques
* Géolocalisation utilisateur
* Recherche par adresse
* Calcul de distance utilisateur → station
* Temps de trajet estimé à pied / vélo
* Proposition de stations alternatives proches
* Stations favorites
* Historique de disponibilité
* Amélioration de l'expérience mobile avec panneau Offcanvas
* Optimisation SEO
* Progressive Web App (PWA)
* Navigation GPS vers une station sélectionnée / trajet jusqu'a la station de retour

### Évolutions possibles

* Analyse historique du réseau
* Détection d'anomalies
* Indicateur de fiabilité des vélos
* Statistiques et prédictions de disponibilité

## 🎯 Objectif du projet

Velib Tracker est un projet évolutif visant à transformer une simple consultation de disponibilité en un véritable outil d'aide à la mobilité urbaine.

L'objectif est de permettre aux utilisateurs de trouver facilement un vélo ou une place disponible dans une station, puis de les accompagner dans leurs déplacements grâce à des fonctionnalités de géolocalisation et de planification d'itinéraire.