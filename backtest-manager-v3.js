const axios = require('axios');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION ---
const PORT = 3000;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba'; // Remplacez par votre clé API
const API_HOST = 'v3.football.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    // ... (votre liste de ligues)
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
    { name: 'Premier Division', id: 357 }, { name: 'Besta deild karla', id: 164 },
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

// --- VARIABLES GLOBALES POUR L'APP WEB ---
let detailedResults = [];
let trancheAnalysis = {}; 
let analysisStatus = "Analyse non démarrée.";

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- FONCTIONS UTILITAIRES (inchangées) ---
function calculateScore(value, threshold, scale) { return Math.max(0, Math.min(100, Math.round(50 + ((value - threshold) * scale)))); }
function analyzeMatchMarkets(fixture) { const r={},f=fixture.goals,h=fixture.score.halftime;if(f.home===null||f.away===null||h.home===null||h.away===null)return null;const s={home:f.home-h.home,away:f.away-h.away};r.btts=f.home>0&&f.away>0;[0.5,1.5,2.5,3.5].forEach(t=>{r[`match_over_${t}`]=f.home+f.away>t;r[`match_under_${t}`]=f.home+f.away<t;r[`ht_over_${t}`]=h.home+h.away>t;r[`ht_under_${t}`]=h.home+h.away<t;r[`st_over_${t}`]=s.home+s.away>t;r[`st_under_${t}`]=s.home+s.away<t;r[`home_over_${t}`]=f.home>t;r[`home_under_${t}`]=f.home<t;r[`away_over_${t}`]=f.away>t;r[`away_under_${t}`]=f.away<t;r[`home_ht_over_${t}`]=h.home>t;r[`home_ht_under_${t}`]=h.home<t;r[`away_ht_over_${t}`]=h.away>t;r[`away_ht_under_${t}`]=h.away<t;r[`home_st_over_${t}`]=s.home>t;r[`home_st_under_${t}`]=s.home<t;r[`away_st_over_${t}`]=s.away>t;r[`away_st_under_${t}`]=s.away<t});return r; }
async function getTeamStats(teamId, leagueId, season) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            const response = await api.get('/teams/statistics', { params: { team: teamId, league: leagueId, season: season } });
            if (response.data && response.data.response) return response.data.response;
        } catch (error) {
            const reason = error.response ? `API Error ${error.response.status}` : error.message;
            console.log(chalk.yellow(`      -> Tentative ${attempts}/${MAX_ATTEMPTS} (stats équipe ${teamId}) échouée : ${reason}`));
        }
        if (attempts < MAX_ATTEMPTS) await sleep(1500);
    }
    console.log(chalk.red(`      -> ERREUR FINALE: Impossible de récupérer les stats pour l'équipe ${teamId} après ${MAX_ATTEMPTS} tentatives.`));
    return null;
}

