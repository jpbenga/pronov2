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

    const projectedHomeGoals = (homeAvgFor + awayAvgAgainst) / 2;
    const projectedAwayGoals = (awayAvgFor + homeAvgAgainst) / 2;
    
    const boundaries = [0.5, 1.5, 2.5];

    boundaries.forEach(b => {
        const homeOverScore = Math.min(95, 50 + (projectedHomeGoals - b) * 25);
        picks.push({
            strategyName: `Domicile Over ${b}`,
            score: homeOverScore,
            betType: `Domicile Over ${b}`,
            market: { id: 16, value: `Over ${b}` }
        });
    });

    boundaries.forEach(b => {
        const awayOverScore = Math.min(95, 50 + (projectedAwayGoals - b) * 25);
        picks.push({
            strategyName: `Extérieur Over ${b}`,
            score: awayOverScore,
            betType: `Extérieur Over ${b}`,
            market: { id: 17, value: `Over ${b}` }
        });
    });

    return picks;
}

module.exports = {
    execute,
    marketFamily: [
        'Domicile Over 0.5', 'Domicile Over 1.5', 'Domicile Over 2.5',
        'Extérieur Over 0.5', 'Extérieur Over 1.5', 'Extérieur Over 2.5'
    ]
};