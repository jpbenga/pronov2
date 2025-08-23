const axios = require('axios');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION ---
const PORT = 3001;
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

// --- VARIABLES GLOBALES ---
let predictions = {};
let analysisStatus = "Analyse non démarrée.";
let totalMatchesAnalyzed = 0;

const app = express();
const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- MOTEUR DE CALCUL ---
function calculateScore(value, threshold, scale) { /* ... */ return Math.max(0, Math.min(100, Math.round(50 + ((value - threshold) * scale)))); }
async function getTeamStats(teamId, leagueId, season) { /* ... */ let a=0;while(a<MAX_ATTEMPTS){a++;try{const r=await api.get('/teams/statistics',{params:{team:teamId,league:leagueId,season:season}});if(r.data&&r.data.response)return r.data.response}catch(e){console.log(chalk.yellow(`-> Tentative ${a}/${MAX_ATTEMPTS} (stats équipe ${teamId}) échouée`))}if(a<MAX_ATTEMPTS)await sleep(1500)}console.log(chalk.red(`-> ERREUR FINALE: Stats pour équipe ${teamId}`));return null}
async function getOddsForFixture(fixtureId) { /* ... */ let a=0;while(a<MAX_ATTEMPTS){a++;try{const r=await api.get('/odds',{params:{fixture:fixtureId}});if(r.data&&r.data.response.length>0){return r.data.response}return null}catch(e){const s=e.response?`API Error ${e.response.status}`:e.message;console.log(chalk.yellow(`-> Tentative ${a}/${MAX_ATTEMPTS} (cotes) échouée: ${s}`))}if(a<MAX_ATTEMPTS)await sleep(1500)}console.log(chalk.red(`-> ERREUR FINALE: Cotes pour match ${fixtureId}`));return null}

