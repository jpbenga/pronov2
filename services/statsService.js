const apiClient = require('./apiClient');
const { loadSportConfig } = require('../config.js');

async function enrichFixturesWithStandings(fixtures) {
    const enrichedFixtures = [];
    const standingsCache = new Map();
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1000;

    for (const fixture of fixtures) {
        const { league, teams } = fixture;
        const currentSeason = new Date(fixture.fixture.date).getFullYear();
        const prevSeason = currentSeason - 1;
        const leagueId = league.id;
        
        let standings = [];
        const currentSeasonCacheKey = `${leagueId}_${currentSeason}`;
        const prevSeasonCacheKey = `${leagueId}_${prevSeason}`;

        const getAndCacheStandings = async (season, cacheKey) => {
            if (standingsCache.has(cacheKey)) {
                return standingsCache.get(cacheKey);
            }

            let responseData = null;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const response = await apiClient.request('football', '/standings', { league: leagueId, season });
                    const currentStandings = response?.data?.response[0]?.league?.standings;
                    if (currentStandings && currentStandings.length > 0) {
                        responseData = currentStandings;
                        break;
                    }
                    if (attempt === MAX_RETRIES) throw new Error("Réponse de l'API vide ou invalide après plusieurs tentatives.");
                } catch (error) {
                    if (attempt < MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                    } else {
                        console.warn(`WARN: Échec final de la récupération du classement pour la ligue ${league.name} (ID: ${leagueId}), saison ${season}.`);
                    }
                }
            }
            
            const finalStandings = responseData ? responseData.flat() : [];
            standingsCache.set(cacheKey, finalStandings);
            return finalStandings;
        };
        
        standings = await getAndCacheStandings(currentSeason, currentSeasonCacheKey);

        if (!standings || standings.length === 0) {
            standings = await getAndCacheStandings(prevSeason, prevSeasonCacheKey);
        }
        
        if (standings && standings.length > 0) {
            const homeStandings = standings.find(t => t.team.id === teams.home.id);
            const awayStandings = standings.find(t => t.team.id === teams.away.id);

            if (homeStandings && awayStandings) {
                enrichedFixtures.push({ ...fixture, homeStandings, awayStandings });
            }
        }
    }
    
    console.log(`\n--- RÉSUMÉ ENRICHISSEMENT ---`);
    console.log(`Fixtures avant: ${fixtures.length}, Fixtures après: ${enrichedFixtures.length}`);
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

    return finalStats;
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
    if (pick.betType === 'BTTS - Oui') return homeGoals > 0 && awayGoals > 0;
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
        const isAccepted = rate >= performanceThreshold && stats[betType].total > 2;
        if (isAccepted) whitelist.add(betType);
    }
    return { whitelist, fullStats: stats };
}

module.exports = {
    enrichFixturesWithStandings,
    calculateGlobalMarketStats,
    calculatePerformanceStats
};