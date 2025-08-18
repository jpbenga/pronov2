const express = require('express');
const path = require('path');
const cors = require('cors');
const dataCollector = require('./services/dataCollector');
const analysisEngine = require('./services/analysisEngine');
const ticketGenerator = require('./services/ticketGenerator');
const apiClient = require('./services/apiClient');
const { loadSportConfig } = require('./config.js');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

function isPickSuccess(pick, homeGoals, awayGoals) {
    if (homeGoals === null || awayGoals === null) return null;
    const favIsHome = pick.favoriteName === pick.match.home_team;
    const favWins = (favIsHome && homeGoals > awayGoals) || (!favIsHome && awayGoals > homeGoals);
    if (pick.betType.startsWith('Double Chance')) return favWins || homeGoals === awayGoals;
    if (pick.betType === 'BTTS') return homeGoals > 0 && awayGoals > 0;
    if (pick.betType === 'BTTS - Non') return homeGoals === 0 || awayGoals === 0;
    const totalGoals = homeGoals + awayGoals;
    if (pick.betType === 'Over 1.5') return totalGoals > 1.5;
    if (pick.betType === 'Under 1.5') return totalGoals < 1.5;
    if (pick.betType === 'Over 2.5') return totalGoals > 2.5;
    if (pick.betType === 'Under 2.5') return totalGoals < 2.5;
    if (pick.betType === 'Over 3.5') return totalGoals > 3.5;
    if (pick.betType === 'Under 3.5') return totalGoals < 3.5;
    return null;
}

async function calculatePerformanceStats(pastPicks) {
    const stats = {};
    const allFixtureIds = [...new Set(pastPicks.map(p => p.match.id))];
    
    if (allFixtureIds.length === 0) {
        return { whitelist: new Set(), fullStats: {} };
    }

    const requests = allFixtureIds.map(id => apiClient.request('football', '/fixtures', { id }));
    const responses = await Promise.all(requests);
    const results = {};
    responses.forEach(response => {
        const fixture = response?.data?.response[0];
        if (fixture && fixture.fixture.status.short === 'FT') {
            results[fixture.fixture.id] = { home: fixture.goals.home, away: fixture.goals.away };
        }
    });

    pastPicks.forEach(pick => {
        const result = results[pick.match.id];
        if (!result) return;
        const success = isPickSuccess(pick, result.home, result.away);
        if (success === null) return;
        if (!stats[pick.betType]) stats[pick.betType] = { total: 0, success: 0 };
        stats[pick.betType].total++;
        if (success) stats[pick.betType].success++;
    });
    
    const whitelist = new Set();
    const { performanceThreshold } = loadSportConfig('football').settings.analysisParams;
    
    for (const betType in stats) {
        if (stats[betType].total > 5) {
            const rate = (stats[betType].success / stats[betType].total) * 100;
            stats[betType].rate = rate;
            if (rate >= performanceThreshold) {
                whitelist.add(betType);
            }
        }
    }
    console.log(`INFO: [Performance] ${whitelist.size} stratégies performantes retenues sur ${Object.keys(stats).length} analysées.`);
    return { whitelist, fullStats: stats };
}

app.get('/api/analyze', async (req, res) => {
    try {
        const sport = 'football';
        const [futureData, pastData] = await Promise.all([
            dataCollector.getFutureMatchData(sport),
            dataCollector.getPastMatchData(sport)
        ]);
        
        const [futurePicks, pastPicks] = await Promise.all([
             analysisEngine.runAnalysis(sport, futureData),
             analysisEngine.runAnalysis(sport, pastData)
        ]);

        const { whitelist, fullStats } = await calculatePerformanceStats(pastPicks);
        const filteredFuturePicks = futurePicks.filter(p => whitelist.has(p.betType));
        console.log(`INFO: ${futurePicks.length} pronostics futurs, ${filteredFuturePicks.length} retenus après filtre de performance.`);
        
        const backtestTickets = ticketGenerator.generateTickets(sport, pastPicks, 'backtest');
        const predictionTickets = ticketGenerator.generateTickets(sport, filteredFuturePicks, 'predictions');

        res.json({
            backtestData: {
                picks: pastPicks,
                tickets: backtestTickets,
                stats: fullStats
            },
            predictionData: {
                picks: filteredFuturePicks,
                tickets: predictionTickets
            }
        });
    } catch(error) {
        console.error("Erreur durant l'analyse globale:", error);
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
        const requests = fixtureIds.map(id => apiClient.request('football', '/fixtures', { id }));
        const responses = await Promise.all(requests);
        for (const response of responses) {
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