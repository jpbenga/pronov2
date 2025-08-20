function execute(matchData) {
    const picks = [];
    const { homeStats, awayStats } = matchData.stats;

    if (!homeStats?.goals?.for?.minute || !awayStats?.goals?.for?.minute) {
        return null;
    }

    const homeGoalsMT2 = (homeStats.goals.for.minute['46-60']?.total || 0) + (homeStats.goals.for.minute['61-75']?.total || 0) + (homeStats.goals.for.minute['76-90']?.total || 0);
    const awayGoalsMT2 = (awayStats.goals.for.minute['46-60']?.total || 0) + (awayStats.goals.for.minute['61-75']?.total || 0) + (awayStats.goals.for.minute['76-90']?.total || 0);

    const homeTotalMatches = homeStats.fixtures.played.total;
    const awayTotalMatches = awayStats.fixtures.played.total;

    if (homeTotalMatches === 0 || awayTotalMatches === 0) return null;

    const avgHomeGoalsMT2 = homeGoalsMT2 / homeTotalMatches;
    const avgAwayGoalsMT2 = awayGoalsMT2 / awayTotalMatches;
    const projectedGoalsMT2 = (avgHomeGoalsMT2 + avgAwayGoalsMT2);

    const boundaries = [0.5, 1.5, 2.5];
    boundaries.forEach(b => {
        const overScore = Math.min(95, 40 + (projectedGoalsMT2 * 25) - (b * 12));
        picks.push({
            strategyName: `Over ${b} MT2`,
            score: overScore,
            betType: `Over ${b} MT2`,
            market: { id: 26, value: `Over ${b}` }
        });
    });

    return picks;
}

module.exports = {
    execute,
    marketFamily: ['Over 0.5 MT2', 'Over 1.5 MT2', 'Over 2.5 MT2']
};