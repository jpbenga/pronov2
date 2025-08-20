// services/analysisEngine.js

const path = require('path');
const { loadSportConfig } = require('../config.js');

async function runAnalysis(sport, allFixtures, marketWhitelist = null) {
    try {
        const strategyPath = path.join(__dirname, '..', 'strategies', sport, 'analyzer.js');
        const sportAnalyzer = require(strategyPath);

        const { leagues, settings } = loadSportConfig(sport);

        console.log(`INFO: [AnalysisEngine] Utilisation de la stratégie d'analyse pour "${sport}"`);
        const predictions = await sportAnalyzer.generatePredictions(allFixtures, settings, leagues, marketWhitelist);
        
        return predictions;

    } catch (error) {
        console.error(`ERREUR: Impossible de charger ou d'exécuter la stratégie d'analyse pour "${sport}".`, error);
        return [];
    }
}

module.exports = {
    runAnalysis
};