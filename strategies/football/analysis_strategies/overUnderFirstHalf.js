function execute(matchData) {
    const picks = [];
    const { homeStats, awayStats } = matchData.stats;

    if (!homeStats?.goals?.for?.minute || !awayStats?.goals?.for?.minute) {
        return null;
    }

    const homeGoalsMT1 = (homeStats.goals.for.minute['0-15']?.total || 0) + (homeStats.goals.for.minute['16-30']?.total || 0) + (homeStats.goals.for.minute['31-45']?.total || 0);
    const awayGoalsMT1 = (awayStats.goals.for.minute['0-15']?.total || 0) + (awayStats.goals.for.minute['16-30']?.total || 0) + (awayStats.goals.for.minute['31-45']?.total || 0);

    const homeTotalMatches = homeStats.fixtures.played.total;
    const awayTotalMatches = awayStats.fixtures.played.total;

    if (homeTotalMatches === 0 || awayTotalMatches === 0) return null;

    const avgHomeGoalsMT1 = homeGoalsMT1 / homeTotalMatches;
    const avgAwayGoalsMT1 = awayGoalsMT1 / awayTotalMatches;
    const projectedGoalsMT1 = (avgHomeGoalsMT1 + avgAwayGoalsMT1);

    const boundaries = [0.5, 1.5, 2.5];
    boundaries.forEach(b => {
        const overScore = Math.min(95, 35 + (projectedGoalsMT1 * 30) - (b * 15));
        picks.push({
            strategyName: `Over ${b} MT1`,
            score: overScore,
            betType: `Over ${b} MT1`,
            market: { id: 6, value: `Over ${b}` }
        });
    });

    return picks;
}

module.exports = {
    execute,
    marketFamily: ['Over 0.5 MT1', 'Over 1.5 MT1', 'Over 2.5 MT1']
};