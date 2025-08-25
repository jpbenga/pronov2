const axios = require('axios');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');

// --- CONFIGURATION ---
const PORT = 3000;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v3.football.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    { name: 'Bundesliga', id: 78 }, { name: 'Bundesliga 2', id: 79 },
    { name: 'Premier League', id: 39 }, { name: 'Championship', id: 40 },
    { name: 'Saudi Pro League', id: 307 }, { name: 'Liga Profesional', id: 128 },
    { name: 'Bundesliga (Autriche)', id: 218 }, { name: 'Pro League', id: 144 },
    { name: 'Série A (Brésil)', id: 71 }, { name: 'Parva Liga', id: 172 },
    { name: 'Primera Division (Chili)', id: 265 }, { name: 'Super League (Chine)', id: 169 },
    { name: 'Primera A', id: 239 }, { name: 'K League 1', id: 292 },
    { name: 'HNL', id: 210 }, { name: 'Superliga', id: 119 },
    { name: 'Premiership', id: 179 }, { name: 'Liga Pro', id: 240 },
    { name: 'La Liga', id: 140 }, { name: 'La Liga 2', id: 141 },
    { name: 'Meistriliiga', id: 327 }, { name: 'MLS', id: 253 },
    { name: 'Veikkausliga', id: 244 }, { name: 'Ligue 1', id: 61 },
    { name: 'Ligue 2', id: 62 }, { name: 'Erovnuli Liga', id: 329 },
    { name: 'Super League (Grèce)', id: 197 }, { name: 'OTP Bank Liga', id: 271 },
    { name: 'Premier Division', id: 357 }, { name: 'B Urology deild karla', id: 164 },
    { name: 'Serie A', id: 135 }, { name: 'Serie B', id: 136 },
    { name: 'J1 League', id: 98 }, { name: 'A Lyga', id: 331 },
    { name: 'Liga MX', id: 262 }, { name: 'Eliteserien', id: 103 },
    { name: 'Primera Division (Paraguay)', id: 284 }, { name: 'Eredivisie', id: 88 },
    { name: 'Cymru Premier', id: 110 }, { name: 'Ekstraklasa', id: 106 },
    { name: 'Liga Portugal', id: 94 }, { name: 'Liga Portugal 2', id: 95 },
    { name: 'Fortuna Liga', id: 345 }, { name: 'Liga 1', id: 283 },
    { name: 'Super Liga', id: 286 }, { name: 'Nike Liga', id: 334 },
    { name: 'Prva Liga', id: 373 }, { name: 'Allsvenskan', id: 113 },
    { name: 'Super League (Suisse)', id: 207 }, { name: 'Super Lig', id: 203 },
    { name: 'Premier League (Ukraine)', id: 235 }
];
const MAX_ATTEMPTS = 5;

let detailedResults = [];
let trancheAnalysis = {};
let marketOccurrences = {};
let analysisStatus = "Analyse non démarrée.";
let totalMatchesAnalyzed = 0;
let earlySeasonTrancheSummary = null;
let calibrationReport = {};
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
        } catch (error) { console.log(chalk.yellow(`      -> Tentative ${attempts}/${MAX_ATTEMPTS} (stats équipe ${teamId}, saison ${season}) échouée`)); }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`      -> ERREUR FINALE: Stats pour équipe ${teamId}, saison ${season}`));
    return null;
}

