const axios = require('axios');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');

// --- CONFIGURATION ---
const PORT = 3002;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v1.rugby.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    { name: 'Bunnings NPC', id: 80 },
    { name: 'Top 14', id: 16 },
    { name: 'Premiership Rugby', id: 13 }
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
            console.log(chalk.yellow(`      -> Tentative ${attempts}/${MAX_ATTEMPTS} (stats) échouée`));
        }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`      -> ERREUR FINALE: Stats pour équipe ${teamId}`));
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
            console.log(chalk.yellow(`      -> Tentative ${attempts}/${MAX_ATTEMPTS} (cotes) échouée: ${status}`));
        }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`      -> ERREUR FINALE: Cotes pour match ${gameId}`));
    return null;
}

function parseOdds(oddsData) {
    if (!oddsData || oddsData.length === 0) return {};
    const parsed = {};
    const bookmaker = oddsData[0]?.bookmakers?.[0]; // On prend le premier bookmaker par défaut
    if (!bookmaker) return {};

    const matchWinnerBet = bookmaker.bets.find(b => b.name === 'Match Winner');
    if (matchWinnerBet) {
        const homeOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Home')?.odd);
        const awayOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Away')?.odd);
        if (homeOdd && awayOdd) {
            const isHomeFavorite = homeOdd < awayOdd;
            parsed['favorite_win'] = isHomeFavorite ? homeOdd : awayOdd;
            parsed['outsider_win'] = isHomeFavorite ? awayOdd : homeOdd;
        }
    }
    return parsed;
}


function bayesianSmooth(avg, matchesPlayed, prior = 20.0, priorStrength = 5) {
    if (matchesPlayed > 0 && matchesPlayed < 6) {
        return (avg * matchesPlayed + prior * priorStrength) / (matchesPlayed + priorStrength);
    }
    return avg;
}

function getIntuitiveBestBet(scores, minConfidence = 60) {
    let bestBet = { market: 'N/A', score: 0 };
    let maxConfidence = 0;
    
    for (const market in scores) {
        const score = scores[market];
        if (score >= minConfidence && score > bestBet.score) {
             bestBet = { market, score };
        }
    }
    if (bestBet.score < minConfidence) return { market: 'Aucun pari fiable', score: 0 };
    return bestBet;
}

// --- MODÈLE POISSON ADAPTÉ AU RUGBY ---
class PoissonModel {
    constructor() { this.factorialCache = { 0: 1, 1: 1 }; }
    _factorial(n) { if (this.factorialCache[n] !== undefined) return this.factorialCache[n]; let r = this._factorial(n - 1) * n; this.factorialCache[n] = r; return r; }
    poissonProbability(k, lambda) { if (lambda <= 0 || k < 0) return k === 0 ? 1 : 0; return (Math.pow(lambda, k) * Math.exp(-lambda)) / this._factorial(k); }
    
    _calculateProbs(lambda) {
        const probs = Array(101).fill(0).map((_, k) => this.poissonProbability(k, lambda));
        const cumulativeProbs = probs.reduce((acc, p, i) => { acc.push((acc[i-1] || 0) + p); return acc; }, []);
        return {
            'over_30.5': (1 - cumulativeProbs[30]) * 100, 'under_30.5': cumulativeProbs[30] * 100,
            'over_40.5': (1 - cumulativeProbs[40]) * 100, 'under_40.5': cumulativeProbs[40] * 100,
            'over_50.5': (1 - cumulativeProbs[50]) * 100, 'under_50.5': cumulativeProbs[50] * 100,
            'over_60.5': (1 - cumulativeProbs[60]) * 100, 'under_60.5': cumulativeProbs[60] * 100,
        };
    }

