# Spécifications Techniques : Service RoundManager

Ce document décrit l'architecture, les responsabilités et l'implémentation du service `RoundManager`, un composant central pour la gestion des journées de championnat et la sélection des matchs à analyser.

---

## 1. Contexte et Objectif

L'application actuelle possède une logique métier riche mais monolithique. L'objectif est d'évoluer vers une architecture orientée services pour améliorer la clarté, la maintenabilité et la scalabilité du code.

Le service `RoundManager` est la première étape de cette évolution. Son rôle est de résoudre une problématique clé : l'algorithme a besoin d'analyser des "journées" de championnat complètes pour avoir des données statistiques fiables (classements, formes), tandis que l'utilisateur a besoin d'une vue sur 7 jours glissants.

La **mission principale** du `RoundManager` est de devenir la **source unique de vérité** qui détermine quels matchs sont éligibles pour l'analyse, le backtesting et la prédiction, en se basant sur la notion de "journée terminée", tout en gérant intelligemment les matchs reportés.

---

## 2. Architecture Cible

L'introduction du `RoundManager` s'inscrit dans une architecture où les responsabilités sont clairement séparées.

* `api.service.js` : Un service de bas niveau responsable de tous les appels à l'API externe (`v3.football.api-sports.io`), incluant la gestion du cache et des erreurs.
* `config.js` : Un fichier centralisant toute la configuration (clés API, listes de championnats, seuils, etc.).
* `RoundManager.service.js` : Le service qui détermine les listes de matchs pertinents. Il utilise `api.service.js` pour obtenir les données brutes.
* `MarketAnalysis.service.js` : Analyse la performance des marchés (BTTS, Over/Under...). Il **demande** au `RoundManager` la liste des matchs à analyser.
* `Backtesting.service.js` : Exécute l'algorithme de score de confiance sur les matchs passés. Il **demande** au `RoundManager` la liste des matchs à backtester.
* `Prediction.service.js` : Calcule les scores de confiance et génère des tickets pour les matchs futurs. Il **demande** au `RoundManager` la liste des matchs à pronostiquer.
* `main.controller.js` : Le contrôleur qui reçoit les requêtes HTTP, orchestre les appels aux différents services et formate la réponse finale.
* `app.js` : Le point d'entrée de l'application, responsable uniquement du démarrage du serveur Express et du routage vers les contrôleurs.

---

## 3. Spécifications du Service `RoundManager`

### 3.1. Rôles et Responsabilités

* **Récupérer les matchs** : Interroger l'API pour obtenir tous les matchs des championnats configurés sur une période donnée.
* **Grouper par journée** : Organiser les matchs récupérés par championnat, par saison et par nom de journée (ex: "Regular Season - 12").
* **Déterminer l'état d'une journée** : Pour chaque journée, déterminer si elle est `EN_COURS` ou `TERMINEE`. C'est la logique centrale du service.
* **Gérer les matchs en retard** : Implémenter une stratégie pour ne pas bloquer l'analyse à cause d'un seul match reporté indéfiniment.
* **Exposer des méthodes claires** : Fournir une interface simple pour que les autres services puissent obtenir les listes de matchs dont ils ont besoin, sans avoir à connaître la complexité de la gestion des journées.

### 3.2. Interface du Service (Méthodes Publiques)

```javascript
// Fichier : services/RoundManager.service.js

class RoundManager {
    /**
     * @param {string} startDate - Date de début au format YYYY-MM-DD
     * @param {string} endDate - Date de fin au format YYYY-MM-DD
     * @returns {Promise<Match[]>} - Une liste de tous les matchs terminés
     * appartenant à des journées considérées comme "TERMINEE" dans l'intervalle.
     */
    async getMatchesForBacktesting(startDate, endDate) {
        // ... logique interne pour trouver les journées complètes dans la plage de dates
    }

    /**
     * @returns {Promise<Match[]>} - Une liste des matchs de la ou des dernières
     * journées complètes. Utile pour une analyse ponctuelle des marchés.
     */
    async getMatchesForMarketAnalysis() {
        // ... logique interne pour trouver la dernière journée complète pour chaque ligue
    }

    /**
     * @param {string} startDate - Date de début au format YYYY-MM-DD
     * @param {string} endDate - Date de fin au format YYYY-MM-DD
     * @returns {Promise<Match[]>} - Une liste de tous les matchs à venir (statut "NS")
     * dans l'intervalle de dates.
     */
    async getMatchesForPrediction(startDate, endDate) {
        // ... logique interne pour récupérer les matchs futurs
    }
}

module.exports = new RoundManager();
```

---

## 4. Plan de Refactoring Suggéré

Pour passer du code actuel à la nouvelle architecture :

1.  **Créer la structure de dossiers** :
    ```
    /
    |- config/
    |  |- app.config.js
    |- services/
    |  |- api.service.js
    |  |- RoundManager.service.js
    |  |- MarketAnalysis.service.js
    |  |- Backtesting.service.js
    |  |- Prediction.service.js
    |- controllers/
    |  |- main.controller.js
    |- utils/
    |  |- getCombinations.js
    |- app.js
    |- package.json
    
