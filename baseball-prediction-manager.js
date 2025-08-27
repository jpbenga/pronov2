const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const fs = require('fs');

const PORT = 5003;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v1.baseball.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    { name: 'MLB', id: 1 },
    { name: 'NPB', id: 2 },
    { name: 'KBO', id: 5 }
];
const BOOKMAKERS_PRIORITY = [
    { name: 'Pinnacle', id: 1 },
    { name: 'Bet365', id: 8 },
    { name: '1xBet', id: 6 } 
];
const MAX_ATTEMPTS = 5;
const EARLY_SEASON_THRESHOLD = 15;
const SERIES_LOOKBACK_DAYS = 5;

let predictions = {};
let analysisStatus = "Analyse non démarrée.";
let totalMatchesFound = 0;
let totalMatchesAnalyzed = 0;
const statsCache = new Map();

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function getOddsForFixture(gameId) {
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
    console.log(chalk.yellow(`       -> Aucune cote disponible pour match ${gameId}`));
    return null;
}

async function getRecentSeriesResults(homeTeamId, awayTeamId, leagueId, season, currentDate) {
    const seriesContext = { winsHome: 0, winsAway: 0, gamesPlayed: 0 };
    const lookbackDate = new Date(currentDate);
    lookbackDate.setDate(lookbackDate.getDate() - SERIES_LOOKBACK_DAYS);
    const startDate = lookbackDate.toISOString().split('T')[0];

    try {
        const response = await api.get('/games', {
            params: {
                league: leagueId,
                season: season,
                date_from: startDate,
                date_to: currentDate,
                team: homeTeamId
            }
        });
        const games = response.data.response.filter(g =>
            (g.teams.home.id === homeTeamId && g.teams.away.id === awayTeamId) ||
            (g.teams.home.id === awayTeamId && g.teams.away.id === homeTeamId)
        );
        games.forEach(game => {
            if (game.status.short === 'FT' || game.status.short === 'ENDED') {
                const homeScore = parseInt(game.scores.home.total) || 0;
                const awayScore = parseInt(game.scores.away.total) || 0;
                if (homeScore > awayScore) {
                    seriesContext.winsHome += game.teams.home.id === homeTeamId ? 1 : 0;
                    seriesContext.winsAway += game.teams.away.id === awayTeamId ? 1 : 0;
                } else if (awayScore > homeScore) {
                    seriesContext.winsHome += game.teams.home.id === homeTeamId ? 0 : 1;
                    seriesContext.winsAway += game.teams.away.id === awayTeamId ? 0 : 1;
                }
                seriesContext.gamesPlayed++;
            }
        });
    } catch (error) {
        console.log(chalk.yellow(`       -> Impossible de récupérer le contexte de la série: ${error.message}`));
    }
    return seriesContext;
}

function parseOdds(oddsData) {
    if (!oddsData || oddsData.length === 0) return {};
    const parsed = {};
    const gameOdds = oddsData[0];

    for (const bookmakerPriority of BOOKMAKERS_PRIORITY) {
        const bookmakerData = gameOdds.bookmakers.find(b => b.id === bookmakerPriority.id);
        
        if (bookmakerData) {
            console.log(chalk.blue(`       -> Cotes trouvées chez ${bookmakerPriority.name}.`));
            
            for (const bet of bookmakerData.bets) {
                const matchWinnerBet = bet.name === 'Match Winner' || bet.name === 'Home/Away';
                const totalRunsBet = bet.name.includes('Total Runs') || bet.name.includes('Over/Under');

                if (matchWinnerBet && bet.values) {
                    const homeOdd = parseFloat(bet.values.find(v => v.value === 'Home')?.odd);
                    const awayOdd = parseFloat(bet.values.find(v => v.value === 'Away')?.odd);
                    if (homeOdd && awayOdd) {
                        parsed['home_win'] = homeOdd;
                        parsed['away_win'] = awayOdd;
                        const isHomeFavorite = homeOdd < awayOdd;
                        parsed['favorite_win'] = isHomeFavorite ? homeOdd : awayOdd;
                        parsed['outsider_win'] = isHomeFavorite ? awayOdd : homeOdd;
                    }
                } else if (totalRunsBet && bet.values) {
                    const thresholdMatch = bet.name.match(/(\d+\.?\d*)/);
                    if (thresholdMatch) {
                        const threshold = thresholdMatch[0];
                        const overOdd = parseFloat(bet.values.find(v => v.value === 'Over')?.odd);
                        const underOdd = parseFloat(bet.values.find(v => v.value === 'Under')?.odd);

                        if (overOdd) parsed[`total_runs_over_${threshold}`] = overOdd;
                        if (underOdd) parsed[`total_runs_under_${threshold}`] = underOdd;
                    }
                }
            }
            return parsed; 
        }
    }

    console.log(chalk.magenta(`       -> Aucune cote trouvée chez les bookmakers prioritaires.`));
    return {};
}

