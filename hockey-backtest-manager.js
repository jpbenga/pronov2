const axios = require('axios');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');

// --- CONFIGURATION ---
const PORT = 3001; // Port différent pour ne pas entrer en conflit avec le script de foot
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
let detailedResults = [];
let trancheAnalysis = {};
let marketOccurrences = {};
let analysisStatus = "Analyse non démarrée.";
let totalMatchesAnalyzed = 0;
let earlySeasonTrancheSummary = null;
let calibrationReport = {};
const statsCache = new Map();

// --- INITIALISATION ---
const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- FONCTIONS API & LOGIQUE ---

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
        } catch (error) { console.log(chalk.yellow(`       -> Tentative ${attempts}/${MAX_ATTEMPTS} (stats équipe ${teamId}, saison ${season}) échouée`)); }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`       -> ERREUR FINALE: Stats pour équipe ${teamId}, saison ${season}`));
    return null;
}

function bayesianSmooth(avg, matchesPlayed, prior = 3.0, priorStrength = 5) { // Prior ajusté pour le hockey
    if (matchesPlayed > 0 && matchesPlayed < 6) {
        return (avg * matchesPlayed + prior * priorStrength) / (matchesPlayed + priorStrength);
    }
    return avg;
}

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
        
        const homeProbs = this._calculateProbs(lambdaHome);
        for(const key in homeProbs) { markets[`home_${key}`] = homeProbs[key]; }

        const awayProbs = this._calculateProbs(lambdaAway);
        for(const key in awayProbs) { markets[`away_${key}`] = awayProbs[key]; }
        
        return { markets };
    }
}

function analyzeMatchMarkets(game, projectedHomeGoals, projectedAwayGoals) {
    const results = {};
    const scores = game.scores;
    if (scores.home === null || scores.away === null) return null;

    results['home_win'] = scores.home > scores.away;
    results['away_win'] = scores.away > scores.home;
    const isHomeFavoriteModel = projectedHomeGoals > projectedAwayGoals;
    results['favorite_win'] = (isHomeFavoriteModel && results['home_win']) || (!isHomeFavoriteModel && results['away_win']);
    results['outsider_win'] = (!isHomeFavoriteModel && results['home_win']) || (isHomeFavoriteModel && results['away_win']);
    
    [4.5, 5.5, 6.5, 7.5].forEach(t => {
        results[`match_over_${t}`] = scores.home + scores.away > t;
        results[`match_under_${t}`] = scores.home + scores.away < t;
        results[`home_over_${t}`] = scores.home > t;
        results[`home_under_${t}`] = scores.home < t;
        results[`away_over_${t}`] = scores.away > t;
        results[`away_under_${t}`] = scores.away < t;
    });
    return results;
}

const initTrancheObject = () => ({
    '0-59': { success: 0, total: 0, avgPredicted: 0 }, '60-69': { success: 0, total: 0, avgPredicted: 0 }, '70-79': { success: 0, total: 0, avgPredicted: 0 },
    '80-89': { success: 0, total: 0, avgPredicted: 0 }, '90-100': { success: 0, total: 0, avgPredicted: 0 }
});

