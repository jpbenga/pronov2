const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const fs = require('fs');

const PORT = 5002;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v1.baseball.api-sports.io';
const CURRENT_SEASON = new Date().getFullYear();
const DAYS_TO_ANALYZE = 7;
const EARLY_SEASON_THRESHOLD = 15;
const MAX_REQUESTS_PER_MINUTE = 300;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY = 500;

const LEAGUES_TO_ANALYZE = [
    { id: 1, name: 'MLB' },
    { id: 2, name: 'NPB' },
    { id: 5, name: 'KBO' }
];

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 15000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const statsCache = new Map();

let analysisStatus = "Analyse non démarrée.";
let detailedResults = [];
let trancheAnalysis = {};
let globalTranches = {};
let diagnostics = [];

class RateLimiter {
    constructor(requestsPerMinute) {
        this.limit = requestsPerMinute;
        this.requestTimestamps = [];
    }
    async acquire() {
        const now = Date.now();
        while (this.requestTimestamps.length >= this.limit) {
            const timeSinceOldest = now - this.requestTimestamps[0];
            if (timeSinceOldest < 60000) {
                const waitTime = 60000 - timeSinceOldest;
                await sleep(waitTime);
            }
            this.requestTimestamps.shift();
        }
        this.requestTimestamps.push(Date.now());
    }
}

const rateLimiter = new RateLimiter(MAX_REQUESTS_PER_MINUTE);

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
    predict(xRuns_Home, xRuns_Away) {
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
                for (let t = 0.5; t <= 20.5; t++) {
                    if (!overUnderProbs[t]) overUnderProbs[t] = { over: 0 };
                    if (total > t) overUnderProbs[t].over += prob;
                }
            }
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
        return markets;
    }
}

async function getTeamStats(teamId, season, leagueId) {
    const cacheKey = `${teamId}-${season}-${leagueId}`;
    if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);

    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        await rateLimiter.acquire();
        try {
            const response = await api.get('/teams/statistics', { params: { league: leagueId, season, team: teamId } });
            if (response.data?.response) {
                statsCache.set(cacheKey, response.data.response);
                return response.data.response;
            }
        } catch (error) {
            console.log(chalk.yellow(`Tentative ${attempts}/${MAX_ATTEMPTS} échouée pour équipe ${teamId}, ligue ${leagueId}, saison ${season}: ${error.message}`));
            if (attempts < MAX_ATTEMPTS) await sleep(RETRY_DELAY);
        }
    }
    console.log(chalk.red(`Échec stats équipe ${teamId}, ligue ${leagueId}, saison ${season} après ${MAX_ATTEMPTS} tentatives.`));
    return null;
}

async function getGameDetails(gameId) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        await rateLimiter.acquire();
        try {
            const response = await api.get('/games', { params: { id: gameId } });
            if (response.data?.response?.length > 0) return response.data.response[0];
        } catch (error) {
            console.log(chalk.yellow(`Tentative ${attempts}/${MAX_ATTEMPTS} échouée pour match ${gameId}: ${error.message}`));
            if (attempts < MAX_ATTEMPTS) await sleep(RETRY_DELAY);
        }
    }
    console.log(chalk.red(`Échec détails match ${gameId} après ${MAX_ATTEMPTS} tentatives.`));
    return null;
}

async function getGamesForDate(date, leagueId) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        await rateLimiter.acquire();
        try {
            const response = await api.get('/games', { params: { league: leagueId, season: CURRENT_SEASON, date: date } });
            if (response.data && response.data.response) {
                const games = response.data.response;
                const statusCounts = games.reduce((acc, game) => { acc[game.status.short || 'Unknown'] = (acc[game.status.short || 'Unknown'] || 0) + 1; return acc; }, {});
                const finishedGames = games.filter(g => g.status.short === 'FT');
                diagnostics.push({ date: date, leagueId: leagueId, totalGames: games.length, finishedGames: finishedGames.length, statusCounts });
                return finishedGames;
            }
        } catch (error) {
            console.log(chalk.yellow(`Tentative ${attempts}/${MAX_ATTEMPTS} échouée pour date ${date}, ligue ${leagueId}: ${error.message}`));
            if (attempts < MAX_ATTEMPTS) await sleep(RETRY_DELAY);
        }
    }
    console.log(chalk.red(`Échec pour la date ${date} et ligue ${leagueId} après ${MAX_ATTEMPTS} tentatives.`));
    diagnostics.push({ date: date, leagueId: leagueId, totalGames: 0, finishedGames: 0, statusCounts: {} });
    return [];
}

