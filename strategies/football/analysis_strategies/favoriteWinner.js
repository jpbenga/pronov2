function execute(matchData) {
    const { home, away } = matchData.standings;
    const { rankGapThreshold } = matchData.settings.analysisParams;
    const leagueCoeff = matchData.league.coeff;

    if (!home || !away) return null;

    const rankGap = Math.abs(home.rank - away.rank);

    if (rankGap < rankGapThreshold) {
        return null;
    }
    
    let score = (rankGap - (rankGapThreshold - 1)) * 4 + 30;
    const favRank = Math.min(home.rank, away.rank);

    if (favRank <= 3) score += 25; 
    else if (favRank <= 6) score += 20; 
    else score += 10;
    
    score += rankGap * 1.5;
    score = Math.min(98, score * leagueCoeff);

    return {
        strategyName: "Favori Gagnant",
        score: score,
        betType: `Favori Gagnant ${matchData.favoriteName}`,
        market: { id: 1, value: matchData.isFavoriteHome ? 'Home' : 'Away' }
    };
}

module.exports = {
    execute,
    marketType: 'Favori Gagnant'
};