function bayesianSmooth(avg, matchesPlayed, prior = 4.5, priorStrength = 5) {
    if (matchesPlayed > 0 && matchesPlayed < 6) {
        return (avg * matchesPlayed + prior * priorStrength) / (matchesPlayed + priorStrength);
    }
    return avg;
}

function getIntuitiveBestBet(scores, minConfidence = 60) {
    let bestBet = { market: 'N/A', score: minConfidence };
    let maxConfidence = 0;
    for (const market in scores) {
        const score = scores[market];
        const confidence = Math.abs(score - 50);
        if (score >= minConfidence && confidence > maxConfidence) {
            maxConfidence = confidence;
            bestBet = { market, score };
        }
    }
    if (bestBet.score < minConfidence) return { market: 'N/A', score: 0 };
    return bestBet;
}

class BaseballPoissonModel {
    constructor() { this.factorialCache = { 0: 1 }; }
    _factorial(n) {
        if (this.factorialCache[n] !== undefined) return this.factorialCache[n];
        if (n > 200) return Infinity;
        let r = this._factorial(n - 1) * n;
        this.factorialCache[n] = r;
        return r;
    }
    poissonProbability(k, lambda) {
        if (lambda <= 0 || k < 0) return k === 0 ? 1 : 0;
        return (Math.pow(lambda, k) * Math.exp(-lambda)) / this._factorial(k);
    }
    predict(xRuns_Home, xRuns_Away, seriesContext) {
        const markets = {};
        const maxRuns = 20;
        let homeWinProb = 0, awayWinProb = 0;
        const overUnderProbs = {};
        for (let i = 0; i <= maxRuns; i++) {
            for (let j = 0; j <= maxRuns; j++) {
                const prob = this.poissonProbability(i, xRuns_Home) * this.poissonProbability(j, xRuns_Away);
                if (isNaN(prob)) continue;
                if (i > j) homeWinProb += prob;
                else if (j > i) awayWinProb += prob;
                const total = i + j;
                for (let t = 0.5; t <= 20.5; t += 0.5) {
                    if (!overUnderProbs[t]) overUnderProbs[t] = { over: 0 };
                    if (total > t) overUnderProbs[t].over += prob;
                }
            }
        }
        if (seriesContext.gamesPlayed > 0) {
            const homeWinRate = seriesContext.winsHome / seriesContext.gamesPlayed;
            const awayWinRate = seriesContext.winsAway / seriesContext.gamesPlayed;
            const seriesBoost = 1 + (homeWinRate - awayWinRate) * 0.2;
            homeWinProb *= seriesBoost;
            awayWinProb /= seriesBoost;
        }
        const totalProb = homeWinProb + awayWinProb;
        if (totalProb > 0) {
            markets['home_win'] = (homeWinProb / totalProb) * 100;
            markets['away_win'] = (awayWinProb / totalProb) * 100;
            markets['favorite_win'] = Math.max(markets['home_win'], markets['away_win']);
            markets['outsider_win'] = Math.min(markets['home_win'], markets['away_win']);
        }
        for (const t in overUnderProbs) {
            markets[`total_runs_over_${t}`] = overUnderProbs[t].over * 100;
            markets[`total_runs_under_${t}`] = (1 - overUnderProbs[t].over) * 100;
        }
        return { markets };
    }
}

