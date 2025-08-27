# Plan d'Architecture Cible : Application de Pronostics Sportifs sur GCP

Ce document détaille l'architecture technique proposée pour l'application de pronostics sportifs. L'objectif est de construire un système modulaire, scalable et maintenable en utilisant exclusivement les services de Google Cloud Platform (GCP).

---

## 1. Principes Fondamentaux

L'architecture repose sur trois piliers essentiels pour garantir la flexibilité et l'efficacité du projet.

1.  **Architecture Microservices par Module Sportif** : Chaque sport (Football, Rugby, Baseball...) est traité comme un module verticalement intégré et indépendant. Ces modules ne partagent aucune base de code, ce qui permet des développements, déploiements et mises à l'échelle autonomes.
2.  **Approche *Serverless-First*** : Nous privilégions les services managés qui ne requièrent pas de gestion d'infrastructure (ex: Cloud Run, Cloud Functions, Firestore). Cette approche optimise les coûts en payant uniquement à l'usage et permet une mise à l'échelle automatique de zéro à N.
3.  **Pilotage par Événements (*Event-Driven*)** : Les processus lourds (backtesting, génération de prédictions) ne sont pas exécutés en temps réel lors d'une requête utilisateur. Ils sont déclenchés par des événements planifiés, ce qui rend le système plus robuste, découplé et performant.

---

## 2. Composants de l'Architecture

L'architecture se divise en deux catégories : les services spécifiques à chaque module sportif et les services transverses partagés par l'ensemble de la plateforme.

### 2.1. Structure d'un Module Sport (Ex: "Module Football")

Chaque module est une application autonome contenant sa propre logique métier, ses dépendances et ses ressources.

* **Logique de Calcul (Backtest & Prédiction)**
    * **Service GCP** : **Cloud Run Jobs**.
    * **Rôle** : Exécution des scripts de calcul intensif (`backtest-manager.js`, `prediction-manager.js`). Cloud Run Jobs est idéal pour des tâches conteneurisées qui s'exécutent jusqu'à leur terme puis s'arrêtent. Chaque sport possède son propre Job, garantissant une isolation complète.

* **Déclenchement des Calculs**
    * **Services GCP** : **Cloud Scheduler** + **Pub/Sub**.
    * **Rôle** :
        1.  **Cloud Scheduler** : Agit comme un service `cron` pour planifier l'exécution des tâches (ex: "Lancer le backtest football tous les jours à 3h00").
        2.  **Pub/Sub** : Le planificateur publie un message dans une file d'attente Pub/Sub dédiée (ex: `topic-run-football-backtest`). Le Job Cloud Run est abonné à ce topic et se déclenche à la réception d'un message, assurant un découplage total.

* **Exposition des Données (API Publique)**
    * **Service GCP** : **Cloud Run Service**.
    * **Rôle** : Un service web qui reste actif pour répondre aux requêtes HTTP. Il expose les endpoints (ex: `/predictions`, `/tickets`) que l'application frontend consommera. Il est responsable de lire les résultats depuis la base de données et de les formater.

### 2.2. Composants Transverses (Communs)

Ces services sont partagés par tous les modules pour mutualiser les ressources et unifier l'application.

* **Base de Données**
    * **Service GCP** : **Firestore**.
    * **Rôle** : Base de données NoSQL serverless utilisée pour stocker les résultats des backtests, les prédictions générées et les tickets. Sa flexibilité de schéma est un atout pour gérer les spécificités de chaque sport. La structure sera organisée par collections (ex: `football_predictions`, `rugby_backtests`).

* **Portail d'Entrée API**
    * **Service GCP** : **API Gateway**.
    * **Rôle** : Point d'entrée unique pour toutes les requêtes externes. Il route les appels vers le bon microservice Cloud Run (ex: `api.votresite.com/football/predictions` -> Service Cloud Run du module Football). Il gère également la sécurité (clés API), l'authentification (JWT), le CORS et la mise en cache des réponses.

* **Hébergement de l'Application Web (Frontend)**
    * **Service GCP** : **Firebase Hosting**.
    * **Rôle** : Service optimisé pour l'hébergement de contenus statiques (HTML, CSS, JavaScript). Il offre un CDN global, des déploiements atomiques et une intégration simple avec le reste de l'écosystème GCP.

* **Déploiement et Intégration Continue (CI/CD)**
    * **Services GCP** : **Cloud Build** & **Artifact Registry**.
    * **Rôle** : Automatisation du processus de déploiement. Un `push` sur une branche du dépôt de code (ex: `module-football`) déclenche un pipeline Cloud Build qui :
        1.  Construit l'image Docker du service.
        2.  Pousse l'image dans **Artifact Registry**.
        3.  Déploie la nouvelle version sur le service ou le job Cloud Run correspondant.

---

### 3. Schéma Simplifié

\`\`\`
[Utilisateur] -> [Navigateur Web] -> [Firebase Hosting]
      |
      v
[Application Web] -> [API Gateway]
      |
      +--> [Cloud Run Service - Football] ---> [Firestore]
      |
      +--> [Cloud Run Service - Rugby] ----> [Firestore]
      |
      +--> [Cloud Run Service - Baseball] --> [Firestore]


[Cloud Scheduler] -> [Pub/Sub] -> [Cloud Run Job - Football] -> [Firestore]
(Tâche planifiée)
\`\`\`
