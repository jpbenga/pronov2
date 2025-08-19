function calculateScore(projected, boundary, scale) {
    return Math.max(5, Math.min(95, 50 + (projected - boundary) * scale));
}

function execute(matchData) {
    const picks = [];
    const { homeStats, awayStats } = matchData.stats;

    if (!homeStats?.goals?.for?.average?.total || !awayStats?.goals?.for?.average?.total) {
        return null;
    }

    const homeAvgFor = parseFloat(homeStats.goals.for.average.total);
    const homeAvgAgainst = parseFloat(homeStats.goals.against.average.total);
    const awayAvgFor = parseFloat(awayStats.goals.for.average.total);
    const awayAvgAgainst = parseFloat(awayStats.goals.against.average.total);
    
    const bttsPotential = ((homeAvgFor + awayAvgAgainst) / 2 + (awayAvgFor + homeAvgAgainst) / 2) / 2;
    
    const bttsYesScore = calculateScore(bttsPotential, 1.25, 40);
    const bttsNoScore = 100 - bttsYesScore;

    picks.push({
        strategyName: 'BTTS',
        score: bttsYesScore,
        betType: 'BTTS - Oui',
        market: { id: 8, value: 'Yes' }
    });

    picks.push({
        strategyName: 'BTTS - Non',
        score: bttsNoScore,
        betType: 'BTTS - Non',
        market: { id: 8, value: 'No' }
    });

    return picks;
}

module.exports = {
    execute,
    marketFamily: ['BTTS - Oui', 'BTTS - Non']
};