// MODIFIÉ : La fonction parseOdds utilise maintenant les ID de paris pour être exacte
function parseOdds(oddsData) {
    if (!oddsData || oddsData.length === 0) return {};

    const parsed = {};
    const fixtureOdds = oddsData[0]; 

    for (const bookmaker of fixtureOdds.bookmakers) {
        for (const bet of bookmaker.bets) {
            // On utilise l'ID du pari, qui est stable et fiable
            switch (bet.id) {
                case 5: // Goals Over/Under (Match entier)
                    bet.values.forEach(v => {
                        const key = `match_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 8: // Both Teams Score
                    bet.values.forEach(v => {
                        const key = v.value === 'Yes' ? 'btts' : 'btts_no';
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 16: // Total - Home
                    bet.values.forEach(v => {
                        const key = `home_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 17: // Total - Away
                    bet.values.forEach(v => {
                        const key = `away_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 6: // Goals Over/Under First Half
                    bet.values.forEach(v => {
                        const key = `ht_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 26: // Goals Over/Under - Second Half
                     bet.values.forEach(v => {
                        const key = `st_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 105: // Home Team Total Goals(1st Half)
                     bet.values.forEach(v => {
                        const key = `home_ht_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
                case 106: // Away Team Total Goals(1st Half)
                     bet.values.forEach(v => {
                        const key = `away_ht_${v.value.toLowerCase().replace(' ', '_')}`;
                        if (!parsed[key]) parsed[key] = parseFloat(v.odd);
                    });
                    break;
            }
        }
    }
    return parsed;
}


// --- MOTEUR DE PRÉDICTION ---
async function runPredictionEngine() {
    // ... (le reste du script est inchangé)
    analysisStatus = "Analyse en cours...";
    console.log(chalk.blue.bold("--- Démarrage du moteur de prédiction ---"));
    const season = new Date().getFullYear();
    totalMatchesAnalyzed = 0;

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(chalk.cyan.bold(`\n[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Analyse de : ${league.name}`));
        try {
            const roundsResponse = await api.get('/fixtures/rounds', { params: { league: league.id, season: season, current: 'true' } });
            if (!roundsResponse.data?.response?.length) { console.log(chalk.gray(`   -> Pas de journée en cours trouvée.`)); continue; }
            const currentRoundName = roundsResponse.data.response[0];
            console.log(`   - Analyse de la journée : "${currentRoundName}"`);
            const fixturesResponse = await api.get('/fixtures', { params: { league: league.id, season: season, round: currentRoundName } });
            const upcomingMatches = fixturesResponse.data.response.filter(f => f.fixture.status.short === 'NS');
            if (upcomingMatches.length === 0) { console.log(chalk.gray(`   -> Aucun match à venir dans cette journée.`)); continue; }
            
            console.log(`   - ${upcomingMatches.length} match(s) à venir trouvé(s).`);
            predictions[league.name] = [];

            for (const fixture of upcomingMatches) {
                const matchLabel = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
                console.log(chalk.green(`\n    Calcul pour : ${matchLabel}`));
                
                const [homeStats, awayStats, oddsData] = await Promise.all([ getTeamStats(fixture.teams.home.id, league.id, season), getTeamStats(fixture.teams.away.id, league.id, season), getOddsForFixture(fixture.fixture.id) ]);
                if (!homeStats || !awayStats) { console.log(chalk.red(`      -> Échec: Stats manquantes.`)); continue; }

                const parsedOdds = parseOdds(oddsData);

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
                const confidenceScores = { 'match_over_0.5': calculateScore(projectedGoals, 0.5, 10),'match_over_1.5': calculateScore(projectedGoals, 1.5, 15),'match_over_2.5': calculateScore(projectedGoals, 2.5, 22),'match_over_3.5': calculateScore(projectedGoals, 3.5, 25),'match_under_1.5': 100 - calculateScore(projectedGoals, 1.5, 15),'match_under_2.5': 100 - calculateScore(projectedGoals, 2.5, 22),'match_under_3.5': 100 - calculateScore(projectedGoals, 3.5, 25),'btts': calculateScore(bttsPotential, 1.25, 40),'btts_no': 100 - calculateScore(bttsPotential, 1.25, 40),'home_over_0.5': calculateScore(projectedHomeGoals, 0.5, 12),'away_over_0.5': calculateScore(projectedAwayGoals, 0.5, 12),'home_under_2.5': 100 - calculateScore(projectedHomeGoals, 2.5, 20),'home_under_3.5': 100 - calculateScore(projectedHomeGoals, 3.5, 23),'away_under_2.5': 100 - calculateScore(projectedAwayGoals, 2.5, 20),'away_under_3.5': 100 - calculateScore(projectedAwayGoals, 3.5, 23),'ht_over_0.5': calculateScore(projectedHTGoals, 0.5, 30),'st_over_0.5': calculateScore(projectedSTGoals, 0.5, 28),'ht_under_2.5': 100 - calculateScore(projectedHTGoals, 2.5, 35),'ht_under_3.5': 100 - calculateScore(projectedHTGoals, 3.5, 38),'st_under_2.5': 100 - calculateScore(projectedSTGoals, 2.5, 33),'st_under_3.5': 100 - calculateScore(projectedSTGoals, 3.5, 36),'home_ht_under_1.5': 100 - calculateScore(projectedHomeGoals * 0.45, 1.5, 28),'home_st_under_1.5': 100 - calculateScore(projectedHomeGoals * 0.55, 1.5, 26),'away_ht_under_1.5': 100 - calculateScore(projectedAwayGoals * 0.45, 1.5, 28),'away_st_under_1.5': 100 - calculateScore(projectedAwayGoals * 0.55, 1.5, 26), };
                const fixtureDate = new Date(fixture.fixture.date);
                
                predictions[league.name].push({ matchLabel, date: fixtureDate.toLocaleDateString('fr-FR'), time: fixtureDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), scores: confidenceScores, odds: parsedOdds });
                totalMatchesAnalyzed++;
                
                await sleep(500);
            }
        } catch (error) { console.log(chalk.red.bold(`\n   ❌ ERREUR pour ${league.name}: ${error.message}`)); }
    }
    analysisStatus = `Prédictions prêtes. ${totalMatchesAnalyzed} matchs analysés.`;
    console.log(chalk.blue.bold("\n--- PRÉDICTIONS TERMINÉES ---"));
}

function getIntuitiveBestBet(scores) { /* ... */ let b={market:'N/A',score:50};let m=0;for(const k in scores){const s=scores[k];const c=Math.abs(s-50);if(c>m){m=c;b={market:k,score:s}}}if(b.score<50){let f=b.market;if(f.includes('_over_')){f=f.replace('_over_','_under_')}else if(f.includes('_under_')){f=f.replace('_under_','_over_')}else if(f==='btts'){f='btts_no'}else if(f==='btts_no'){f='btts'}return{market:f,score:100-b.score}}return b}

// --- SERVEUR WEB (inchangé) ---
app.get('/', (req, res) => {
    // ...
    let html = `
        <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Prédictions des Matchs</title>
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
            .score-high { color: #03dac6; } .score-low { color: #cf6679; } .score-mid { color: #f0e68c; }
            .na { color: #666; }
        </style>
        </head><body>
            <h1>Prédictions des Matchs à Venir</h1>
            <div class="status"><strong>Statut :</strong> ${analysisStatus}</div>`;

    if (Object.keys(predictions).length > 0) {
        for (const leagueName in predictions) {
            html += `<div class="league-container"><h2>${leagueName}</h2><table>
                        <thead><tr><th>Match</th><th>Date</th><th>Heure</th><th>Marché le + Fiable</th></tr></thead><tbody>`;

            predictions[leagueName].forEach(match => {
                const bestBet = getIntuitiveBestBet(match.scores);
                const scoreClass = bestBet.score >= 75 ? 'score-high' : 'score-mid';
                const bestBetOdd = match.odds[bestBet.market];

                html += `
                    <tr>
                        <td>${match.matchLabel}</td>
                        <td>${match.date}</td>
                        <td>${match.time}</td>
                        <td>${bestBet.market} <span class="score ${scoreClass}">(${bestBet.score})</span> @ ${bestBetOdd ? bestBetOdd.toFixed(2) : '<span class="na">N/A</span>'}</td>
                    </tr>
                    <tr><td colspan="4" style="padding:0;">
                        <details>
                            <summary>Voir tous les scores et cotes</summary>
                            <table class="details-table">
                                <thead><tr><th>Marché</th><th>Score de Confiance</th><th>Cote</th></tr></thead>
                                <tbody>
                `;
                const sortedMarkets = Object.keys(match.scores).sort();
                for (const market of sortedMarkets) {
                    const score = match.scores[market];
                    const odd = match.odds[market];
                    const sClass = score >= 75 ? 'score-high' : score <= 25 ? 'score-low' : 'score-mid';
                    html += `<tr>
                                <td>${market}</td>
                                <td class="score ${sClass}">${score}</td>
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