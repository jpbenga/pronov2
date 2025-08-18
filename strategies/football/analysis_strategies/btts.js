// strategies/football/analysis_strategies/btts.js

function calculateScore(projected, boundary, scale) {
    return Math.max(5, Math.min(95, 50 + (projected - boundary) * scale));
}

function execute(matchData) {
    const picks = [];

    // Extrait des données nécessaires
    const { homeStats, awayStats } = matchData;
    
    // --- Logique extraite de server.js ---
    const homeAvgFor = parseFloat(homeStats?.goals?.for?.average?.total || 0);
    const homeAvgAgainst = parseFloat(homeStats?.goals?.against?.average?.total || 0);
    const awayAvgFor = parseFloat(awayStats?.goals?.for?.average?.total || 0);
    const awayAvgAgainst = parseFloat(awayStats?.goals?.against?.average?.total || 0);

    const bttsPotential = ((homeAvgFor + awayAvgAgainst) / 2 + (awayAvgFor + homeAvgAgainst) / 2) / 2;
    // --- Fin de la logique ---

    // Calcul du score pour BTTS Oui
    const bttsYesScore = calculateScore(bttsPotential, 1.25, 40);
    picks.push({
        strategyName: 'BTTS',
        score: bttsYesScore,
        betType: 'BTTS',
        market: { id: 8, value: 'Yes' }
    });

    // Calcul du score pour BTTS Non
    const bttsNoScore = 100 - bttsYesScore;
    picks.push({
        strategyName: 'BTTS - Non',
        score: bttsNoScore,
        betType: 'BTTS - Non',
        market: { id: 8, value: 'No' }
    });
    
    return picks;
}

module.exports = { execute };