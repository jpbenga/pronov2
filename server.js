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

async function enrichFixturesWithStandings(fixtures) {
    const enrichedFixtures = [];
    const standingsCache = new Map();

    for (const fixture of fixtures) {
        const { league, teams } = fixture;
        const season = new Date(fixture.fixture.date).getFullYear();
        const leagueId = league.id;
        const cacheKey = `${leagueId}_${season}`;

        if (!standingsCache.has(cacheKey)) {
            const standingsData = await apiClient.request('football', '/standings', { league: leagueId, season });
            standingsCache.set(cacheKey, standingsData?.data?.response[0]?.league?.standings[0] || []);
        }
        
        const standings = standingsCache.get(cacheKey);
        const homeStandings = standings.find(t => t.team.id === teams.home.id);
        const awayStandings = standings.find(t => t.team.id === teams.away.id);

        if (homeStandings && awayStandings) {
            enrichedFixtures.push({ ...fixture, homeStandings, awayStandings });
        }
    }
    return enrichedFixtures;
}

function calculateGlobalMarketStats(pastFixtures) {
    const marketCounts = {
        'BTTS - Oui': { success: 0, total: 0 },
        'BTTS - Non': { success: 0, total: 0 },
        'Over 1.5': { success: 0, total: 0 },
        'Under 1.5': { success: 0, total: 0 },
        'Over 2.5': { success: 0, total: 0 },
        'Under 2.5': { success: 0, total: 0 },
        'Over 3.5': { success: 0, total: 0 },
        'Under 3.5': { success: 0, total: 0 },
        'Over 0.5 MT1': { success: 0, total: 0 },
        'Over 1.5 MT1': { success: 0, total: 0 },
        'Over 2.5 MT1': { success: 0, total: 0 },
        'Over 0.5 MT2': { success: 0, total: 0 },
        'Over 1.5 MT2': { success: 0, total: 0 },
        'Over 2.5 MT2': { success: 0, total: 0 },
        'Domicile Over 0.5': { success: 0, total: 0 },
        'Domicile Over 1.5': { success: 0, total: 0 },
        'Domicile Over 2.5': { success: 0, total: 0 },
        'Extérieur Over 0.5': { success: 0, total: 0 },
        'Extérieur Over 1.5': { success: 0, total: 0 },
        'Extérieur Over 2.5': { success: 0, total: 0 },
        'Double Chance Favori': { success: 0, total: 0 },
        'Favori Gagnant': { success: 0, total: 0 },
    };

    for (const fixture of pastFixtures) {
        if (!fixture.goals || fixture.goals.home === null || !fixture.score || !fixture.score.halftime) {
            continue;
        }

        const homeGoals = fixture.goals.home;
        const awayGoals = fixture.goals.away;
        const totalGoals = homeGoals + awayGoals;
        const firstHalfTotalGoals = fixture.score.halftime.home + fixture.score.halftime.away;
        const secondHalfTotalGoals = totalGoals - firstHalfTotalGoals;

        const bttsYes = homeGoals > 0 && awayGoals > 0;
        marketCounts['BTTS - Oui'].total++; if (bttsYes) marketCounts['BTTS - Oui'].success++;
        marketCounts['BTTS - Non'].total++; if (!bttsYes) marketCounts['BTTS - Non'].success++;
        marketCounts['Over 1.5'].total++; if (totalGoals > 1.5) marketCounts['Over 1.5'].success++;
        marketCounts['Under 1.5'].total++; if (totalGoals < 1.5) marketCounts['Under 1.5'].success++;
        marketCounts['Over 2.5'].total++; if (totalGoals > 2.5) marketCounts['Over 2.5'].success++;
        marketCounts['Under 2.5'].total++; if (totalGoals < 2.5) marketCounts['Under 2.5'].success++;
        marketCounts['Over 3.5'].total++; if (totalGoals > 3.5) marketCounts['Over 3.5'].success++;
        marketCounts['Under 3.5'].total++; if (totalGoals < 3.5) marketCounts['Under 3.5'].success++;
        marketCounts['Over 0.5 MT1'].total++; if (firstHalfTotalGoals > 0.5) marketCounts['Over 0.5 MT1'].success++;
        marketCounts['Over 1.5 MT1'].total++; if (firstHalfTotalGoals > 1.5) marketCounts['Over 1.5 MT1'].success++;
        marketCounts['Over 2.5 MT1'].total++; if (firstHalfTotalGoals > 2.5) marketCounts['Over 2.5 MT1'].success++;
        marketCounts['Over 0.5 MT2'].total++; if (secondHalfTotalGoals > 0.5) marketCounts['Over 0.5 MT2'].success++;
        marketCounts['Over 1.5 MT2'].total++; if (secondHalfTotalGoals > 1.5) marketCounts['Over 1.5 MT2'].success++;
        marketCounts['Over 2.5 MT2'].total++; if (secondHalfTotalGoals > 2.5) marketCounts['Over 2.5 MT2'].success++;
        marketCounts['Domicile Over 0.5'].total++; if (homeGoals > 0.5) marketCounts['Domicile Over 0.5'].success++;
        marketCounts['Domicile Over 1.5'].total++; if (homeGoals > 1.5) marketCounts['Domicile Over 1.5'].success++;
        marketCounts['Domicile Over 2.5'].total++; if (homeGoals > 2.5) marketCounts['Domicile Over 2.5'].success++;
        marketCounts['Extérieur Over 0.5'].total++; if (awayGoals > 0.5) marketCounts['Extérieur Over 0.5'].success++;
        marketCounts['Extérieur Over 1.5'].total++; if (awayGoals > 1.5) marketCounts['Extérieur Over 1.5'].success++;
        marketCounts['Extérieur Over 2.5'].total++; if (awayGoals > 2.5) marketCounts['Extérieur Over 2.5'].success++;
        
        if (fixture.homeStandings && fixture.awayStandings) {
            const isHomeFavorite = fixture.homeStandings.rank < fixture.awayStandings.rank;
            const favWins = (isHomeFavorite && homeGoals > awayGoals) || (!isHomeFavorite && awayGoals > homeGoals);
            const draw = homeGoals === awayGoals;
            marketCounts['Double Chance Favori'].total++; if (favWins || draw) marketCounts['Double Chance Favori'].success++;
            marketCounts['Favori Gagnant'].total++; if (favWins) marketCounts['Favori Gagnant'].success++;
        }
    }
    
    // --- DÉBUT DE LA MODIFICATION ---
    const finalStats = {};
    for (const market in marketCounts) {
        const { success, total } = marketCounts[market];
        finalStats[market] = {
            total: total,
            success: success,
            rate: total > 0 ? parseFloat(((success / total) * 100).toFixed(2)) : 0
        };
    }
    
    console.log("--- Statistiques Globales des Marchés ---");
    console.table(Object.fromEntries(Object.entries(finalStats).map(([key, val]) => [key, val.rate])));

    return finalStats; // On retourne l'objet complet
    // --- FIN DE LA MODIFICATION ---
}