function bayesianSmooth(avg, matchesPlayed, prior = 1.35, priorStrength = 5) {
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
        const probs = Array(7).fill(0).map((_, k) => this.poissonProbability(k, lambda));
        const cumulativeProbs = probs.reduce((acc, p, i) => { acc.push((acc[i-1] || 0) + p); return acc; }, []);
        return {
            'over_0.5': (1 - cumulativeProbs[0]) * 100, 'under_0.5': cumulativeProbs[0] * 100,
            'over_1.5': (1 - cumulativeProbs[1]) * 100, 'under_1.5': cumulativeProbs[1] * 100,
            'over_2.5': (1 - cumulativeProbs[2]) * 100, 'under_2.5': cumulativeProbs[2] * 100,
            'over_3.5': (1 - cumulativeProbs[3]) * 100, 'under_3.5': cumulativeProbs[3] * 100,
        };
    }

    predict(lambdas, homeStats, awayStats, projectedHomeGoals, projectedAwayGoals) {
        const { home, away, ht, st, home_ht, home_st, away_ht, away_st } = lambdas;
        const markets = {};
        
        Object.assign(markets, ...Object.entries({ home, away, ht, st, home_ht, home_st, away_ht, away_st })
            .map(([prefix, lambda]) => {
                const segmentProbs = this._calculateProbs(lambda);
                const renamedProbs = {};
                for (const key in segmentProbs) { renamedProbs[`${prefix}_${key}`] = segmentProbs[key]; }
                return renamedProbs;
            }));

        const maxGoals = 8;
        const scoreProbabilities = Array(maxGoals + 1).fill(0).map(() => Array(maxGoals + 1).fill(0));
        let homeWinProb = 0, awayWinProb = 0, drawProb = 0;

        for (let i = 0; i <= maxGoals; i++) {
            for (let j = 0; j <= maxGoals; j++) {
                const prob = this.poissonProbability(i, home) * this.poissonProbability(j, away);
                scoreProbabilities[i][j] = prob;
                if (i > j) homeWinProb += prob;
                else if (j > i) awayWinProb += prob;
                else drawProb += prob;
            }
        }

        // Ajustement avec contexte (forme) et disparité des buts
        const homeFormFactor = homeStats.form ? (parseFloat(homeStats.form) / 100) : 0.5;
        const awayFormFactor = awayStats.form ? (parseFloat(awayStats.form) / 100) : 0.5;
        const goalDisparity = Math.abs(projectedHomeGoals - projectedAwayGoals);
        const disparityBoost = goalDisparity > 0.5 ? 1 + (goalDisparity - 0.5) * 0.2 : 1;
        homeWinProb *= (1 + (homeFormFactor - awayFormFactor) * 0.3) * disparityBoost;
        awayWinProb *= (1 + (awayFormFactor - homeFormFactor) * 0.3) * disparityBoost;
        const totalProb = homeWinProb + awayWinProb + drawProb;
        markets['home_win'] = (homeWinProb / totalProb) * 100;
        markets['away_win'] = (awayWinProb / totalProb) * 100;
        markets['draw'] = (drawProb / totalProb) * 100;
        markets['favorite_win'] = Math.max(markets['home_win'], markets['away_win']);
        markets['outsider_win'] = Math.min(markets['home_win'], markets['away_win']);
        markets['double_chance_favorite'] = markets['favorite_win'] + markets['draw'];
        markets['double_chance_outsider'] = markets['outsider_win'] + markets['draw'];
        
        let probBttsNo = 0;
        for (let i = 0; i <= maxGoals; i++) { probBttsNo += scoreProbabilities[i][0] + scoreProbabilities[0][i]; }
        probBttsNo -= scoreProbabilities[0][0];
        markets['btts'] = (1 - probBttsNo) * 100;
        markets['btts_no'] = 100 - markets['btts'];

        const matchProbs = this._calculateProbs(home + away);
        for(const key in matchProbs) { markets[`match_${key}`] = matchProbs[key]; }
        
        return { markets };
    }
}