async function runPredictionEngine() {
    analysisStatus = "Analyse en cours...";
    totalMatchesFound = 0;
    totalMatchesAnalyzed = 0;
    predictions = {};
    console.log(chalk.blue.bold("--- Démarrage du moteur de prédiction ---"));
    const season = new Date().getFullYear();
    const poisson = new BaseballPoissonModel();
    const lowOccurrenceMarkets = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Analyse de : ${league.name}`));
        predictions[league.name] = [];

        try {
            const gamesResponse = await api.get('/games', { params: { league: league.id, season: season, date: date } });
            if (!gamesResponse.data?.response?.length) { console.log(chalk.gray(`   -> Aucun match trouvé pour ${date}.`)); continue; }
            const upcomingMatches = gamesResponse.data.response.filter(g => g.status.short === 'NS');
            
            totalMatchesFound += upcomingMatches.length;
            if (upcomingMatches.length === 0) { console.log(chalk.gray(`   -> Aucun match à venir pour ${date}.`)); continue; }
            
            console.log(`   - ${upcomingMatches.length} match(s) à venir trouvé(s) pour ${date}.`);

            for (const game of upcomingMatches) {
                const matchLabel = `${game.teams.home.name} vs ${game.teams.away.name}`;
                console.log(chalk.green(`\n     Calcul pour : ${matchLabel} (${date})`));
                const [homeStats, awayStats, oddsData, seriesContext] = await Promise.all([
                    getTeamStats(game.teams.home.id, league.id, season),
                    getTeamStats(game.teams.away.id, league.id, season),
                    getOddsForFixture(game.id),
                    getRecentSeriesResults(game.teams.home.id, game.teams.away.id, league.id, season, date)
                ]);
                if (!homeStats || !awayStats) { console.log(chalk.red(`       -> Échec: Stats manquantes.`)); continue; }

                totalMatchesAnalyzed++;
                
                const parsedOdds = parseOdds(oddsData);
                let homeAvgFor = parseFloat(homeStats.points.for.average.all) || 0;
                let homeAvgAgainst = parseFloat(homeStats.points.against.average.all) || 0;
                let awayAvgFor = parseFloat(awayStats.points.for.average.all) || 0;
                let awayAvgAgainst = parseFloat(awayStats.points.against.average.all) || 0;

                const matchesPlayed = homeStats.games.played.all;
                let isEarlySeason = matchesPlayed < EARLY_SEASON_THRESHOLD;

                if (isEarlySeason) {
                    console.log(chalk.yellow(`       -> Début de saison détecté (${matchesPlayed} matchs). Application des corrections.`));
                    const prevHomeStats = await getTeamStats(game.teams.home.id, league.id, season - 1);
                    const prevAwayStats = await getTeamStats(game.teams.away.id, league.id, season - 1);
                    let stabilityBoost = 1;
                    if (prevHomeStats && prevAwayStats) {
                        const prevHomeAvgFor = parseFloat(prevHomeStats.points.for.average.all) || homeAvgFor;
                        const prevAwayAvgFor = parseFloat(prevAwayStats.points.for.average.all) || awayAvgFor;
                        const homeStability = Math.abs(prevHomeAvgFor - homeAvgFor) < 0.5 ? 1.1 : 1;
                        const awayStability = Math.abs(prevAwayAvgFor - awayAvgFor) < 0.5 ? 1.1 : 1;
                        stabilityBoost = (homeStability + awayStability) / 2;
                        homeAvgFor = (0.8 * (prevHomeAvgFor || homeAvgFor)) + (0.2 * homeAvgFor);
                        homeAvgAgainst = (0.8 * (parseFloat(prevHomeStats.points.against.average.all) || homeAvgAgainst)) + (0.2 * homeAvgAgainst);
                        awayAvgFor = (0.8 * (prevAwayAvgFor || awayAvgFor)) + (0.2 * awayAvgFor);
                        awayAvgAgainst = (0.8 * (parseFloat(prevAwayStats.points.against.average.all) || awayAvgAgainst)) + (0.2 * awayAvgAgainst);
                    }
                    homeAvgFor = bayesianSmooth(homeAvgFor, matchesPlayed);
                    homeAvgAgainst = bayesianSmooth(homeAvgAgainst, matchesPlayed);
                    awayAvgFor = bayesianSmooth(awayAvgFor, matchesPlayed);
                    awayAvgAgainst = bayesianSmooth(awayAvgAgainst, matchesPlayed);
                }

                const projectedHomeRuns = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayRuns = (awayAvgFor + homeAvgAgainst) / 2;

                const lambdaBoost = matchesPlayed >= EARLY_SEASON_THRESHOLD ? 1.1 : 1;
                const xRuns_Home = projectedHomeRuns * lambdaBoost;
                const xRuns_Away = projectedAwayRuns * lambdaBoost;

                const poissonPreds = poisson.predict(xRuns_Home, xRuns_Away, seriesContext);
                let confidenceScores = poissonPreds.markets;

                for (const market in confidenceScores) {
                    if (['home_win', 'away_win', 'favorite_win', 'outsider_win'].includes(market)) {
                        confidenceScores[market] *= 1.2;
                    }
                     if (confidenceScores[market] > 99.9) {
                        confidenceScores[market] = 99.9;
                    }
                }

                const maxConfidence = Math.max(...Object.values(confidenceScores));
                if (maxConfidence < 60) {
                    console.log(chalk.yellow(`       -> Match ${matchLabel} exclu : aucune prédiction avec confiance ≥ 60%.`));
                    continue;
                }

                for (const market in confidenceScores) {
                    if (lowOccurrenceMarkets.includes(market)) {
                        delete confidenceScores[market];
                    }
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
                    isEarlySeason,
                    seriesContext: seriesContext.gamesPlayed > 0 ? 
                        `${seriesContext.winsHome}-${seriesContext.winsAway} (${seriesContext.gamesPlayed} match${seriesContext.gamesPlayed > 1 ? 's' : ''})` : 
                        'Aucun match récent'
                });
                await sleep(500);
            }
        } catch (error) {
            console.log(chalk.red.bold(`\n   ❌ ERREUR pour ${league.name} le ${date}: ${error.message}`));
        }
    }
    analysisStatus = `Prédictions prêtes. ${totalMatchesAnalyzed} matchs analysés sur ${totalMatchesFound} trouvés.`;
    console.log(chalk.blue.bold("\n--- PRÉDICTIONS TERMINÉES ---"));
    try {
        fs.writeFileSync('predictions_baseball.json', JSON.stringify(predictions, null, 2));
        console.log(chalk.magenta.bold('-> Prédictions sauvegardées dans le fichier predictions_baseball.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier JSON:'), error);
    }
}

app.get('/', (req, res) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const displayDate = tomorrow.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Prédictions des Matchs de Baseball</title>
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
            .series-context { font-size: 0.9em; color: #aaa; }
        </style>
        </head><body>
            <h1>Prédictions des Matchs de Baseball pour ${displayDate}</h1>
            <div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;
    if (Object.keys(predictions).length > 0) {
        for (const leagueName in predictions) {
            if (predictions[leagueName].length === 0) continue;
            html += `<div class="league-container"><h2>${leagueName}</h2><table>
                        <thead><tr><th>Match</th><th>Date</th><th>Heure</th><th>Contexte Série</th><th>Marché le + Fiable</th></tr></thead><tbody>`;
            predictions[leagueName].forEach(match => {
                const bestBet = getIntuitiveBestBet(match.scores, 60);
                const scoreClass = bestBet.score >= 90 ? 'score-very-high' : bestBet.score >= 75 ? 'score-high' : bestBet.score >= 60 ? 'score-mid' : 'score-low';
                const bestBetOdd = match.odds[bestBet.market];
                const earlySeasonTag = match.isEarlySeason ? '<span class="early-season-tag">Début de Saison</span>' : '';
                html += `
                            <tr>
                                <td>${match.matchLabel} ${earlySeasonTag}</td>
                                <td>${match.date}</td>
                                <td>${match.time}</td>
                                <td class="series-context">${match.seriesContext}</td>
                                <td>${bestBet.market} <span class="score ${scoreClass}">(${Math.round(bestBet.score)}%)</span> @ ${bestBetOdd ? bestBetOdd.toFixed(2) : '<span class="na">N/A</span>'}</td>
                            </tr>
                            <tr><td colspan="5" style="padding:0;">
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
        html += `<p>Aucune prédiction à afficher pour ${displayDate}. L'analyse est peut-être en cours...</p>`;
    }
    html += `</body></html>`;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur de prédiction démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    runPredictionEngine();
});