function analyzeMarketOutcomes(game, odds) {
    const outcomes = {};
    if (!game.scores?.home?.total || !game.scores?.away?.total) return outcomes;
    
    const { home, away } = game.scores;
    const totalRuns = home.total + away.total;
    const homeRuns = home.total;
    const awayRuns = away.total;

    const winner = homeRuns > awayRuns ? 'home_win' : 'away_win';
    outcomes['home_win'] = winner === 'home_win';
    outcomes['away_win'] = winner === 'away_win';

    if (odds.favorite_win) {
        const favoriteWon = (odds.home_win < odds.away_win && winner === 'home_win') || (odds.away_win < odds.home_win && winner === 'away_win');
        outcomes['favorite_win'] = favoriteWon;
        outcomes['outsider_win'] = !favoriteWon;
    }
    
    for (let i = 0.5; i <= 20.5; i++) {
        outcomes[`total_runs_over_${i}`] = totalRuns > i;
        outcomes[`total_runs_under_${i}`] = totalRuns < i;
    }
    
    return outcomes;
}


const initTrancheObject = () => ({
    '0-59': { success: 0, total: 0 }, '60-69': { success: 0, total: 0 },
    '70-79': { success: 0, total: 0 }, '80-89': { success: 0, total: 0 },
    '90-100': { success: 0, total: 0 }
});

function generateBilanFile(totalMatchesAnalyzed, trancheAnalysis) {
    const marketOccurrences = {};
    for (const market in trancheAnalysis) {
        let totalCount = 0;
        for (const tranche in trancheAnalysis[market]) {
            totalCount += trancheAnalysis[market][tranche].total;
        }
        marketOccurrences[market] = totalCount;
    }

    const bilanData = {
        totalMatchesAnalyzed,
        marketOccurrences
    };

    try {
        fs.writeFileSync('bilan_baseball_backtest.json', JSON.stringify(bilanData, null, 2));
        console.log(chalk.magenta('-> Fichier de bilan sauvegardé dans bilan_baseball_backtest.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier de bilan:'), error);
    }
}

