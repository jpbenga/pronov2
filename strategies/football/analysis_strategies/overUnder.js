function calculateFormScore(formString) {
    if (!formString) return 0;
    return formString.split('').reduce((acc, char) => (char === 'W' ? acc + 3 : char === 'D' ? acc + 1 : acc), 0);
}

function calculateScore(projected, boundary, scale) {
    return Math.max(5, Math.min(95, 50 + (projected - boundary) * scale));
}

function execute(matchData) {
    const picks = [];
    const { home, away } = matchData.standings;
    const { homeStats, awayStats } = matchData.stats;

    if (!home || !away || !homeStats?.goals?.for?.average?.total || !awayStats?.goals?.for?.average?.total) {
        return null;
    }

    const homeAvgFor = parseFloat(homeStats.goals.for.average.total);
    const homeAvgAgainst = parseFloat(homeStats.goals.against.average.total);
    const awayAvgFor = parseFloat(awayStats.goals.for.average.total);
    const awayAvgAgainst = parseFloat(awayStats.goals.against.average.total);
    
    const formMomentum = (calculateFormScore(home.form) - calculateFormScore(away.form)) / 15 * 0.1;
    const projectedGoals = ((homeAvgFor + awayAvgFor + homeAvgAgainst + awayAvgAgainst) / 2) + formMomentum;
    
    const boundaries = [
        { name: 'Over 1.5', boundary: 1.5, scale: 15, market: {id: 5, value: 'Over 1.5'} },
        { name: 'Under 1.5', boundary: 1.5, scale: 15, market: {id: 5, value: 'Under 1.5'} },
        { name: 'Over 2.5', boundary: 2.5, scale: 22, market: {id: 5, value: 'Over 2.5'} },
        { name: 'Under 2.5', boundary: 2.5, scale: 22, market: {id: 5, value: 'Under 2.5'} },
        { name: 'Over 3.5', boundary: 3.5, scale: 25, market: {id: 5, value: 'Over 3.5'} },
        { name: 'Under 3.5', boundary: 3.5, scale: 25, market: {id: 5, value: 'Under 3.5'} }
    ];

    boundaries.forEach(b => {
        let score = calculateScore(projectedGoals, b.boundary, b.scale);
        if (b.name.startsWith('Under')) {
            score = 100 - score;
        }
        picks.push({
            strategyName: b.name,
            score: score,
            betType: b.name,
            market: b.market
        });
    });

    return picks;
}

module.exports = {
    execute,
    marketFamily: ['Over 1.5', 'Under 1.5', 'Over 2.5', 'Under 2.5', 'Over 3.5', 'Under 3.5']
};