const path = require('path');
const { loadSportConfig } = require('../config.js'); // On importe le chargeur de config

// La seule fonction du moteur est de déléguer
async function runAnalysis(sport, allFixtures) {
    try {
        // --- CORRECTION CI-DESSOUS ---
        // 1. Charger dynamiquement le module d'analyse pour le sport demandé
        const strategyPath = path.join(__dirname, '..', 'strategies', sport, 'analyzer.js');
        const sportAnalyzer = require(strategyPath);

        // 2. Charger la configuration (ligues, settings) pour ce sport
        const { leagues, settings } = loadSportConfig(sport);

        // 3. Exécuter la fonction d'analyse en lui passant TOUTES les données nécessaires
        console.log(`INFO: [AnalysisEngine] Utilisation de la stratégie d'analyse pour "${sport}"`);
        const predictions = await sportAnalyzer.generatePredictions(allFixtures, settings, leagues);
        // --- FIN DE LA CORRECTION ---
        
        return predictions;

    } catch (error) {
        console.error(`ERREUR: Impossible de charger ou d'exécuter la stratégie d'analyse pour "${sport}".`, error);
        return [];
    }
}

module.exports = {
    runAnalysis
};