async function runBacktest() {
    analysisStatus = "Analyse prédictive en cours...";
    console.log(chalk.blue.bold(`--- Démarrage du backtesting prédictif sur ${DAYS_TO_ANALYZE} jours ---`));

    detailedResults = [];
    trancheAnalysis = {};
    diagnostics = [];
    statsCache.clear();
    const model = new BaseballPoissonModel();
    let totalMatchesAnalyzed = 0;

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.magenta.bold(`\n--- Traitement de la ligue : ${league.name} (ID: ${league.id}) ---`));
        let currentDate = new Date();
        for (let i = 0; i < DAYS_TO_ANALYZE; i++) {
            const dateStr = currentDate.toISOString().split('T')[0];
            console.log(chalk.cyan(`\nAnalyse des matchs du ${dateStr}...`));
            const gamesList = await getGamesForDate(dateStr, league.id);

            for (const basicGame of gamesList) {
                totalMatchesAnalyzed++;
                const homeTeamId = basicGame.teams.home.id;
                const awayTeamId = basicGame.teams.away.id;

                let homeStats = null;
                let awayStats = null;
                let isEarlySeason = false;
                let earlySeasonWeight = 1.0;

                let homeStatsObj = await getTeamStats(homeTeamId, CURRENT_SEASON, league.id);
                let awayStatsObj = await getTeamStats(awayTeamId, CURRENT_SEASON, league.id);

                if (homeStatsObj && awayStatsObj) {
                    homeStats = homeStatsObj;
                    awayStats = awayStatsObj;
                    const gamesPlayed = Math.min(homeStats.games.played.all, awayStats.games.played.all);
                    if (gamesPlayed < EARLY_SEASON_THRESHOLD) {
                        isEarlySeason = true;
                        earlySeasonWeight = gamesPlayed / EARLY_SEASON_THRESHOLD;
                        const prevHomeStatsObj = await getTeamStats(homeTeamId, CURRENT_SEASON - 1, league.id);
                        const prevAwayStatsObj = await getTeamStats(awayTeamId, CURRENT_SEASON - 1, league.id);
                        if (prevHomeStatsObj && prevAwayStatsObj) {
                            const prevHomeStats = prevHomeStatsObj;
                            const prevAwayStats = prevAwayStatsObj;
                            const weightedAvg = (current, prev) => (parseFloat(current) * earlySeasonWeight) + (parseFloat(prev) * (1 - earlySeasonWeight));
                            homeStats.points.for.average.all = weightedAvg(homeStats.points.for.average.all, prevHomeStats.points.for.average.all);
                            homeStats.points.against.average.all = weightedAvg(homeStats.points.against.average.all, prevHomeStats.points.against.average.all);
                            awayStats.points.for.average.all = weightedAvg(awayStats.points.for.average.all, prevAwayStats.points.for.average.all);
                            awayStats.points.against.average.all = weightedAvg(awayStats.points.against.average.all, prevAwayStats.points.against.average.all);
                        }
                    }
                } else {
                    console.log(chalk.yellow(`Stats pour ${CURRENT_SEASON} introuvables pour le match ${basicGame.id}. Tentative avec la saison précédente.`));
                    const prevHomeStatsObj = await getTeamStats(homeTeamId, CURRENT_SEASON - 1, league.id);
                    const prevAwayStatsObj = await getTeamStats(awayTeamId, CURRENT_SEASON - 1, league.id);
                    if (prevHomeStatsObj && prevAwayStatsObj) {
                        homeStats = prevHomeStatsObj;
                        awayStats = prevAwayStatsObj;
                        isEarlySeason = true;
                    } else {
                        console.log(chalk.red(`Aucune donnée statistique disponible pour le match ${basicGame.id}, ignoré.`));
                        continue;
                    }
                }

                if (!homeStats.points?.for?.average?.all || !awayStats.points?.for?.average?.all) {
                    console.log(chalk.yellow(`Stats invalides pour le match ${basicGame.id}, ligue ${league.name}, ignoré.`));
                    continue;
                }
                const avgRunsForHome = parseFloat(homeStats.points.for.average.all);
                const avgRunsAgainstHome = parseFloat(homeStats.points.against.average.all);
                const avgRunsForAway = parseFloat(awayStats.points.for.average.all);
                const avgRunsAgainstAway = parseFloat(awayStats.points.against.average.all);

                const xRuns_Home = (avgRunsForHome + avgRunsAgainstAway) / 2;
                const xRuns_Away = (avgRunsForAway + avgRunsAgainstHome) / 2;

                const predictions = model.predict(xRuns_Home, xRuns_Away);
                const game = await getGameDetails(basicGame.id);
                if (!game) continue;
                const actualOutcomes = analyzeMarketOutcomes(game, {});

                const matchResultForDisplay = {
                    league: league.name,
                    label: `${basicGame.teams.home.name} vs ${basicGame.teams.away.name}`,
                    finalScore: `${game.scores.home.total} - ${game.scores.away.total}`,
                    predictions: []
                };

                for (const marketKey in predictions) {
                    const probability = predictions[marketKey];
                    let finalProbability = probability;
                    if (isEarlySeason) {
                        const confidenceAdjustment = 0.7 + (0.3 * earlySeasonWeight);
                        finalProbability *= confidenceAdjustment;
                    }
                    const wasSuccess = actualOutcomes[marketKey];
                    if (finalProbability >= 60) {
                        matchResultForDisplay.predictions.push({ market: marketKey, confidence: finalProbability.toFixed(1), success: wasSuccess });
                    }
                    if (!trancheAnalysis[marketKey]) trancheAnalysis[marketKey] = initTrancheObject();
                    let trancheKey;
                    if (finalProbability < 60) trancheKey = '0-59';
                    else if (finalProbability < 70) trancheKey = '60-69';
                    else if (finalProbability < 80) trancheKey = '70-79';
                    else if (finalProbability < 90) trancheKey = '80-89';
                    else trancheKey = '90-100';
                    trancheAnalysis[marketKey][trancheKey].total++;
                    if (wasSuccess) {
                        trancheAnalysis[marketKey][trancheKey].success++;
                    }
                }
                if (matchResultForDisplay.predictions.length > 0) {
                    detailedResults.push(matchResultForDisplay);
                }
            }
            currentDate.setDate(currentDate.getDate() - 1);
        }
    }

    globalTranches = initTrancheObject();
    for (const market in trancheAnalysis) {
        for (const tranche in trancheAnalysis[market]) {
            globalTranches[tranche].success += trancheAnalysis[market][tranche].success;
            globalTranches[tranche].total += trancheAnalysis[market][tranche].total;
        }
    }

    const finalReport = {
        analysisStatus: `Backtest prédictif terminé.`,
        totalMatchesAnalyzed,
        globalTrancheSummary: globalTranches,
        perMarketTrancheAnalysis: trancheAnalysis,
        detailedMatchResults: detailedResults
    };

    fs.writeFileSync('backtest_baseball_report.json', JSON.stringify(finalReport, null, 2));
    console.log(chalk.magenta('-> Rapport de backtest sauvegardé dans backtest_baseball_report.json'));

    generateBilanFile(totalMatchesAnalyzed, trancheAnalysis);

    analysisStatus = `Backtest prédictif terminé.`;
    console.log(chalk.blue.bold('\n--- BACKTESTING TERMINÉ ---'));
}

