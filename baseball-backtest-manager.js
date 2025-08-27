const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const fs = require('fs');

const PORT = 5002;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v1.baseball.api-sports.io';
const MLB_LEAGUE_ID = 1;
const CURRENT_SEASON = new Date().getFullYear();
const DAYS_TO_ANALYZE = 7;

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY } });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const statsCache = new Map();

let analysisStatus = "Analyse non démarrée.";
let detailedResults = [];
let trancheAnalysis = {};
let globalTranches = {};

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
            markets['Vainqueur du match_Home'] = (homeWinProb / totalProb) * 100;
            markets['Vainqueur du match_Away'] = (awayWinProb / totalProb) * 100;
        }

        for (const t in overUnderProbs) {
            markets[`Total de Points (O/U ${t})_Over ${t}`] = overUnderProbs[t].over * 100;
            markets[`Total de Points (O/U ${t})_Under ${t}`] = (1 - overUnderProbs[t].over) * 100;
        }

        return markets;
    }
}

async function getTeamStats(teamId, season) {
    const cacheKey = `${teamId}-${season}`;
    if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);
    try {
        const response = await api.get('/teams/statistics', { params: { league: MLB_LEAGUE_ID, season, team: teamId } });
        if(response.data?.response) {
            statsCache.set(cacheKey, response.data.response);
            return response.data.response;
        }
    } catch (error) { console.log(chalk.red(`Erreur stats équipe ${teamId}`)); }
    return null;
}

async function getGameDetails(gameId) {
    let attempts = 0;
    while (attempts < 3) {
        attempts++;
        try {
            const response = await api.get('/games', { params: { id: gameId } });
            if (response.data?.response?.length > 0) return response.data.response[0];
        } catch (error) { await sleep(1500); }
    }
    return null;
}

async function getGamesForDate(date) {
    try {
        const response = await api.get('/games', { params: { league: MLB_LEAGUE_ID, season: CURRENT_SEASON, date: date } });
        if (response.data && response.data.response) {
            const games = response.data.response;
            const statusCounts = games.reduce((acc, game) => { acc[game.status.short || 'Unknown'] = (acc[game.status.short || 'Unknown'] || 0) + 1; return acc; }, {});
            const finishedGames = games.filter(g => g.status.short === 'FT');
            diagnostics.push({ date, totalGames: games.length, finishedGames: finishedGames.length, statusCounts });
            return finishedGames;
        }
    } catch (error) { console.log(chalk.red(`Erreur pour la date ${date}: ${error.message}`)); }
    diagnostics.push({ date, totalGames: 0, finishedGames: 0, statusCounts: {} });
    return [];
}

function analyzeMarketOutcomes(game) {
    const outcomes = {};
    if (!game.scores?.home?.innings || !game.scores?.away?.innings) {
        return outcomes;
    }
    const { home, away } = game.scores;
    const totalRuns = home.total + away.total;
    const addOutcome = (market, option) => {
        outcomes[market] = { total: 1, outcomes: { [option]: 1 } };
    };
    addOutcome('Vainqueur du match', home.total > away.total ? 'Home' : 'Away');
    for (let i = 0.5; i <= 20.5; i++) {
        addOutcome(`Total de Points (O/U ${i})`, totalRuns > i ? `Over ${i}` : `Under ${i}`);
    }
    return outcomes;
}

const initTrancheObject = () => ({
    '0-59': { success: 0, total: 0 }, '60-69': { success: 0, total: 0 },
    '70-79': { success: 0, total: 0 }, '80-89': { success: 0, total: 0 },
    '90-100': { success: 0, total: 0 }
});

