// strategies/football/analysis_strategies/doubleChance.js

function execute(matchData) {
    const { home, away } = matchData.standings;
    const { rankGapThreshold } = matchData.settings.analysisParams;
    const leagueCoeff = matchData.league.coeff;

    if (!home || !away) return null;

    const rankGap = Math.abs(home.rank - away.rank);

    if (rankGap < rankGapThreshold) {
        console.log(`      - Rejeté par Double Chance: Écart de classement (${rankGap}) est inférieur au seuil (${rankGapThreshold}).`);
        return null; 
    }
    
    let score = (rankGap - (rankGapThreshold - 1)) * 3 + 25;
    const favRank = Math.min(home.rank, away.rank);
    if (favRank <= 3) score += 30; 
    else if (favRank <= 6) score += 25; 
    else score += 15;
    
    score += rankGap * 1.8;
    score = Math.min(100, score * leagueCoeff);

    return {
        strategyName: "Double Chance",
        score: score,
        betType: `Double Chance ${matchData.favoriteName}`,
        market: { id: 12, value: matchData.isFavoriteHome ? 'Home or Draw' : 'Away or Draw' }
    };
}

module.exports = { 
    execute,
    marketType: 'Double Chance Favori'
};