    predict(lambdas, homeStats, awayStats, projectedHomePoints, projectedAwayPoints) {
        const { home, away } = lambdas;
        const markets = {};
        
        Object.assign(markets, ...Object.entries({ home, away }).map(([prefix, lambda]) => {
            const segmentProbs = this._calculateProbs(lambda);
            const renamedProbs = {};
            for (const key in segmentProbs) { renamedProbs[`${prefix}_${key}`] = segmentProbs[key]; }
            return renamedProbs;
        }));

        const maxPoints = 100;
        let homeWinProb = 0, awayWinProb = 0;
        for (let i = 0; i <= maxPoints; i++) {
            for (let j = 0; j < i; j++) {
                homeWinProb += this.poissonProbability(i, home) * this.poissonProbability(j, away);
                awayWinProb += this.poissonProbability(j, home) * this.poissonProbability(i, away);
            }
        }

        const homeFormFactor = homeStats.form ? (parseFloat(homeStats.form) / 100) : 0.5;
        const awayFormFactor = awayStats.form ? (parseFloat(awayStats.form) / 100) : 0.5;
        const pointDisparity = Math.abs(projectedHomePoints - projectedAwayPoints);
        const disparityBoost = pointDisparity > 10 ? 1 + (pointDisparity - 10) * 0.1 : 1;
        homeWinProb *= (1 + (homeFormFactor - awayFormFactor) * 0.3) * disparityBoost;
        awayWinProb *= (1 + (awayFormFactor - homeFormFactor) * 0.3) * disparityBoost;
        const totalProb = homeWinProb + awayWinProb;
        
        markets['favorite_win'] = (Math.max(homeWinProb, awayWinProb) / totalProb) * 100;
        markets['outsider_win'] = (Math.min(homeWinProb, awayWinProb) / totalProb) * 100;

        const matchProbs = this._calculateProbs(home + away);
        for (const key in matchProbs) { markets[`match_${key}`] = matchProbs[key]; }
        
        return { markets };
    }
}