function analyzeMatchMarkets(fixture, projectedHomeGoals, projectedAwayGoals) {
    const results = {};
    const ff = fixture.goals;
    const fh = fixture.score.halftime;
    if (ff.home === null || ff.away === null || fh.home === null || fh.away === null) return null;
    const didHomeWin = ff.home > ff.away;
    const didAwayWin = ff.away > ff.home;
    const wasDraw = ff.home === ff.away;
    const isHomeFavoriteModel = projectedHomeGoals > projectedAwayGoals;
    results['draw'] = wasDraw;
    results['favorite_win'] = (isHomeFavoriteModel && didHomeWin) || (!isHomeFavoriteModel && didAwayWin);
    results['outsider_win'] = (isHomeFavoriteModel && didAwayWin) || (!isHomeFavoriteModel && didHomeWin);
    results['double_chance_favorite'] = results['favorite_win'] || wasDraw;
    results['double_chance_outsider'] = results['outsider_win'] || wasDraw;
    const sh = { home: ff.home - fh.home, away: ff.away - fh.away };
    results.btts = ff.home > 0 && ff.away > 0;
    results['btts_no'] = !results.btts;
    [0.5, 1.5, 2.5, 3.5].forEach(t => {
        results[`match_over_${t}`] = ff.home + ff.away > t;
        results[`match_under_${t}`] = ff.home + ff.away < t;
        results[`ht_over_${t}`] = fh.home + fh.away > t;
        results[`ht_under_${t}`] = fh.home + fh.away < t;
        results[`st_over_${t}`] = sh.home + sh.away > t;
        results[`st_under_${t}`] = sh.home + sh.away < t;
        results[`home_over_${t}`] = ff.home > t;
        results[`home_under_${t}`] = ff.home < t;
        results[`away_over_${t}`] = ff.away > t;
        results[`away_under_${t}`] = ff.home < t;
        results[`home_ht_over_${t}`] = fh.home > t;
        results[`home_ht_under_${t}`] = fh.home < t;
        results[`away_ht_over_${t}`] = fh.away > t;
        results[`away_ht_under_${t}`] = fh.away < t;
        results[`home_st_over_${t}`] = sh.home > t;
        results[`home_st_under_${t}`] = sh.home < t;
        results[`away_st_over_${t}`] = sh.away > t;
        results[`away_st_under_${t}`] = sh.away < t;
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
    console.log(chalk.blue.bold("--- Démarrage de l'analyseur de backtesting (Poisson Complet & Début de Saison) ---"));
    const season = new Date().getFullYear();
    const poisson = new PoissonModel();

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Traitement : ${league.name}`));
        try {
            const roundsResponse = await api.get('/fixtures/rounds', { params: { league: league.id, season: season, current: 'true' } });
            if (!roundsResponse.data?.response?.length) { console.log(chalk.gray(`   -> Aucune journée "en cours" trouvée.`)); continue; }
            const currentRoundName = roundsResponse.data.response[0];
            const roundParts = currentRoundName.match(/(\D+)(\d+)/);
            if (!roundParts || parseInt(roundParts[2], 10) <= 1) { console.log(chalk.gray(`   -> Pas de journée N-1 à analyser.`)); continue; }
            const prefix = roundParts[1].trim();
            const previousRoundName = `${prefix} ${parseInt(roundParts[2], 10) - 1}`;
            console.log(`   - Journée N-1 à analyser : "${previousRoundName}"`);
            const fixturesResponse = await api.get('/fixtures', { params: { league: league.id, season: season, round: previousRoundName } });
            const finishedMatches = fixturesResponse.data.response.filter(f => f.fixture.status.short === 'FT');
            console.log(`   - ${finishedMatches.length} match(s) terminé(s) trouvé(s).`);

            for (const fixture of finishedMatches) {
                const matchLabel = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
                console.log(chalk.green(`\n    Analyse de : ${matchLabel}`));
                
                const homeStats = await getTeamStats(fixture.teams.home.id, league.id, season);
                const awayStats = await getTeamStats(fixture.teams.away.id, league.id, season);
                if (!homeStats || !awayStats) continue;

                const matchesPlayed = homeStats.fixtures.played.total;
                let isEarlySeason = matchesPlayed < 6;
                let confidenceAdjustment = isEarlySeason ? {
                    'over_under': (matchesPlayed / 6) * 0.6 + 0.4,
                    'btts': (matchesPlayed / 6) * 0.6 + 0.4,
                    'result': (matchesPlayed / 6) * 0.4 + 0.6
                } : { 'over_under': 1, 'btts': 1, 'result': 1 };

                let homeAvgFor = parseFloat(homeStats.goals.for.average.total) || 0;
                let homeAvgAgainst = parseFloat(homeStats.goals.against.average.total) || 0;
                let awayAvgFor = parseFloat(awayStats.goals.for.average.total) || 0;
                let awayAvgAgainst = parseFloat(awayStats.goals.against.average.total) || 0;

                if (isEarlySeason) {
                    console.log(chalk.yellow(`      -> Début de saison détecté (${matchesPlayed} matchs). Application des corrections.`));
                    const prevHomeStats = await getTeamStats(fixture.teams.home.id, league.id, season - 1);
                    const prevAwayStats = await getTeamStats(fixture.teams.away.id, league.id, season - 1);
                    let stabilityBoost = 1;
                    if (prevHomeStats && prevAwayStats) {
                        const prevHomeAvgFor = parseFloat(prevHomeStats.goals.for.average.total) || homeAvgFor;
                        const prevAwayAvgFor = parseFloat(prevAwayStats.goals.for.average.total) || awayAvgFor;
                        const homeStability = Math.abs(prevHomeAvgFor - homeAvgFor) < 0.5 ? 1.1 : 1;
                        const awayStability = Math.abs(prevAwayAvgFor - awayAvgFor) < 0.5 ? 1.1 : 1;
                        stabilityBoost = (homeStability + awayStability) / 2;
                        homeAvgFor = (0.8 * (prevHomeAvgFor || homeAvgFor)) + (0.2 * homeAvgFor);
                        homeAvgAgainst = (0.8 * (parseFloat(prevHomeStats.goals.against.average.total) || homeAvgAgainst)) + (0.2 * homeAvgAgainst);
                        awayAvgFor = (0.8 * (prevAwayAvgFor || awayAvgFor)) + (0.2 * awayAvgFor);
                        awayAvgAgainst = (0.8 * (parseFloat(prevAwayStats.goals.against.average.total) || awayAvgAgainst)) + (0.2 * awayAvgAgainst);
                    }
                    homeAvgFor = bayesianSmooth(homeAvgFor, matchesPlayed) * stabilityBoost;
                    homeAvgAgainst = bayesianSmooth(homeAvgAgainst, matchesPlayed) * stabilityBoost;
                    awayAvgFor = bayesianSmooth(awayAvgFor, matchesPlayed) * stabilityBoost;
                    awayAvgAgainst = bayesianSmooth(awayAvgAgainst, matchesPlayed) * stabilityBoost;
                }

                const projectedHomeGoals = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayGoals = (awayAvgFor + homeAvgAgainst) / 2;
                
                const marketResults = analyzeMatchMarkets(fixture, projectedHomeGoals, projectedAwayGoals);
                if (!marketResults) continue;

                totalMatchesAnalyzed++;
                for (const market in marketResults) { if (marketResults[market] === true) { marketOccurrences[market] = (marketOccurrences[market] || 0) + 1; } }
                
                const lambdaBoost = matchesPlayed >= 6 ? 1.1 : 1;
                const lambdas = {
                    home: projectedHomeGoals * lambdaBoost, away: projectedAwayGoals * lambdaBoost,
                    ht: ((projectedHomeGoals + projectedAwayGoals) * 0.45) * lambdaBoost, 
                    st: ((projectedHomeGoals + projectedAwayGoals) * 0.55) * lambdaBoost,
                    home_ht: (projectedHomeGoals * 0.45) * lambdaBoost, away_ht: (projectedAwayGoals * 0.45) * lambdaBoost,
                    home_st: (projectedHomeGoals * 0.55) * lambdaBoost, away_st: (projectedAwayGoals * 0.55) * lambdaBoost
                };
                const poissonPreds = poisson.predict(lambdas, homeStats, awayStats, projectedHomeGoals, projectedAwayGoals);
                let confidenceScores = poissonPreds.markets;

                // Vérifier et ajouter des marchés manquants avec valeur par défaut
                for (const market of Object.keys(marketResults)) {
                    if (!confidenceScores[market]) {
                        console.log(chalk.yellow(`Avertissement : Pas de prédiction Poisson pour ${market}. Utilisation de 50% par défaut.`));
                        confidenceScores[market] = 50;
                    }
                }

                if (isEarlySeason) {
                    for (const market in confidenceScores) {
                        let adjustmentType = market.includes('over') || market.includes('under') ? 'over_under' :
                                             market.includes('btts') ? 'btts' : 'result';
                        confidenceScores[market] *= confidenceAdjustment[adjustmentType];
                    }
                }

                // Ajustement de calibration pour les marchés basés sur les résultats
                for (const market in confidenceScores) {
                    if (['draw', 'favorite_win', 'outsider_win'].includes(market)) {
                        confidenceScores[market] *= 1.2;
                    }
                }

                // Filtrer les matchs à faible confiance
                const maxConfidence = Math.max(...Object.values(confidenceScores));
                if (maxConfidence < 60) {
                    console.log(chalk.yellow(`Match ${matchLabel} exclu : aucune prédiction avec confiance ≥ 60%.`));
                    continue;
                }

                detailedResults.push({ leagueName: league.name, matchLabel, scoreLabel: `(Mi-temps: ${fixture.score.halftime.home}-${fixture.score.halftime.away}, Final: ${fixture.score.fulltime.home}-${fixture.score.fulltime.away})`, isEarlySeason, results: marketResults, scores: confidenceScores });
                
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
                await sleep(500);
            }
        } catch (error) { console.log(chalk.red.bold(`\n   ❌ ERREUR FINALE pour ${league.name}: ${error.message}`)); }
    }
    analysisStatus = `Analyse terminée. ${totalMatchesAnalyzed} matchs analysés.`;
    console.log(chalk.blue.bold("\n--- ANALYSE TERMINÉE ---"));

    try {
        // Exclure les marchés avec moins de 20 occurrences
        for (const market in trancheAnalysis) {
            if ((marketOccurrences[market] || 0) < 20) {
                delete trancheAnalysis[market];
                console.log(chalk.yellow(`Marché ${market} exclu du rapport (moins de 20 occurrences).`));
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

        // Normaliser earlySeasonTrancheSummary
        for (const key in earlySeasonTrancheSummary) {
            const tranche = earlySeasonTrancheSummary[key];
            if (tranche.total > 0) {
                tranche.avgPredicted /= tranche.total;
            }
        }

        const finalReport = { totalMatchesAnalyzed, globalSummary: globalTrancheSummary, perMarketSummary: trancheAnalysis, marketOccurrences, calibration: calibrationReport, earlySeasonSummary: earlySeasonTrancheSummary };
        fs.writeFileSync('bilan_backtest.json', JSON.stringify(finalReport, null, 2));
        console.log(chalk.magenta.bold('-> Bilan du backtest sauvegardé dans le fichier bilan_backtest.json'));
    } catch (error) {
        console.error(chalk.red('Erreur lors de la sauvegarde du fichier JSON:'), error);
    }
}

app.get('/', (req, res) => {
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Résultats du Backtest</title>
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
        </head><body><h1>Résultats du Backtest de Confiance</h1><div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;

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
            html += `<tr><td colspan="4">Calibration non disponible (analyse en cours ou aucun résultat).</td></tr>`;
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
            html += `<tr><td colspan="4">Analyse des débuts de saison non disponible (en cours ou aucun match en début de saison).</td></tr>`;
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
                html += `<tr><td>${market}</td><td class="score">${score !== undefined ? Math.round(score) : 'N/A'}</td><td class="${result ? 'win' : 'loss'}">${result ? 'Vrai' : 'Faux'}</td></tr>`;
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