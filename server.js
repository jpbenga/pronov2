const express = require('express');
const path = require('path');
const cors = require('cors');
const dataCollector = require('./services/dataCollector');
const analysisEngine = require('./services/analysisEngine');
const ticketGenerator = require('./services/ticketGenerator');
const statsService = require('./services/statsService');
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
        const { performanceThreshold, rankGapThreshold } = settings.analysisParams;

        console.log("Étape 0: Collecte et enrichissement des données passées...");
        const pastDataRaw = await dataCollector.getPastMatchData(sport);
        const pastData = await statsService.enrichFixturesWithStandings(pastDataRaw);
        
        console.log("\nÉtape 1: Analyse statistique globale des marchés...");
        const globalMarketPerformance = statsService.calculateGlobalMarketStats(pastData);
        const marketWhitelist = new Set();
        for (const market in globalMarketPerformance) {
            if (globalMarketPerformance[market].rate >= performanceThreshold) {
                marketWhitelist.add(market);
            }
        }
        console.log(`Marchés retenus après filtre global : [${Array.from(marketWhitelist).join(', ')}]`);

        console.log("\nÉtape 2: Backtest sur les marchés retenus...");
        const pastPicks = await analysisEngine.runAnalysis(sport, pastData, marketWhitelist);
        const { whitelist, fullStats } = await statsService.calculatePerformanceStats(pastPicks);
        console.log(`Stratégies retenues après backtest : [${Array.from(whitelist).join(', ')}]`);

        console.log("\nÉtape 3: Analyse du futur sur les marchés retenus...");
        const futureDataRaw = await dataCollector.getFutureMatchData(sport);
        const futureData = await statsService.enrichFixturesWithStandings(futureDataRaw);

        const highRankGapMatches = futureData.filter(fixture => {
            const rankGap = Math.abs(fixture.homeStandings.rank - fixture.awayStandings.rank);
            return rankGap >= rankGapThreshold;
        });
        console.log(`INFO: ${futureData.length} matchs futurs trouvés, ${highRankGapMatches.length} retenus après filtre d'écart de classement (>=${rankGapThreshold}).`);

        const futurePicks = await analysisEngine.runAnalysis(sport, highRankGapMatches, marketWhitelist);
        
        const backtestTickets = ticketGenerator.generateTickets(sport, pastPicks, 'backtest');
        const predictionTickets = ticketGenerator.generateTickets(sport, futurePicks, 'predictions');

        res.json({
            globalMarketStats: globalMarketPerformance,
            backtestData: { picks: pastPicks, tickets: backtestTickets, stats: fullStats },
            predictionData: { picks: futurePicks, tickets: predictionTickets }
        });

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
        // On remplace Promise.all par une boucle séquentielle pour éviter le rate limiting
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