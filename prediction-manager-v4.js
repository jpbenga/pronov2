const fs = require('fs');

const backtestBilan = JSON.parse(fs.readFileSync('bilan_backtest.json', 'utf-8'));
const predictionsDuJour = JSON.parse(fs.readFileSync('predictions_du_jour.json', 'utf-8'));

const minOdd = 1.35;
const minSuccessRateForTranche = 85;
const minTotalForTranche = 10;

function getTranche(confidence) {
    if (confidence >= 90) return '90-100';
    if (confidence >= 80) return '80-89';
    if (confidence >= 70) return '70-79';
    if (confidence >= 60) return '60-69';
    return '0-59';
}

// 1. Identifier les marchés éligibles et leurs tranches valides
const eligibleMarkets = {};
if (backtestBilan && backtestBilan.perMarketSummary) {
    for (const market in backtestBilan.perMarketSummary) {
        const marketStats = backtestBilan.perMarketSummary[market];
        const validTranches = [];
        let isMarketEligible = false;

        for (const tranche in marketStats) {
            const stats = marketStats[tranche];
            if (stats.total >= minTotalForTranche) {
                const successRate = (stats.success / stats.total) * 100;
                if (successRate >= minSuccessRateForTranche) {
                    isMarketEligible = true;
                    validTranches.push(tranche);
                }
            }
        }

        if (isMarketEligible) {
            eligibleMarkets[market] = {
                validTranches: validTranches,
                stats: marketStats
            };
        }
    }
}

// 2. Itérer à travers les prédictions et appliquer les filtres
let finalSelectedPredictions = [];
for (const league in predictionsDuJour) {
    const matches = predictionsDuJour[league];
    if (Array.isArray(matches)) {
        matches.forEach(match => {
            if (match && match.scores && match.odds) {
                for (const market in match.scores) {
                    const confidence = match.scores[market];
                    const odd = match.odds[market];

                    // Filtre 1: Cote
                    if (odd && odd >= minOdd) {
                        const marketInfo = eligibleMarkets[market];
                        // Filtre 2: Éligibilité du marché
                        if (marketInfo) {
                            const tranche = getTranche(confidence);
                            // Filtre 3: Performance de la tranche
                            if (marketInfo.validTranches.includes(tranche)) {
                                finalSelectedPredictions.push({
                                    market: market,
                                    confidence: confidence,
                                    odds: odd,
                                    match_details: {
                                        home_team: match.homeTeam,
                                        away_team: match.awayTeam,
                                        date: match.date
                                    },
                                    marketStats: marketInfo.stats
                                });
                            }
                        }
                    }
                }
            }
        });
    }
}

// Trier les prédictions par confiance décroissante
finalSelectedPredictions.sort((a, b) => b.confidence - a.confidence);

// Sauvegarder les prédictions sélectionnées
fs.writeFileSync('predictions_selectionnees.json', JSON.stringify(finalSelectedPredictions, null, 2));

console.log(`${finalSelectedPredictions.length} prédictions sélectionnées selon la nouvelle logique et sauvegardées dans predictions_selectionnees.json`);