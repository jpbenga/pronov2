const express = require('express');
const path = require('path');
const cors = require('cors');
const dataCollector = require('./services/dataCollector');
const analysisEngine = require('./services/analysisEngine');
const ticketGenerator = require('./services/ticketGenerator');
const statsService = require('./services/statsService');
const stateManager = require('./stateManager');
const apiClient = require('./services/apiClient');
const { loadSportConfig } = require('./config.js');

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
        
        console.log("Étape 1: Recherche des nouvelles journées terminées à backtester...");
        const roundsToAnalyze = await dataCollector.getRoundsToAnalyze(state);
        
        let responseData = {
            globalMarketStats: {},
            backtestData: { picks: [], tickets: {}, stats: {} },
            predictionData: { picks: [], tickets: {} },
            message: ""
        };

        if (roundsToAnalyze.length > 0) {
            console.log(`${roundsToAnalyze.length} nouvelle(s) journée(s) à traiter pour le backtest.`);
            let newPicksForBacktest = [];
            let allFixturesForStats = [];

            for(const round of roundsToAnalyze) {
                console.log(` -> Analyse de ${round.leagueName} - ${round.round}`);
                const enrichedFixtures = await statsService.enrichFixturesWithStandings(round.fixtures);
                allFixturesForStats.push(...enrichedFixtures);
                const picks = await analysisEngine.runAnalysis(sport, enrichedFixtures);
                newPicksForBacktest.push(...picks);
                
                if (!state.leagues) state.leagues = {};
                state.leagues[round.leagueId] = { lastAnalyzedRound: round.round };
            }
            
            stateManager.saveState(state);
            
            const globalMarketPerformance = statsService.calculateGlobalMarketStats(allFixturesForStats);
            const { fullStats } = await statsService.calculatePerformanceStats(newPicksForBacktest);
            const backtestTickets = ticketGenerator.generateTickets(sport, newPicksForBacktest, 'backtest');
            
            responseData.message = `Analyse de ${roundsToAnalyze.length} nouvelle(s) journée(s) terminée.`;
            responseData.globalMarketStats = globalMarketPerformance;
            responseData.backtestData = { picks: newPicksForBacktest, tickets: backtestTickets, stats: fullStats };

        } else {
            console.log("Aucune nouvelle journée à backtester. Génération des prédictions futures...");
            
            const futureDataRaw = await dataCollector.getFutureMatchData();
            const futureData = await statsService.enrichFixturesWithStandings(futureDataRaw);

            const highRankGapMatches = futureData.filter(fixture => {
                const rankGap = Math.abs(fixture.homeStandings.rank - fixture.awayStandings.rank);
                return rankGap >= settings.analysisParams.rankGapThreshold;
            });

            const futurePicks = await analysisEngine.runAnalysis(sport, highRankGapMatches);
            const predictionTickets = ticketGenerator.generateTickets(sport, futurePicks, 'predictions');
            
            responseData.message = "Prédictions générées.";
            responseData.predictionData = { picks: futurePicks, tickets: predictionTickets };
        }
        
        res.json(responseData);

    } catch(error) {
        console.error("ERREUR GLOBALE DURANT L'ANALYSE:", error);
        res.status(500).json({ error: "Une erreur interne est survenue." });
    }
});

app.post('/api/check-results', async (req, res) => {
    const { fixtureIds } = req.body;
    if (!fixtureIds || !Array.isArray(fixtureIds) || fixtureIds.length === 0) {
        return res.status(400).json({ error: 'Liste d\'IDs de matchs requise.' });
    }
    const results = {};
    try {
        for (const id of fixtureIds) {
            const response = await apiClient.request('football', '/fixtures', { id });
            const fixture = response?.data?.response[0];
            if (fixture && fixture.fixture.status.short === 'FT') {
                results[fixture.fixture.id] = { status: 'FT', home: fixture.goals.home, away: fixture.goals.away };
            }
        }
        res.json(results);
    } catch (error) {
        console.error("Erreur durant la vérification des résultats:", error);
        res.status(500).json({ error: "Une erreur interne est survenue." });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Le serveur est lancé sur http://localhost:${PORT}`));