function getStatsBetType(betType) {
    if (betType.startsWith('Double Chance')) return 'Double Chance';
    if (betType.startsWith('Favori Gagnant')) return 'Favori Gagnant';
    return betType;
}

function isPickSuccess(pick, homeGoals, awayGoals) {
    if (homeGoals === null || awayGoals === null || pick.isFavoriteHome === undefined) return null;
    
    const favWins = (pick.isFavoriteHome && homeGoals > awayGoals) || (!pick.isFavoriteHome && awayGoals > homeGoals);
    
    if (pick.betType.startsWith('Double Chance')) return favWins || homeGoals === awayGoals;
    if (pick.betType.startsWith('Favori Gagnant')) return favWins;
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
    if (pastPicks.length === 0) return { whitelist: new Set(), fullStats: {} };
    const stats = {};
    pastPicks.forEach(pick => {
        const result = pick.match.goals;
        if (!result || result.home === null) return;
        
        const success = isPickSuccess(pick, result.home, result.away);
        if (success === null) return;
        
        const statsBetType = getStatsBetType(pick.betType);
        if (!stats[statsBetType]) stats[statsBetType] = { total: 0, success: 0 };
        stats[statsBetType].total++;
        if (success) stats[statsBetType].success++;
    });
    
    const whitelist = new Set();
    const { performanceThreshold } = loadSportConfig('football').settings.analysisParams;
    
    for (const betType in stats) {
        const rate = (stats[betType].success / stats[betType].total) * 100;
        const isAccepted = rate >= performanceThreshold && stats[betType].total > 5;
        if (isAccepted) whitelist.add(betType);
    }
    return { whitelist, fullStats: stats };
}

app.get('/api/analyze', async (req, res) => {
    try {
        const sport = 'football';
        const { performanceThreshold } = loadSportConfig(sport).settings.analysisParams;

        console.log("Étape 0: Collecte des données passées...");
        const pastDataRaw = await dataCollector.getPastMatchData(sport);
        console.log(`INFO: ${pastDataRaw.length} matchs bruts trouvés avant l'enrichissement.`);
        if (pastDataRaw.length === 0) {
            console.log("WARN: Aucun match trouvé. Vérifiez la configuration des ligues et la période de recherche.");
        }

        const pastData = await enrichFixturesWithStandings(pastDataRaw);
        console.log(`INFO: ${pastData.length} matchs ont été conservés après l'enrichissement (ceux avec un classement trouvé).`);
        if (pastData.length > 0) {
            console.log("Vérification du premier match enrichi:", pastData[0]);
        } else {
            console.log("WARN: Aucun match n'a pu être enrichi avec les données de classement. Le tableau est vide.");
        }
        
        console.log("\nÉtape 1: Analyse statistique globale des marchés...");
        const globalMarketPerformance = calculateGlobalMarketStats(pastData);
        const marketWhitelist = new Set();
        for (const market in globalMarketPerformance) {
            if (globalMarketPerformance[market] >= performanceThreshold) {
                marketWhitelist.add(market);
            }
        }
        console.log(`Marchés retenus après filtre global : [${Array.from(marketWhitelist).join(', ')}]`);

        console.log("\nÉtape 2: Backtest des stratégies sur les marchés retenus...");
        const pastPicks = await analysisEngine.runAnalysis(sport, pastData, marketWhitelist);
        const { whitelist, fullStats } = await calculatePerformanceStats(pastPicks);
        console.log(`Stratégies retenues après backtest : [${Array.from(whitelist).join(', ')}]`);

        console.log("\nÉtape 3: Analyse du futur...");
        const futureDataRaw = await dataCollector.getFutureMatchData(sport);
        const futureData = await enrichFixturesWithStandings(futureDataRaw);
        const allFuturePicks = await analysisEngine.runAnalysis(sport, futureData);

        const filteredFuturePicks = allFuturePicks.filter(p => whitelist.has(getStatsBetType(p.betType)));
        
        const backtestTickets = ticketGenerator.generateTickets(sport, pastPicks, 'backtest');
        const predictionTickets = ticketGenerator.generateTickets(sport, filteredFuturePicks, 'predictions');

        res.json({
            globalMarketStats: globalMarketPerformance,
            backtestData: { picks: pastPicks, tickets: backtestTickets, stats: fullStats },
            predictionData: { picks: filteredFuturePicks, tickets: predictionTickets }
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