app.get('/', (req, res) => {
    let html = `
    <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Backtest Prédictif Baseball</title>
    <style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; } h1, h2 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; } .status, .card { background-color: #1e1e1e; border: 1px solid #373737; padding: 15px; border-radius: 8px; margin-bottom: 20px; } .container { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 20px; } table { width: 100%; border-collapse: collapse; } th, td { padding: 10px; text-align: left; border-bottom: 1px solid #373737; } th { background-color: #2a2a2a; } .win { color: #03dac6; } .loss { color: #cf6679; } .score { font-weight: bold; } .rate-high { background-color: #03dac630; } .rate-medium { background-color: #f0e68c30; } .rate-low { background-color: #cf667930; } .card-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; } .league-tag { background-color: #bb86fc; color: #121212; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; margin-left: 10px; }</style>
    </head><body><h1>Backtest du Modèle Prédictif de Baseball (Multi-Ligues, Robuste)</h1><div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;
    if (Object.keys(globalTranches).length > 0) {
        html += `<h2>Bilan Global (Toutes Ligues)</h2><div class="card"><table><thead><tr><th>Tranche Confiance</th><th>Succès/Total</th><th>Taux Réussite</th></tr></thead><tbody>`;
        for (const tranche in globalTranches) {
            const { success, total } = globalTranches[tranche];
            if (total > 0) {
                const rate = (success / total * 100).toFixed(2);
                const rateClass = rate >= 75 ? 'rate-high' : rate >= 60 ? 'rate-medium' : 'rate-low';
                html += `<tr class="${rateClass}"><td>${tranche}%</td><td>${success}/${total}</td><td class="score">${rate}%</td></tr>`;
            }
        }
        html += `</tbody></table></div>`;
    }
    if (Object.keys(trancheAnalysis).length > 0) {
        html += `<h2>Bilan par Marché</h2><div class="container">`;
        const sortedMarkets = Object.keys(trancheAnalysis).sort();
        for (const market of sortedMarkets) {
            html += `<div class="card"><div class="card-header">${market}</div><table><thead><tr><th>Tranche</th><th>S/T</th><th>Taux</th></tr></thead><tbody>`;
            for (const tranche in trancheAnalysis[market]) {
                const { success, total } = trancheAnalysis[market][tranche];
                if (total > 0) {
                    const rate = (success / total * 100).toFixed(2);
                    const rateClass = rate >= 75 ? 'rate-high' : rate >= 60 ? 'rate-medium' : 'rate-low';
                    html += `<tr class="${rateClass}"><td>${tranche}%</td><td>${success}/${total}</td><td class="score">${rate}%</td></tr>`;
                }
            }
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
    }
    if (detailedResults.length > 0) {
        html += `<h2>Détails des Prédictions (Confiance ≥ 60%)</h2><div class="container">`;
        for (const result of detailedResults) {
            html += `<div class="card"><div class="card-header">${result.label} <span class="score">${result.finalScore}</span><span class="league-tag">${result.league}</span></div><table><thead><tr><th>Marché</th><th>Confiance</th><th>Résultat</th></tr></thead><tbody>`;
            result.predictions.forEach(p => {
                html += `<tr><td>${p.market}</td><td class="score">${p.confidence}%</td><td class="${p.success ? 'win' : 'loss'}">${p.success ? 'Succès' : 'Échec'}</td></tr>`;
            });
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
    }
    html += `</body></html>`;
    res.send(html);
});

app.listen(PORT, async () => {
    console.log(chalk.inverse(`\n✅ Serveur démarré. Accédez à http://localhost:${PORT}`));
    await runBacktest();
    console.log(chalk.inverse.bold(`\n✨ Analyse terminée. La page est prête et à jour !`));
});