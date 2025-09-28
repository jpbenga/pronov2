const axios = require('axios');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');

// --- CONFIGURATION ---
const PORT = 3002; // Port différent pour ne pas entrer en conflit
const API_KEY = 'VOTRE_CLÉ_API_HOCKEY_ICI'; // 🏒 IMPORTANT: Mettez votre propre clé API pour le hockey
const API_HOST = 'v1.hockey.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    { name: 'NHL', id: 57 },
    { name: 'KHL', id: 55 },
    { name: 'Sweden SHL', id: 47 },
    { name: 'Finland Liiga', id: 85 },
    { name: 'Czech Extraliga', id: 75 },
    { name: 'Switzerland National League', id: 63 },
    { name: 'Slovakia Extraliga', id: 91 }
];
const MAX_ATTEMPTS = 5;

// --- VARIABLES GLOBALES ---
let predictions = {};
let analysisStatus = "Analyse non démarrée.";
let totalMatchesFound = 0;
let totalMatchesAnalyzed = 0;
const statsCache = new Map();

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- FONCTIONS UTILITAIRES ---
async function getTeamStats(teamId, leagueId, season) {
    const cacheKey = `${teamId}-${leagueId}-${season}`;
    if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            const response = await api.get('/teams/statistics', { params: { team: teamId, league: leagueId, season: season } });
            if (response.data && response.data.response) {
                statsCache.set(cacheKey, response.data.response);
                return response.data.response;
            }
        } catch (error) {
            console.log(chalk.yellow(`       -> Tentative ${attempts}/${MAX_ATTEMPTS} (stats équipe ${teamId}, saison ${season}) échouée`));
        }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`       -> ERREUR FINALE: Stats pour équipe ${teamId}, saison ${season}`));
    return null;
}

async function getOddsForGame(gameId) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            const response = await api.get('/odds', { params: { game: gameId } });
            if (response.data && response.data.response.length > 0) {
                return response.data.response;
            }
        } catch (error) {
            const status = error.response ? `API Error ${error.response.status}` : error.message;
            console.log(chalk.yellow(`       -> Tentative ${attempts}/${MAX_ATTEMPTS} (cotes) échouée: ${status}`));
        }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`       -> ERREUR FINALE: Cotes pour match ${gameId}`));
    return null;
}

function parseOdds(oddsData) {
    if (!oddsData || oddsData.length === 0) return {};
    const parsed = {};
    const gameOdds = oddsData[0];
    for (const bookmaker of gameOdds.bookmakers) {
        // Vainqueur du match (Moneyline) - ID 2
        const matchWinnerBet = bookmaker.bets.find(b => b.id === 2);
        if (matchWinnerBet) {
            const homeOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Home')?.odd);
            const awayOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Away')?.odd);
            if (homeOdd && !parsed['home_win']) parsed['home_win'] = homeOdd;
            if (awayOdd && !parsed['away_win']) parsed['away_win'] = awayOdd;
            if (homeOdd && awayOdd) {
                 const isHomeFavorite = homeOdd < awayOdd;
                 if (!parsed['favorite_win']) parsed['favorite_win'] = isHomeFavorite ? homeOdd : awayOdd;
                 if (!parsed['outsider_win']) parsed['outsider_win'] = isHomeFavorite ? awayOdd : homeOdd;
            }
        }

        // Total de buts (Over/Under) - ID 4
        const totalGoalsBet = bookmaker.bets.find(b => b.id === 4);
        if (totalGoalsBet) {
            totalGoalsBet.values.forEach(v => {
                const key = `match_${v.value.toLowerCase().replace(' ', '_')}`;
                if (!parsed[key]) parsed[key] = parseFloat(v.odd);
            });
        }
    }
    return parsed;
}


function bayesianSmooth(avg, matchesPlayed, prior = 3.0, priorStrength = 5) { // Prior ajusté pour le hockey
    if (matchesPlayed > 0 && matchesPlayed < 6) {
        return (avg * matchesPlayed + prior * priorStrength) / (matchesPlayed + priorStrength);
    }
    return avg;
}

function getIntuitiveBestBet(scores, minConfidence = 60) {
    let bestBet = { market: 'N/A', score: 0 };
    for (const market in scores) {
        const score = scores[market];
        if (score > bestBet.score) {
            bestBet = { market, score };
        }
    }
    if (bestBet.score < minConfidence) return { market: 'N/A', score: 0 }; // Aucun pari fiable
    return bestBet;
}

// --- MODÈLE POISSON (simplifié pour le Hockey) ---
class PoissonModel {
    constructor() { this.factorialCache = { 0: 1, 1: 1 }; }
    _factorial(n) { if (this.factorialCache[n] !== undefined) return this.factorialCache[n]; let r = this._factorial(n - 1) * n; this.factorialCache[n] = r; return r; }
    poissonProbability(k, lambda) { if (lambda <= 0 || k < 0) return k === 0 ? 1 : 0; return (Math.pow(lambda, k) * Math.exp(-lambda)) / this._factorial(k); }
    