// --- MOTEUR DE PRÉDICTION ---
async function runPredictionEngine() {
    analysisStatus = "Analyse en cours...";
    totalMatchesFound = 0;
    totalMatchesAnalyzed = 0;
    predictions = {};
    console.log(chalk.blue.bold("--- Démarrage du moteur de prédiction Rugby ---"));
    const season = new Date().getFullYear();
    const poisson = new PoissonModel();

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Analyse de : ${league.name}`));
        try {
            const dates = Array.from({ length: 7 }, (_, i) => {
                const date = new Date();
                date.setDate(date.getDate() + i);
                return date.toISOString().split('T')[0];
            });

            let upcomingMatches = [];
            for(const date of dates) {
                const fixturesResponse = await api.get('/games', { params: { league: league.id, season: season, date: date } });
                if (fixturesResponse.data.response.length > 0) {
                     upcomingMatches.push(...fixturesResponse.data.response.filter(f => f.status.short === 'NS'));
                }
            }
            
            totalMatchesFound += upcomingMatches.length;
            if (upcomingMatches.length === 0) { console.log(chalk.gray(`   -> Aucun match à venir trouvé dans les 7 prochains jours.`)); continue; }
            
            console.log(`   - ${upcomingMatches.length} match(s) à venir trouvé(s).`);
            predictions[league.name] = [];

            for (const fixture of upcomingMatches) {
                const matchLabel = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
                console.log(chalk.green(`\n     Calcul pour : ${matchLabel}`));
                const [homeStats, awayStats, oddsData] = await Promise.all([
                    getTeamStats(fixture.teams.home.id, league.id, season),
                    getTeamStats(fixture.teams.away.id, league.id, season),
                    getOddsForGame(fixture.id)
                ]);
                if (!homeStats || !awayStats) { console.log(chalk.red(`       -> Échec: Stats manquantes.`)); continue; }

                totalMatchesAnalyzed++;
                
                const parsedOdds = parseOdds(oddsData);
                let homeAvgFor = parseFloat(homeStats.goals.for.average.all) || 0;
                let homeAvgAgainst = parseFloat(homeStats.goals.against.average.all) || 0;
                let awayAvgFor = parseFloat(awayStats.goals.for.average.all) || 0;
                let awayAvgAgainst = parseFloat(awayStats.goals.against.average.all) || 0;
                const matchesPlayed = homeStats.games.played.all;
                let isEarlySeason = matchesPlayed < 6;

                if (isEarlySeason) {
                    console.log(chalk.yellow(`       -> Début de saison détecté (${matchesPlayed} matchs). Application des corrections.`));
                    const prevHomeStats = await getTeamStats(fixture.teams.home.id, league.id, season - 1);
                    const prevAwayStats = await getTeamStats(fixture.teams.away.id, league.id, season - 1);
                    if (prevHomeStats && prevAwayStats) {
                        homeAvgFor = (0.8 * (parseFloat(prevHomeStats.goals.for.average.all) || homeAvgFor)) + (0.2 * homeAvgFor);
                        homeAvgAgainst = (0.8 * (parseFloat(prevHomeStats.goals.against.average.all) || homeAvgAgainst)) + (0.2 * homeAvgAgainst);
                        awayAvgFor = (0.8 * (parseFloat(prevAwayStats.goals.for.average.all) || awayAvgFor)) + (0.2 * awayAvgFor);
                        awayAvgAgainst = (0.8 * (parseFloat(prevAwayStats.goals.against.average.all) || awayAvgAgainst)) + (0.2 * awayAvgAgainst);
                    }
                    homeAvgFor = bayesianSmooth(homeAvgFor, matchesPlayed);
                    homeAvgAgainst = bayesianSmooth(homeAvgAgainst, matchesPlayed);
                    awayAvgFor = bayesianSmooth(awayAvgFor, matchesPlayed);
                    awayAvgAgainst = bayesianSmooth(awayAvgAgainst, matchesPlayed);
                }

                const projectedHomePoints = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayPoints = (awayAvgFor + homeAvgAgainst) / 2;
                const lambdaBoost = matchesPlayed >= 6 ? 1.1 : 1;
                const lambdas = {
                    home: projectedHomePoints * lambdaBoost,
                    away: projectedAwayPoints * lambdaBoost
                };

                const poissonPreds = poisson.predict(lambdas, homeStats, awayStats, projectedHomePoints, projectedAwayPoints);
                let confidenceScores = poissonPreds.markets;

                const maxConfidence = Math.max(...Object.values(confidenceScores));
                if (maxConfidence < 60) {
                    console.log(chalk.yellow(`       -> Match ${matchLabel} exclu : aucune prédiction avec confiance ≥ 60%.`));
                    continue;
                }

                const fixtureDate = new Date(fixture.date);
                predictions[league.name].push({
                    matchLabel,
                    homeTeam: fixture.teams.home.name,
                    awayTeam: fixture.teams.away.name,
                    homeLogo: fixture.teams.home.logo,
                    awayLogo: fixture.teams.away.logo,
                    date: fixtureDate.toLocaleDateString('fr-FR'),
                    time: fixtureDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
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
        fs.writeFileSync('rugby_predictions_du_jour.json', JSON.stringify(predictions, null, 2));
        console.log(chalk.magenta.bold('-> Prédictions sauvegardées dans le fichier rugby_predictions_du_jour.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier JSON:'), error);
    }
}

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Prédictions Rugby</title>
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
            .score-high { color: #03dac6; } .score-mid { color: #f0e68c; } .score-low { color: #cf6679; }
            .score-very-high { color: #00ff00; font-weight: bold; }
            .na { color: #666; }
            .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
        </style>
        </head><body>
            <h1>Prédictions Rugby des Matchs à Venir</h1>
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
                const sortedMarkets = Object.keys(match.scores).sort();
                for (const market of sortedMarkets) {
                    const score = match.scores[market];
                    const odd = match.odds[market];
                    const sClass = score >= 90 ? 'score-very-high' : score >= 75 ? 'score-high' : score >= 60 ? 'score-mid' : 'score-low';
                    html += `<tr>
                                <td>${market}</td>
                                <td class="score ${sClass}">${Math.round(score)}%</td>
                                <td>${odd ? odd.toFixed(2) : '<span class="na">N/A</span>'}</td>
                            </tr>`;
                }
                html += `</tbody></table></details></td></tr>`;
            });
            html += `</tbody></table></div>`;
        }
    } else {
        html += `<p>Aucune prédiction à afficher. L'analyse est peut-être en cours...</p>`;
    }
    html += `</body></html>`;
    res.send(html);
});

// --- DÉMARRAGE ---
app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur de prédiction démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    runPredictionEngine();
});