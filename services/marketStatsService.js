const { loadSportConfig } = require('../config.js');

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
    return finalStats;
}

function getMarketWhitelist(marketStats) {
    const { settings } = loadSportConfig('football');
    const { performanceThreshold } = settings.analysisParams;
    const marketWhitelist = new Set();
    for (const market in marketStats) {
        if (marketStats[market].rate >= performanceThreshold) {
            marketWhitelist.add(market);
        }
    }
    return marketWhitelist;
}

module.exports = { calculateGlobalMarketStats, getMarketWhitelist };