    _calculateProbs(lambda) {
        const probs = Array(11).fill(0).map((_, k) => this.poissonProbability(k, lambda)); // Augmenté à 10 buts
        const cumulativeProbs = probs.reduce((acc, p, i) => { acc.push((acc[i-1] || 0) + p); return acc; }, []);
        return {
            'over_4.5': (1 - cumulativeProbs[4]) * 100, 'under_4.5': cumulativeProbs[4] * 100,
            'over_5.5': (1 - cumulativeProbs[5]) * 100, 'under_5.5': cumulativeProbs[5] * 100,
            'over_6.5': (1 - cumulativeProbs[6]) * 100, 'under_6.5': cumulativeProbs[6] * 100,
            'over_7.5': (1 - cumulativeProbs[7]) * 100, 'under_7.5': cumulativeProbs[7] * 100,
        };
    }

    predict(lambdaHome, lambdaAway) {
        const markets = {};
        const maxGoals = 10;
        let homeWinProb = 0, awayWinProb = 0;

        for (let i = 0; i <= maxGoals; i++) {
            for (let j = 0; j <= maxGoals; j++) {
                if (i === j) continue; // On ignore les nuls pour le calcul de la victoire
                const prob = this.poissonProbability(i, lambdaHome) * this.poissonProbability(j, lambdaAway);
                if (i > j) homeWinProb += prob;
                else if (j > i) awayWinProb += prob;
            }
        }
        
        const totalWinProb = homeWinProb + awayWinProb;
        if (totalWinProb > 0) {
            markets['home_win'] = (homeWinProb / totalWinProb) * 100;
            markets['away_win'] = (awayWinProb / totalWinProb) * 100;
        } else {
            markets['home_win'] = 50;
            markets['away_win'] = 50;
        }

        markets['favorite_win'] = Math.max(markets['home_win'], markets['away_win']);
        markets['outsider_win'] = Math.min(markets['home_win'], markets['away_win']);

        const matchProbs = this._calculateProbs(lambdaHome + lambdaAway);
        for(const key in matchProbs) { markets[`match_${key}`] = matchProbs[key]; }
        
        return { markets };
    }
}