async function runBacktest() {
    analysisStatus = "Analyse prédictive en cours...";
    console.log(chalk.blue.bold(`--- Démarrage du backtesting prédictif sur ${DAYS_TO_ANALYZE} jours ---`));
    
    detailedResults = [];
    trancheAnalysis = {};
    diagnostics = [];
    statsCache.clear();
    const model = new BaseballPoissonModel();
    let currentDate = new Date();
    let totalMatchesAnalyzed = 0;

    for (let i = 0; i < DAYS_TO_ANALYZE; i++) {
        const dateStr = currentDate.toISOString().split('T')[0];
        console.log(chalk.cyan(`\nAnalyse des matchs du ${dateStr}...`));
        const gamesList = await getGamesForDate(dateStr);

        for (const basicGame of gamesList) {
            totalMatchesAnalyzed++;
            const homeTeamId = basicGame.teams.home.id;
            const awayTeamId = basicGame.teams.away.id;

            const homeStats = await getTeamStats(homeTeamId, CURRENT_SEASON);
            const awayStats = await getTeamStats(awayTeamId, CURRENT_SEASON);

            if (!homeStats?.points?.for?.average?.all || !awayStats?.points?.for?.average?.all) {
                console.log(chalk.yellow(`Stats invalides pour le match ${basicGame.id}, prédiction ignorée.`));
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
            const actualOutcomes = analyzeMarketOutcomes(game);
            
            const matchResultForDisplay = {
                label: `${basicGame.teams.home.name} vs ${basicGame.teams.away.name}`,
                finalScore: `${game.scores.home.total} - ${game.scores.away.total}`,
                predictions: []
            };

            for (const marketKey in predictions) {
                const probability = predictions[marketKey];

                let calibratedProbability = probability;
                if (probability >= 80 && probability < 90) {
                    calibratedProbability *= 0.90;
                } else if (probability >= 70 && probability < 80) {
                    calibratedProbability *= 0.95;
                }

                const [marketName, marketOption] = marketKey.split('_');
                const actualMarket = actualOutcomes[marketName];

                if (actualMarket) {
                    const wasSuccess = !!actualMarket.outcomes[marketOption];
                    
                    if (calibratedProbability >= 60) {
                         matchResultForDisplay.predictions.push({ market: marketName, option: marketOption, confidence: calibratedProbability.toFixed(1), success: wasSuccess });
                    }

                    if (!trancheAnalysis[marketName]) trancheAnalysis[marketName] = initTrancheObject();
                    
                    let trancheKey;
                    if (calibratedProbability < 60) trancheKey = '0-59';
                    else if (calibratedProbability < 70) trancheKey = '60-69';
                    else if (calibratedProbability < 80) trancheKey = '70-79';
                    else if (calibratedProbability < 90) trancheKey = '80-89';
                    else trancheKey = '90-100';

                    trancheAnalysis[marketName][trancheKey].total++;
                    if (wasSuccess) {
                        trancheAnalysis[marketName][trancheKey].success++;
                    }
                }
            }
            if (matchResultForDisplay.predictions.length > 0) {
                detailedResults.push(matchResultForDisplay);
            }
            await sleep(200);
        }
        currentDate.setDate(currentDate.getDate() - 1);
    }

    globalTranches = initTrancheObject();
    for(const market in trancheAnalysis) {
        for(const tranche in trancheAnalysis[market]) {
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

    analysisStatus = `Backtest prédictif terminé.`;
    console.log(chalk.blue.bold('\n--- BACKTESTING TERMINÉ ---'));
}

app.get('/', (req, res) => {
    let html = `
    <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Backtest Prédictif Baseball</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
        h1, h2 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
        .status, .card { background-color: #1e1e1e; border: 1px solid #373737; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .container { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #373737; }
        th { background-color: #2a2a2a; }
        .win { color: #03dac6; } .loss { color: #cf6679; } .score { font-weight: bold; }
        .rate-high { background-color: #03dac630; } .rate-medium { background-color: #f0e68c30; } .rate-low { background-color: #cf667930; }
        .card-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; }
    </style>
    </head><body><h1>Backtest du Modèle Prédictif de Baseball (Calibré)</h1><div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;

    if (Object.keys(globalTranches).length > 0) {
        html += `<h2>Bilan Global (Tous Marchés)</h2><div class="card"><table><thead><tr><th>Tranche Confiance</th><th>Succès/Total</th><th>Taux Réussite</th></tr></thead><tbody>`;
        for(const tranche in globalTranches) {
            const { success, total } = globalTranches[tranche];
            if(total > 0) {
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
        for(const market of sortedMarkets) {
            html += `<div class="card"><div class="card-header">${market}</div><table><thead><tr><th>Tranche</th><th>S/T</th><th>Taux</th></tr></thead><tbody>`;
            for(const tranche in trancheAnalysis[market]) {
                const { success, total } = trancheAnalysis[market][tranche];
                if(total > 0) {
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
        for(const result of detailedResults) {
             html += `<div class="card"><div class="card-header">${result.label} <span class="score">${result.finalScore}</span></div><table><thead><tr><th>Marché</th><th>Prédiction</th><th>Confiance</th><th>Résultat</th></tr></thead><tbody>`;
             result.predictions.forEach(p => {
                 html += `<tr><td>${p.market}</td><td>${p.option}</td><td class="score">${p.confidence}%</td><td class="${p.success ? 'win' : 'loss'}">${p.success ? 'Succès' : 'Échec'}</td></tr>`;
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