// --- ANALYSEUR DE BACKTESTING (inchangé) ---
async function runBacktestAnalyzer() {
    analysisStatus = "Analyse en cours...";
    console.log(chalk.blue.bold("--- Démarrage de l'analyseur de backtesting ---"));
    const season = new Date().getFullYear();

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
                const [homeStats, awayStats] = await Promise.all([ getTeamStats(fixture.teams.home.id, league.id, season), getTeamStats(fixture.teams.away.id, league.id, season) ]);
                if (!homeStats || !awayStats) continue;
                const homeAvgFor = parseFloat(homeStats.goals.for.average.total);
                const homeAvgAgainst = parseFloat(homeStats.goals.against.average.total);
                const awayAvgFor = parseFloat(awayStats.goals.for.average.total);
                const awayAvgAgainst = parseFloat(awayStats.goals.against.average.total);
                const projectedGoals = (homeAvgFor + awayAvgFor + homeAvgAgainst + awayAvgAgainst) / 2;
                const bttsPotential = ((homeAvgFor + awayAvgAgainst) / 2) + ((awayAvgFor + homeAvgAgainst) / 2);
                const projectedHomeGoals = (homeAvgFor + awayAvgAgainst) / 2;
                const projectedAwayGoals = (awayAvgFor + homeAvgAgainst) / 2;
                const projectedHTGoals = projectedGoals * 0.45;
                const projectedSTGoals = projectedGoals * 0.55;
                const confidenceScores = {
                    'match_over_0.5': calculateScore(projectedGoals, 0.5, 10),'match_over_1.5': calculateScore(projectedGoals, 1.5, 15),'match_over_2.5': calculateScore(projectedGoals, 2.5, 22),'match_over_3.5': calculateScore(projectedGoals, 3.5, 25),'match_under_1.5': 100 - calculateScore(projectedGoals, 1.5, 15),'match_under_2.5': 100 - calculateScore(projectedGoals, 2.5, 22),'match_under_3.5': 100 - calculateScore(projectedGoals, 3.5, 25),'btts': calculateScore(bttsPotential, 1.25, 40),'btts_no': 100 - calculateScore(bttsPotential, 1.25, 40),'home_over_0.5': calculateScore(projectedHomeGoals, 0.5, 12),'away_over_0.5': calculateScore(projectedAwayGoals, 0.5, 12),'home_under_2.5': 100 - calculateScore(projectedHomeGoals, 2.5, 20),'home_under_3.5': 100 - calculateScore(projectedHomeGoals, 3.5, 23),'away_under_2.5': 100 - calculateScore(projectedAwayGoals, 2.5, 20),'away_under_3.5': 100 - calculateScore(projectedAwayGoals, 3.5, 23),'ht_over_0.5': calculateScore(projectedHTGoals, 0.5, 30),'st_over_0.5': calculateScore(projectedSTGoals, 0.5, 28),'ht_under_2.5': 100 - calculateScore(projectedHTGoals, 2.5, 35),'ht_under_3.5': 100 - calculateScore(projectedHTGoals, 3.5, 38),'st_under_2.5': 100 - calculateScore(projectedSTGoals, 2.5, 33),'st_under_3.5': 100 - calculateScore(projectedSTGoals, 3.5, 36),'home_ht_under_1.5': 100 - calculateScore(projectedHomeGoals * 0.45, 1.5, 28),'home_st_under_1.5': 100 - calculateScore(projectedHomeGoals * 0.55, 1.5, 26),'away_ht_under_1.5': 100 - calculateScore(projectedAwayGoals * 0.45, 1.5, 28),'away_st_under_1.5': 100 - calculateScore(projectedAwayGoals * 0.55, 1.5, 26),
                };
                const marketResults = analyzeMatchMarkets(fixture);
                detailedResults.push({
                    leagueName: league.name, matchLabel, scoreLabel: `(Mi-temps: ${fixture.score.halftime.home}-${fixture.score.halftime.away}, Final: ${fixture.score.fulltime.home}-${fixture.score.fulltime.away})`, results: marketResults, scores: confidenceScores
                });
                for (const market in confidenceScores) {
                    if (!trancheAnalysis[market]) {
                        trancheAnalysis[market] = Array(10).fill(null).map(() => ({ success: 0, total: 0 }));
                    }
                    const score = confidenceScores[market];
                    const trancheIndex = Math.min(9, Math.floor(score / 10));
                    const wasSuccess = marketResults[market];
                    trancheAnalysis[market][trancheIndex].total++;
                    if (wasSuccess) {
                        trancheAnalysis[market][trancheIndex].success++;
                    }
                }
                await sleep(500);
            }
        } catch (error) {
            console.log(chalk.red.bold(`\n   ❌ ERREUR FINALE pour ${league.name}: ${error.message}`));
        }
    }
    analysisStatus = "Analyse terminée. Les résultats sont disponibles.";
    console.log(chalk.blue.bold("\n--- ANALYSE TERMINÉE ---"));
}

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
    // MODIFIÉ: Le HTML est maintenant généré ici
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Résultats du Backtest</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            h1, h2, h3 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
            .status { background-color: #1e1e1e; border: 1px solid #373737; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .container { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
            .card { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 20px; }
            .card-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #373737; }
            th { background-color: #2a2a2a; }
            .win { color: #03dac6; } .loss { color: #cf6679; } .score { font-weight: bold; }
            .rate-high { background-color: #03dac630; } .rate-medium { background-color: #f0e68c30; } .rate-low { background-color: #cf667930; }
        </style>
        </head><body>
            <h1>Résultats du Backtest de Confiance</h1>
            <div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;

    // NOUVEAU: Bilan Global par Tranche de Confiance
    if (Object.keys(trancheAnalysis).length > 0) {
        const globalTrancheSummary = Array(10).fill(null).map(() => ({ success: 0, total: 0 }));
        for (const market in trancheAnalysis) {
            for (let i = 0; i < 10; i++) {
                globalTrancheSummary[i].success += trancheAnalysis[market][i].success;
                globalTrancheSummary[i].total += trancheAnalysis[market][i].total;
            }
        }

        html += `
            <h2>Bilan Global (Tous Marchés Confondus)</h2>
            <div class="card">
                <table>
                    <thead><tr><th>Tranche de Confiance</th><th>Prédictions Correctes</th><th>Total Prédictions</th><th>Taux de Réussite</th></tr></thead>
                    <tbody>`;
        globalTrancheSummary.forEach((tranche, i) => {
            if (tranche.total > 0) {
                const rate = (tranche.success / tranche.total) * 100;
                const rateClass = rate >= 75 ? 'rate-high' : rate >= 50 ? 'rate-medium' : 'rate-low';
                html += `
                    <tr class="${rateClass}">
                        <td>${i * 10} - ${i * 10 + 9}%</td>
                        <td>${tranche.success}</td>
                        <td>${tranche.total}</td>
                        <td class="score">${rate.toFixed(2)}%</td>
                    </tr>`;
            }
        });
        html += `</tbody></table></div>`;
    }


    // Bilan par marché (inchangé)
    if (Object.keys(trancheAnalysis).length > 0) {
        html += `<h2>Bilan par Tranche de Confiance (par Marché)</h2><div class="container">`;
        const sortedMarketsForTranche = Object.keys(trancheAnalysis).sort();
        for (const market of sortedMarketsForTranche) {
            html += `<div class="card"><div class="card-header">${market}</div><table><thead><tr><th>Tranche</th><th>Réussite</th><th>Total</th><th>Taux</th></tr></thead><tbody>`;
            trancheAnalysis[market].forEach((tranche, i) => {
                if (tranche.total > 0) {
                    const rate = (tranche.success / tranche.total) * 100;
                    const rateClass = rate >= 75 ? 'rate-high' : rate >= 50 ? 'rate-medium' : 'rate-low';
                    html += `<tr class="${rateClass}"><td>${i * 10}-${i * 10 + 9}%</td><td>${tranche.success}</td><td>${tranche.total}</td><td class="score">${rate.toFixed(2)}%</td></tr>`;
                }
            });
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
    }

    // Résultats détaillés (inchangé)
    if (detailedResults.length > 0) {
        html += `<h2>Résultats Détaillés par Match</h2><div class="container">`;
        detailedResults.forEach(match => {
            html += `<div class="card"><div class="card-header">${match.leagueName} - ${match.matchLabel} - <span class="score">${match.scoreLabel}</span></div><table><thead><tr><th>Marché</th><th>Score</th><th>Résultat</th></tr></thead><tbody>`;
            const sortedMarkets = Object.keys(match.scores).sort();
            sortedMarkets.forEach(market => {
                const score = match.scores[market];
                const result = match.results[market];
                html += `<tr><td>${market}</td><td class="score">${score}</td><td class="${result ? 'win' : 'loss'}">${result ? 'Gagné' : 'Perdu'}</td></tr>`;
            });
            html += `</tbody></table></div>`;
        });
        html += `</div>`;
    }

    html += `</body></html>`;
    res.send(html);
});

// --- DÉMARRAGE ---
app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur web démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    runBacktestAnalyzer();
});