// --- MOTEUR DE PRÉDICTION ---
async function runPredictionEngine() {
    analysisStatus = "Analyse en cours...";
    totalMatchesFound = 0;
    totalMatchesAnalyzed = 0;
    predictions = {};
    console.log(chalk.blue.bold("--- 🏒 Démarrage du moteur de prédiction Hockey ---"));

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const season = currentMonth >= 7 ? `${currentYear}-${currentYear + 1}` : `${currentYear - 1}-${currentYear}`;
    const dateToFetch = new Date().toISOString().split('T')[0];
    const poisson = new PoissonModel();

    console.log(chalk.gray(`\nRecherche des matchs pour le ${dateToFetch} (Saison: ${season})`));

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Analyse de : ${league.name}`));
        try {
            const gamesResponse = await api.get('/games', { params: { league: league.id, season: season, date: dateToFetch } });
            const upcomingGames = gamesResponse.data.response.filter(g => g.status.short === 'NS');
            
            totalMatchesFound += upcomingGames.length;
            if (upcomingGames.length === 0) {
                console.log(chalk.gray(`   -> Aucun match à venir trouvé pour cette ligue à cette date.`));
                continue;
            }
            
            console.log(`   - ${upcomingGames.length} match(s) à venir trouvé(s).`);
            predictions[league.name] = [];

            for (const game of upcomingGames) {
                const matchLabel = `${game.teams.home.name} vs ${game.teams.away.name}`;
                console.log(chalk.green(`\n     Calcul pour : ${matchLabel}`));
                
                const [homeStats, awayStats, oddsData] = await Promise.all([
                    getTeamStats(game.teams.home.id, league.id, season),
                    getTeamStats(game.teams.away.id, league.id, season),
                    getOddsForGame(game.id)
                ]);

                if (!homeStats || !awayStats || !homeStats.games) {
                    console.log(chalk.red(`       -> Échec: Stats manquantes.`));
                    continue;
                }
                
                totalMatchesAnalyzed++;
                const parsedOdds = parseOdds(oddsData);

                const matchesPlayed = homeStats.games.played;
                let isEarlySeason = matchesPlayed < 6;

                let homeAvgFor = parseFloat(homeStats.goals.for.average) || 0;
                let homeAvgAgainst = parseFloat(homeStats.goals.against.average) || 0;
                let awayAvgFor = parseFloat(awayStats.goals.for.average) || 0;
                let awayAvgAgainst = parseFloat(awayStats.goals.against.average) || 0;

                if (isEarlySeason) {
                    console.log(chalk.yellow(`       -> Début de saison détecté (${matchesPlayed} matchs). Utilisation du lissage.`));
                    homeAvgFor = bayesianSmooth(homeAvgFor, matchesPlayed);
                    homeAvgAgainst = bayesianSmooth(homeAvgAgainst, matchesPlayed);
                    awayAvgFor = bayesianSmooth(awayAvgFor, matchesPlayed);
                    awayAvgAgainst = bayesianSmooth(awayAvgAgainst, matchesPlayed);
                }

                const projectedHomeGoals = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayGoals = (awayAvgFor + homeAvgAgainst) / 2;

                const poissonPreds = poisson.predict(projectedHomeGoals, projectedAwayGoals);
                let confidenceScores = poissonPreds.markets;

                const maxConfidence = Math.max(...Object.values(confidenceScores));
                if (maxConfidence < 60) {
                    console.log(chalk.yellow(`       -> Match ${matchLabel} exclu : aucune prédiction avec confiance ≥ 60%.`));
                    continue;
                }

                const gameDate = new Date(game.date);
                predictions[league.name].push({
                    matchLabel,
                    homeTeam: game.teams.home.name,
                    awayTeam: game.teams.away.name,
                    homeLogo: game.teams.home.logo,
                    awayLogo: game.teams.away.logo,
                    date: gameDate.toLocaleDateString('fr-FR'),
                    time: gameDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                    scores: confidenceScores,
                    odds: parsedOdds,
                    isEarlySeason
                });
                await sleep(500);
            }
        } catch (error) {
            console.log(chalk.red.bold(`\n   ❌ ERREUR pour ${league.name}: ${error.message}`));
        }
    }
    analysisStatus = `Prédictions prêtes. ${totalMatchesAnalyzed} matchs analysés sur ${totalMatchesFound} trouvés.`;
    console.log(chalk.blue.bold("\n--- PRÉDICTIONS TERMINÉES ---"));
    try {
        fs.writeFileSync('predictions_hockey_du_jour.json', JSON.stringify(predictions, null, 2));
        console.log(chalk.magenta.bold('-> Prédictions sauvegardées dans le fichier predictions_hockey_du_jour.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier JSON:'), error);
    }
}

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Prédictions Hockey</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            h1, h2 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
            .status { background-color: #1e1e1e; border: 1px solid #373737; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 1.1em; }
            .league-container { margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; background-color: #1e1e1e; border-radius: 8px; overflow: hidden; }
            th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #373737; }
            th { background-color: #2a2a2a; }
            summary { cursor: pointer; padding: 12px 15px; background-color: #1e1e1e; font-style: italic; color: #aaa; }
            summary:hover { background-color: #2a2a2a; }
            .details-table { margin: 10px 20px; }
            .score { font-weight: bold; }
            .score-high { color: #03dac6; } .score-mid { color: #f0e68c; }
            .score-very-high { color: #00ff00; font-weight: bold; }
            .na { color: #666; }
            .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
        </style>
        </head><body>
            <h1>🏒 Prédictions des Matchs de Hockey à Venir</h1>
            <div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;
    if (Object.keys(predictions).length > 0) {
        for (const leagueName in predictions) {
            html += `<div class="league-container"><h2>${leagueName}</h2><table>
                        <thead><tr><th>Match</th><th>Date</th><th>Heure</th><th>Marché le + Fiable</th></tr></thead><tbody>`;
            predictions[leagueName].forEach(match => {
                const bestBet = getIntuitiveBestBet(match.scores, 60);
                const scoreClass = bestBet.score >= 90 ? 'score-very-high' : bestBet.score >= 75 ? 'score-high' : 'score-mid';
                const bestBetOdd = match.odds[bestBet.market];
                const earlySeasonTag = match.isEarlySeason ? '<span class="early-season-tag">Début de Saison</span>' : '';
                html += `
                    <tr>
                        <td>${match.matchLabel} ${earlySeasonTag}</td>
                        <td>${match.date}</td>
                        <td>${match.time}</td>
                        <td>${bestBet.market} <span class="score ${scoreClass}">(${Math.round(bestBet.score)}%)</span> @ ${bestBetOdd ? bestBetOdd.toFixed(2) : '<span class="na">N/A</span>'}</td>
                    </tr>
                    <tr><td colspan="4" style="padding:0;">
                        <details>
                            <summary>Voir tous les scores et cotes</summary>
                            <table class="details-table">
                                <thead><tr><th>Marché</th><th>Score de Confiance</th><th>Cote</th></tr></thead>
                                <tbody>`;
                const sortedMarkets = Object.keys(match.scores).sort((a, b) => match.scores[b] - match.scores[a]);
                for (const market of sortedMarkets) {
                    const score = match.scores[market];
                    const odd = match.odds[market];
                    const sClass = score >= 90 ? 'score-very-high' : score >= 75 ? 'score-high' : 'score-mid';
                    if (score >= 60) {
                         html += `<tr>
                            <td>${market}</td>
                            <td class="score ${sClass}">${Math.round(score)}%</td>
                            <td>${odd ? odd.toFixed(2) : '<span class="na">N/A</span>'}</td>
                        </tr>`;
                    }
                }
                html += `</tbody></table></details></td></tr>`;
            });
            html += `</tbody></table></div>`;
        }
    } else {
        html += `<p>Aucune prédiction à afficher. L'analyse est peut-être en cours ou aucun match n'est prévu aujourd'hui...</p>`;
    }
    html += `</body></html>`;
    res.send(html);
});

// --- DÉMARRAGE ---
app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur de prédiction démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    runPredictionEngine();
});