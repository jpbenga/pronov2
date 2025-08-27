# Rapport d'Architecture Complète : Application de Pronostics Sportifs

Ce document définit l'architecture de bout en bout de l'application, incluant l'interface web (Angular), le système de monétisation (abonnements premium) et une stratégie de sécurité robuste alignée sur les recommandations de l'OWASP.

---

## 1. Vue d'Ensemble de l'Architecture

L'application est conçue selon une architecture à trois couches distinctes, garantissant une séparation claire des préoccupations, une sécurité renforcée et une grande flexibilité pour l'intégration future de nouveaux modules sportifs.

1.  **Couche de Présentation (Frontend)** : L'application Angular avec laquelle l'utilisateur interagit.
2.  **Couche de Sécurité & d'Accès (Gateway & Auth)** : Le portail d'entrée sécurisé qui authentifie les utilisateurs, vérifie leurs droits d'accès (gratuit vs. premium) et protège les services backend.
3.  **Couche de Services (Backend)** : L'ensemble de nos microservices indépendants par sport (Football, Rugby, etc.) qui exécutent la logique métier.

---

## 2. Couche de Présentation : Application Angular

L'interface web sera développée avec Angular et conçue pour être aussi modulaire que le backend.

* **Hébergement** : **Firebase Hosting**.
    * **Justification** : Fournit un CDN global pour des temps de chargement rapides, génère et renouvelle automatiquement les certificats SSL, et permet des déploiements atomiques. C'est une solution managée, performante et sécurisée.

* **Structure de l'Application Angular** :
    * **Modules en *Lazy Loading*** : Chaque sport sera un module Angular indépendant chargé à la demande. Lorsqu'un utilisateur navigue vers `/football`, seul le code nécessaire à l'affichage de cette section est téléchargé. Cette approche est cruciale pour maintenir des performances élevées à mesure que de nouveaux sports seront ajoutés.
    * **`CoreModule`** : Contient les services globaux uniques, comme le service d'authentification et les intercepteurs HTTP pour ajouter les jetons d'authentification aux requêtes.
    * **`SharedModule`** : Contient les composants, directives et pipes réutilisables à travers les différents modules sportifs (ex: un composant `<app-match-card>`).

---

## 3. Couche de Sécurité & Gestion Premium

Cette couche est le pilier de la sécurité et de la monétisation de l'application.

* **Gestion des Identités** : **Firebase Authentication**.
    * **Rôle** : Gère de manière sécurisée et externalisée l'inscription, la connexion (email/mot de passe, fournisseurs sociaux comme Google) et la gestion des sessions utilisateur.
    * **Fonctionnement** : Lors d'une connexion réussie, Firebase génère un **jeton JWT (JSON Web Token)** signé. Ce jeton est stocké de manière sécurisée côté client et sera envoyé avec chaque requête API pour prouver l'identité de l'utilisateur.

* **Gestion des Droits (Premium)** : **Firestore** & **Firebase Custom Claims**.
    * **Rôle** : Définir et vérifier les droits d'accès des utilisateurs.
    * **Implémentation** :
        1.  Une collection `users` dans **Firestore** stocke le statut de l'abonnement de chaque utilisateur (ex: `{ subscription: 'premium', expires: '2025-12-31' }`).
        2.  Lorsqu'un abonnement est activé (par exemple, via un webhook d'un service de paiement comme Stripe traité par une **Cloud Function**), nous ajoutons un **Custom Claim** au jeton de l'utilisateur. Exemple : `{ premium: true }`.
        3.  Ce *claim* est ensuite intégré dans les jetons JWT de l'utilisateur. L'avantage est que nos règles de sécurité peuvent vérifier le statut premium en inspectant le jeton, sans avoir besoin d'interroger la base de données à chaque requête.

* **Portail d'API Sécurisé** : **API Gateway**.
    * **Rôle** : Agit comme un **gardien unique** pour tous les microservices backend. **Aucun service n'est exposé publiquement sur Internet** ; seul l'API Gateway est accessible.
    * **Configuration de Sécurité** :
        * **Authentification** : L'API Gateway sera configurée pour valider la signature et la date d'expiration de chaque jeton JWT reçu dans l'en-tête `Authorization`. Toute requête sans jeton valide est rejetée (Erreur 401).
        * **Autorisation** : Pour les routes menant à du contenu premium (ex: `/football/tickets/pepites`), une règle de sécurité supplémentaire sur l'API Gateway vérifiera la présence du *claim* `premium: true` dans le corps du jeton. Si le *claim* est absent, la requête est rejetée (Erreur 403).

* **Gestion des Secrets** : **Secret Manager**.
    * **Rôle** : Stocker de manière centralisée et sécurisée toutes les informations sensibles (clés d'API tierces, clés de service, etc.).
    * **Pratique** : Le code source ne contiendra **jamais de secret en clair**. Les services Cloud Run seront autorisés via des permissions IAM à accéder aux secrets dont ils ont besoin au moment de leur exécution.

---

## 4. Conformité aux Recommandations OWASP

Cette architecture est conçue pour mitiger les risques de sécurité les plus courants, notamment ceux du Top 10 de l'OWASP.

* **A01 - Rupture de Contrôle d'Accès** : Géré par l'API Gateway qui centralise la validation des jetons et des droits (`claims`) pour chaque endpoint.
* **A02 - Défaillances Cryptographiques** : Le trafic est chiffré de bout en bout (HTTPS/TLS). La gestion des mots de passe (hachage, salage) est entièrement déléguée à Firebase Authentication.
* **A05 - Mauvaise Configuration de Sécurité** : L'approche *serverless* et l'utilisation de services managés réduisent la surface d'attaque. Des permissions IAM granulaires (principe du moindre privilège) seront appliquées à chaque service.
* **A07 - Défaillances d'Identification et d'Authentification** : Entièrement pris en charge par Firebase Authentication, un service robuste et spécialisé.

---

### 5. Flux d'une Requête Utilisateur Premium

1.  **Connexion** : L'utilisateur se connecte via l'application Angular. Firebase Authentication valide ses identifiants et lui retourne un jeton JWT contenant le *claim* `{ premium: true }`.
2.  **Requête API** : L'utilisateur accède à une page premium. L'application Angular effectue une requête vers l'API Gateway (ex: `GET /api/football/tickets/pepites`), en incluant le jeton JWT.
3.  **Validation par la Gateway** : L'API Gateway intercepte la requête, valide le jeton JWT et vérifie la présence du *claim* `premium`.
4.  **Transmission** : La requête étant valide, elle est transmise en toute sécurité au microservice Cloud Run du module Football.
5.  **Réponse** : Le service traite la demande, récupère les données de Firestore et renvoie la réponse, qui traverse la Gateway pour arriver jusqu'à l'utilisateur.
