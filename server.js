const express = require('express');
const path = require('path');
const cors = require('cors');
const roundManager = require('./services/roundManager');
const stateManager = require('./stateManager');
const { loadSportConfig } = require('./config.js');
const { enrichFixturesWithStandings, calculateGlobalMarketStats, calculatePerformanceStats } = require('./services/statsService');
const { runAnalysis } = require('./services/analysisEngine');
const { generateTickets } = require('./services/ticketGenerator');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

app.get('/api/analyze', async (req, res) => {
    try {
        const sport = 'football';
        const { settings } = loadSportConfig(sport);
        const state = stateManager.loadState();
        
        console.log("Étape 1: Recherche de nouvelles journées via le RoundManager...");
        const roundsToAnalyze = await roundManager.getNewRoundsToAnalyze();
        
        let responseData = { backtestData: { picks: [], tickets: {}, stats: {} } };

        if (roundsToAnalyze.length > 0) {
            console.log(` -> ${roundsToAnalyze.length} nouvelle(s) journée(s) à traiter.`);
            const allFixtures = roundsToAnalyze.flatMap(r => r.fixtures);
            const enrichedFixtures = await enrichFixturesWithStandings(allFixtures);
            
            const marketStats = calculateGlobalMarketStats(enrichedFixtures);
            const marketWhitelist = new Set(Object.keys(marketStats).filter(m => marketStats[m].rate >= settings.analysisParams.performanceThreshold));
            
            const picks = await runAnalysis(sport, enrichedFixtures, marketWhitelist, settings);
            const { whitelist, fullStats } = await calculatePerformanceStats(picks);
            const tickets = generateTickets(sport, picks, 'backtest');

            roundsToAnalyze.forEach(round => {
                if (!state.leagues[round.leagueId]) state.leagues[round.leagueId] = { analyzedRounds: {} };
                state.leagues[round.leagueId].analyzedRounds[round.round] = round.signature;
            });
            stateManager.saveState(state);

            responseData.globalMarketStats = marketStats;
            responseData.backtestData = { picks, tickets, stats: fullStats };
            responseData.message = `Analyse de ${roundsToAnalyze.length} journée(s) terminée.`;
        } else {
            console.log(" -> Aucune nouvelle journée à backtester.");
            responseData.message = "Aucun nouveau backtest. Les prédictions sont à jour.";
        }
        
        // Note: La logique de prédiction pourrait être déplacée dans son propre service plus tard.
        // Pour l'instant, elle reste ici pour la simplicité.
        console.log("\nÉtape 2: Génération des prédictions pour l'interface...");
        // Ici, il faudrait appeler une fonction qui récupère les matchs futurs depuis le dataCollector.
        // Puis lancer l'analyse et la génération de tickets comme fait précédemment.
        // Cette partie est laissée pour une future itération afin de se concentrer sur la stabilité du backtest.
        responseData.predictionData = { picks: [], tickets: {} };

        res.json(responseData);

    } catch(error) {
        console.error("ERREUR GLOBALE DURANT L'ANALYSE:", error);
        res.status(500).json({ error: "Une erreur interne est survenue." });
    }
});


app.listen(PORT, () => console.log(`Le serveur est lancé sur http://localhost:${PORT}`));