async function runBacktestAnalyzer() {
    analysisStatus = "Analyse en cours...";
    totalMatchesAnalyzed = 0;
    marketOccurrences = {};
    trancheAnalysis = {};
    detailedResults = [];
    earlySeasonTrancheSummary = initTrancheObject();
    calibrationReport = {};
    statsCache.clear();
    console.log(chalk.blue.bold("--- 🏒 Démarrage de l'analyseur de backtesting (Hockey) ---"));
    
    const currentYear = new Date().getFullYear();
    const season = `${currentYear - 1}-${currentYear}`; // Format de saison pour le hockey (ex: 2024-2025)
    const poisson = new PoissonModel();

    // Récupérer les matchs de la veille
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateToFetch = yesterday.toISOString().split('T')[0];
    console.log(chalk.gray(`\nRecherche des matchs terminés pour la date : ${dateToFetch}`));

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Traitement : ${league.name}`));
        try {
            const gamesResponse = await api.get('/games', { params: { league: league.id, season: season, date: dateToFetch } });
            const finishedGames = gamesResponse.data.response.filter(g => g.status.long === 'Finished');
            
            if (finishedGames.length === 0) {
                console.log(chalk.gray(`   -> Aucun match terminé trouvé pour cette ligue à cette date.`));
                continue;
            }
            console.log(`   - ${finishedGames.length} match(s) terminé(s) trouvé(s).`);

            for (const game of finishedGames) {
                const matchLabel = `${game.teams.home.name} vs ${game.teams.away.name}`;
                console.log(chalk.green(`\n     Analyse de : ${matchLabel}`));
                
                const homeStats = await getTeamStats(game.teams.home.id, league.id, season);
                const awayStats = await getTeamStats(game.teams.away.id, league.id, season);
                if (!homeStats || !awayStats || !homeStats.games) {
                    console.log(chalk.yellow(`       -> Données de statistiques manquantes. Match ignoré.`));
                    continue;
                }

                const matchesPlayed = homeStats.games.played;
                let isEarlySeason = matchesPlayed < 6;

                let homeAvgFor = parseFloat(homeStats.goals.for.average) || 0;
                let homeAvgAgainst = parseFloat(homeStats.goals.against.average) || 0;
                let awayAvgFor = parseFloat(awayStats.goals.for.average) || 0;
                let awayAvgAgainst = parseFloat(awayStats.goals.against.average) || 0;

                if (isEarlySeason) {
                    console.log(chalk.yellow(`       -> Début de saison détecté (${matchesPlayed} matchs). Application des corrections.`));
                    // On pourrait aussi utiliser les stats de la saison N-1, mais la logique bayésienne est déjà une bonne protection.
                    homeAvgFor = bayesianSmooth(homeAvgFor, matchesPlayed);
                    homeAvgAgainst = bayesianSmooth(homeAvgAgainst, matchesPlayed);
                    awayAvgFor = bayesianSmooth(awayAvgFor, matchesPlayed);
                    awayAvgAgainst = bayesianSmooth(awayAvgAgainst, matchesPlayed);
                }

                const projectedHomeGoals = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayGoals = (awayAvgFor + homeAvgAgainst) / 2;
                
                const marketResults = analyzeMatchMarkets(game, projectedHomeGoals, projectedAwayGoals);
                if (!marketResults) continue;

                totalMatchesAnalyzed++;
                for (const market in marketResults) { if (marketResults[market] === true) { marketOccurrences[market] = (marketOccurrences[market] || 0) + 1; } }
                
                const poissonPreds = poisson.predict(projectedHomeGoals, projectedAwayGoals);
                let confidenceScores = poissonPreds.markets;

                // Filtrer les matchs à faible confiance
                const maxConfidence = Math.max(...Object.values(confidenceScores));
                if (maxConfidence < 60) {
                    console.log(chalk.yellow(`       -> Match ${matchLabel} exclu : aucune prédiction avec confiance ≥ 60%.`));
                    continue;
                }

                detailedResults.push({ leagueName: league.name, matchLabel, scoreLabel: `(Final: ${game.scores.home}-${game.scores.away})`, isEarlySeason, results: marketResults, scores: confidenceScores });
                
                for (const market in confidenceScores) {
                    if (!marketResults.hasOwnProperty(market)) continue;
                    if (!trancheAnalysis[market]) trancheAnalysis[market] = initTrancheObject();
                    const score = confidenceScores[market];
                    const wasSuccess = marketResults[market];
                    let trancheKey;
                    if (score < 60) trancheKey = '0-59';
                    else if (score < 70) trancheKey = '60-69';
                    else if (score < 80) trancheKey = '70-79';
                    else if (score < 90) trancheKey = '80-89';
                    else trancheKey = '90-100';
                    trancheAnalysis[market][trancheKey].total++;
                    trancheAnalysis[market][trancheKey].avgPredicted += score;
                    if (wasSuccess) trancheAnalysis[market][trancheKey].success++;
                    if (isEarlySeason) {
                        earlySeasonTrancheSummary[trancheKey].total++;
                        earlySeasonTrancheSummary[trancheKey].avgPredicted += score;
                        if (wasSuccess) earlySeasonTrancheSummary[trancheKey].success++;
                    }
                }
                await sleep(500); // Pour ne pas surcharger l'API
            }
        } catch (error) { console.log(chalk.red.bold(`\n   ❌ ERREUR FINALE pour ${league.name}: ${error.message}`)); }
    }
    analysisStatus = `Analyse terminée. ${totalMatchesAnalyzed} matchs analysés.`;
    console.log(chalk.blue.bold("\n--- ANALYSE TERMINÉE ---"));

    try {
        // Exclure les marchés avec moins de 10 occurrences (seuil plus bas pour le hockey au début)
        for (const market in trancheAnalysis) {
            if ((marketOccurrences[market] || 0) < 10) {
                delete trancheAnalysis[market];
                console.log(chalk.yellow(`Marché ${market} exclu du rapport (moins de 10 occurrences).`));
            }
        }

        const globalTrancheSummary = initTrancheObject();
        for (const market in trancheAnalysis) {
            for (const key in trancheAnalysis[market]) {
                globalTrancheSummary[key].success += trancheAnalysis[market][key].success;
                globalTrancheSummary[key].total += trancheAnalysis[market][key].total;
                globalTrancheSummary[key].avgPredicted += trancheAnalysis[market][key].avgPredicted;
            }
        }
        calibrationReport = {};
        for (const market in trancheAnalysis) {
            calibrationReport[market] = {};
            for (const key in trancheAnalysis[market]) {
                const tranche = trancheAnalysis[market][key];
                if (tranche.total > 0) {
                    tranche.avgPredicted /= tranche.total;
                    calibrationReport[market][key] = {
                        predicted: tranche.avgPredicted.toFixed(2),
                        actual: ((tranche.success / tranche.total) * 100).toFixed(2)
                    };
                }
            }
        }

        for (const key in earlySeasonTrancheSummary) {
            const tranche = earlySeasonTrancheSummary[key];
            if (tranche.total > 0) {
                tranche.avgPredicted /= tranche.total;
            }
        }

        const finalReport = { totalMatchesAnalyzed, globalSummary: globalTrancheSummary, perMarketSummary: trancheAnalysis, marketOccurrences, calibration: calibrationReport, earlySeasonSummary: earlySeasonTrancheSummary };
        fs.writeFileSync('bilan_backtest_hockey.json', JSON.stringify(finalReport, null, 2));
        console.log(chalk.magenta.bold('-> Bilan du backtest sauvegardé dans le fichier bilan_backtest_hockey.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier JSON:'), error);
    }
}


// --- SERVEUR WEB POUR L'AFFICHAGE ---
// Cette partie est quasi identique, juste les titres ont été changés.
app.get('/', (req, res) => {
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Backtest Hockey</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            h1, h2 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
            .status { background-color: #1e1e1e; border: 1px solid #373737; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .container { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
            .card { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 20px; }
            .card-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
            .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #373737; }
            th { background-color: #2a2a2a; }
            .win { color: #03dac6; } .loss { color: #cf6679; } .score { font-weight: bold; }
            .rate-high { background-color: #03dac630; } .rate-medium { background-color: #f0e68c30; } .rate-low { background-color: #cf667930; }
        </style>
        </head><body><h1>🏒 Résultats du Backtest de Confiance (Hockey)</h1><div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;

    if (Object.keys(trancheAnalysis).length > 0) {
        const globalTrancheSummary = initTrancheObject();
        for (const market in trancheAnalysis) { 
            for (const key in trancheAnalysis[market]) { 
                globalTrancheSummary[key].success += trancheAnalysis[market][key].success; 
                globalTrancheSummary[key].total += trancheAnalysis[market][key].total; 
            } 
        }
        const trancheKeys = ['0-59', '60-69', '70-79', '80-89', '90-100'];
        html += `<h2>Bilan Global (Tous Marchés Confondus)</h2><div class="card"><table><thead><tr><th>Tranche de Confiance</th><th>Prédictions Correctes</th><th>Total Prédictions</th><th>Taux de Réussite</th></tr></thead><tbody>`;
        trancheKeys.forEach(key => {
            const tranche = globalTrancheSummary[key];
            if (tranche.total > 0) {
                const rate = (tranche.success / tranche.total) * 100;
                const rateClass = rate >= 75 ? 'rate-high' : rate >= 50 ? 'rate-medium' : 'rate-low';
                html += `<tr class="${rateClass}"><td>${key}%</td><td>${tranche.success}</td><td>${tranche.total}</td><td class="score">${rate.toFixed(2)}%</td></tr>`;
            }
        });
        html += `</tbody></table></div>`;
        if (totalMatchesAnalyzed > 0) {
            html += `<h2>Bilan d'Apparition des Marchés</h2><div class="card"><table><thead><tr><th>Marché</th><th>Taux Apparition</th><th>Occurrences</th></tr></thead><tbody>`;
            const sortedMarkets = Object.keys(marketOccurrences).sort();
            for (const market of sortedMarkets) {
                const count = marketOccurrences[market] || 0;
                const rate = (count / totalMatchesAnalyzed * 100).toFixed(2);
                html += `<tr><td>${market}</td><td>${rate}%</td><td>${count}</td></tr>`;
            }
            html += `</tbody></table></div>`;
        }
        html += `<h2>Bilan par Tranche de Confiance (par Marché)</h2><div class="container">`;
        const sortedMarketsForTranche = Object.keys(trancheAnalysis).sort();
        for (const market of sortedMarketsForTranche) {
            html += `<div class="card"><div class="card-header">${market}</div><table><thead><tr><th>Tranche</th><th>Réussite</th><th>Total</th><th>Taux</th></tr></thead><tbody>`;
            trancheKeys.forEach(key => {
                const tranche = trancheAnalysis[market][key];
                if (tranche.total > 0) {
                    const rate = (tranche.success / tranche.total) * 100;
                    const rateClass = rate >= 75 ? 'rate-high' : rate >= 50 ? 'rate-medium' : 'rate-low';
                    html += `<tr class="${rateClass}"><td>${key}%</td><td>${tranche.success}</td><td>${tranche.total}</td><td class="score">${rate.toFixed(2)}%</td></tr>`;
                }
            });
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
        html += `<h2>Calibration du Modèle Poisson</h2><div class="card"><table><thead><tr><th>Marché</th><th>Tranche</th><th>Probabilité Prédite Moyenne</th><th>Taux Réel</th></tr></thead><tbody>`;
        if (Object.keys(calibrationReport).length > 0) {
            for (const market in calibrationReport) {
                for (const tranche in calibrationReport[market]) {
                    const { predicted, actual } = calibrationReport[market][tranche];
                    if (predicted > 0) {
                        html += `<tr><td>${market}</td><td>${tranche}%</td><td>${predicted}%</td><td>${actual}%</td></tr>`;
                    }
                }
            }
        } else {
            html += `<tr><td colspan="4">Calibration non disponible.</td></tr>`;
        }
        html += `</tbody></table></div>`;
        html += `<h2>Bilan Début de Saison</h2><div class="card"><table><thead><tr><th>Tranche de Confiance</th><th>Prédictions Correctes</th><th>Total Prédictions</th><th>Taux de Réussite</th></tr></thead><tbody>`;
        if (earlySeasonTrancheSummary) {
            trancheKeys.forEach(key => {
                const tranche = earlySeasonTrancheSummary[key];
                if (tranche.total > 0) {
                    const rate = (tranche.success / tranche.total) * 100;
                    const rateClass = rate >= 75 ? 'rate-high' : rate >= 50 ? 'rate-medium' : 'rate-low';
                    html += `<tr class="${rateClass}"><td>${key}%</td><td>${tranche.success}</td><td>${tranche.total}</td><td class="score">${rate.toFixed(2)}%</td></tr>`;
                }
            });
        } else {
            html += `<tr><td colspan="4">Analyse des débuts de saison non disponible.</td></tr>`;
        }
        html += `</tbody></table></div>`;
    }

    if (detailedResults.length > 0) {
        html += `<h2>Résultats Détaillés par Match (Confiance ≥ 60%)</h2><div class="container">`;
        detailedResults.forEach(match => {
            const earlySeasonTag = match.isEarlySeason ? '<span class="early-season-tag">Début de Saison</span>' : '';
            const header = `<div>${match.leagueName} - ${match.matchLabel} - <span class="score">${match.scoreLabel}</span></div>${earlySeasonTag}`;
            html += `<div class="card"><div class="card-header">${header}</div><table><thead><tr><th>Marché</th><th>Probabilité</th><th>Résultat</th></tr></thead><tbody>`;
            const sortedMarkets = Object.keys(match.scores).sort();
            for (const market of sortedMarkets) {
                const score = match.scores[market];
                if (score < 60) continue;
                const result = match.results[market];
                html += `<tr><td>${market}</td><td class="score">${score !== undefined ? Math.round(score) : 'N/A'}%</td><td class="${result ? 'win' : 'loss'}">${result ? 'Vrai' : 'Faux'}</td></tr>`;
            }
            html += `</tbody></table></div>`;
        });
        html += `</div>`;
    }
    html += `</body></html>`;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur web démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    runBacktestAnalyzer();
});