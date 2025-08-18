// strategies/football/analysis_strategies/doubleChance.js

function execute(matchData) {
    const strategyName = "Double Chance";
    
    // Extrait des données nécessaires
    const { home, away } = matchData.standings;
    const { rankGapThreshold } = matchData.settings.analysisParams;
    const leagueCoeff = matchData.league.coeff;

    // --- Logique extraite de server.js ---
    const rankGap = Math.abs(home.rank - away.rank);

    // Condition d'application de la stratégie
    if (rankGap < rankGapThreshold) {
        return null; 
    }
    
    let score = (rankGap - (rankGapThreshold - 1)) * 3 + 25;
    const favRank = Math.min(home.rank, away.rank);
    if (favRank <= 3) score += 30; else if (favRank <= 6) score += 25; else score += 15;
    score += rankGap * 1.8;
    score = Math.min(100, score * leagueCoeff);
    // --- Fin de la logique ---

    // La stratégie retourne un "pick" standardisé
    return {
        strategyName: strategyName,
        score: score,
        betType: `Double Chance ${matchData.favoriteName}`, // Bet-type spécifique
        market: { id: 12, value: matchData.isFavoriteHome ? 'Home or Draw' : 'Away or Draw' }
    };
}

module.exports = { execute };