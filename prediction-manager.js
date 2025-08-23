const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// --- CONFIGURATION ---
const API_KEY = '7f7700a471beeeb52aecde406a3870ba'; // Remplacez par votre clé API
const API_HOST = 'v3.football.api-sports.io';
const MAX_ATTEMPTS = 5;
const RANK_GAP_THRESHOLD = 5;

// Liste complète des championnats
const LEAGUES_TO_ANALYZE = [
    { name: 'Bundesliga', id: 78, coeff: 1.0 }, { name: 'Bundesliga 2', id: 79, coeff: 0.85 },
    { name: 'Premier League', id: 39, coeff: 1.0 }, { name: 'Championship', id: 40, coeff: 0.85 },
    { name: 'Saudi Pro League', id: 307, coeff: 0.75 }, { name: 'Liga Profesional', id: 128, coeff: 0.85 },
    { name: 'Bundesliga (Autriche)', id: 218, coeff: 0.75 }, { name: 'Pro League', id: 144, coeff: 0.8 },
    { name: 'Série A (Brésil)', id: 71, coeff: 0.85 }, { name: 'Parva Liga', id: 172, coeff: 0.7 },
    { name: 'Primera Division (Chili)', id: 265, coeff: 0.75 }, { name: 'Super League (Chine)', id: 169, coeff: 0.7 },
    { name: 'Primera A', id: 239, coeff: 0.75 }, { name: 'K League 1', id: 292, coeff: 0.8 },
    { name: 'HNL', id: 210, coeff: 0.75 }, { name: 'Superliga', id: 119, coeff: 0.8 },
    { name: 'Premiership', id: 179, coeff: 0.75 }, { name: 'Liga Pro', id: 240, coeff: 0.7 },
    { name: 'La Liga', id: 140, coeff: 1.0 }, { name: 'La Liga 2', id: 141, coeff: 0.85 },
    { name: 'Meistriliiga', id: 327, coeff: 0.65 }, { name: 'MLS', id: 253, coeff: 0.8 },
    { name: 'Veikkausliiga', id: 244, coeff: 0.7 }, { name: 'Ligue 1', id: 61, coeff: 1.0 },
    { name: 'Ligue 2', id: 62, coeff: 0.85 }, { name: 'Erovnuli Liga', id: 329, coeff: 0.65 },
    { name: 'Super League (Grèce)', id: 197, coeff: 0.8 }, { name: 'OTP Bank Liga', id: 271, coeff: 0.7 },
    { name: 'Premier Division', id: 357, coeff: 0.7 }, { name: 'Besta deild karla', id: 164, coeff: 0.65 },
    { name: 'Serie A', id: 135, coeff: 1.0 }, { name: 'Serie B', id: 136, coeff: 0.85 },
    { name: 'J1 League', id: 98, coeff: 0.8 }, { name: 'A Lyga', id: 331, coeff: 0.65 },
    { name: 'Liga MX', id: 262, coeff: 0.8 }, { name: 'Eliteserien', id: 103, coeff: 0.75 },
    { name: 'Primera Division (Paraguay)', id: 284, coeff: 0.7 }, { name: 'Eredivisie', id: 88, coeff: 0.85 },
    { name: 'Cymru Premier', id: 110, coeff: 0.65 }, { name: 'Ekstraklasa', id: 106, coeff: 0.75 },
    { name: 'Liga Portugal', id: 94, coeff: 0.85 }, { name: 'Liga Portugal 2', id: 95, coeff: 0.75 },
    { name: 'Fortuna Liga', id: 345, coeff: 0.7 }, { name: 'Liga 1', id: 283, coeff: 0.7 },
    { name: 'Super Liga', id: 286, coeff: 0.7 }, { name: 'Nike Liga', id: 334, coeff: 0.65 },
    { name: 'Prva Liga', id: 373, coeff: 0.65 }, { name: 'Allsvenskan', id: 113, coeff: 0.75 },
    { name: 'Super League (Suisse)', id: 207, coeff: 0.8 }, { name: 'Super Lig', id: 203, coeff: 0.8 },
    { name: 'Premier League (Ukraine)', id: 235, coeff: 0.75 }
];

const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function calculateFormScore(formString) { if (!formString) return 0; return formString.split('').reduce((acc, char) => (char === 'W' ? acc + 3 : char === 'D' ? acc + 1 : acc), 0); }
function getHalfTimeGoalPercentage(minuteStats) { if (!minuteStats) return 0.45; const fh = ['0-15', '16-30', '31-45']; let fhGoals = 0, tGoals = 0; for (const p in minuteStats) { const g = minuteStats[p]?.total || 0; if (fh.includes(p)) fhGoals += g; tGoals += g; } return tGoals > 0 ? (fhGoals / tGoals) : 0.45; }
function calculateScore(p, b, s) { return Math.max(5, Math.min(95, 50 + (p - b) * s)); }

async function runPredictionAnalysis() {
    console.log("--- Lancement de l'analyse... ---");
    const season = new Date().getFullYear();
    const analysisData = [];
    let totalMatchesAnalyzed = 0;

    for (const league of LEAGUES_TO_ANALYZE) {
        const leagueResults = { name: league.name, matches: [] };
        console.log(`\nTraitement : ${league.name}...`);
        
        let leagueAttempts = 0, leagueSuccess = false;
        while (leagueAttempts < MAX_ATTEMPTS && !leagueSuccess) {
            leagueAttempts++;
            if (leagueAttempts > 1) console.log(` -> Tentative ${leagueAttempts}/${MAX_ATTEMPTS} pour la ligue...`);
            try {
                const roundsResponse = await api.get('/fixtures/rounds', { params: { league: league.id, season: season, current: 'true' } });
                if (!roundsResponse.data?.response?.length) { leagueSuccess = true; continue; }
                const currentRoundName = roundsResponse.data.response[0];
                const roundParts = currentRoundName.match(/(\D+)(\d+)/);
                if (!roundParts || parseInt(roundParts[2], 10) <= 1) { leagueSuccess = true; continue; }
                const previousRoundName = `${roundParts[1].trim()} ${parseInt(roundParts[2], 10) - 1}`;
                const fixturesResponse = await api.get('/fixtures', { params: { league: league.id, season: season, round: previousRoundName } });
                const finishedMatches = fixturesResponse.data.response.filter(f => f.fixture.status.short === 'FT');

                for (const fixture of finishedMatches) {
                    // --- ISOLATION D'ERREUR POUR CHAQUE MATCH ---
                    try {
                        let standingsData = null, homeStatsData = null, awayStatsData = null;
                        
                        let standingsAttempts = 0, standingsSuccess = false;
                        while(standingsAttempts < MAX_ATTEMPTS && !standingsSuccess) {
                            standingsAttempts++;
                            try {
                                const sR = await api.get('/standings', { params: { league: league.id, season: season } });
                                if (!sR.data?.response?.[0]?.league?.standings?.[0]) throw new Error("Données de classement invalides.");
                                standingsData = sR.data;
                                standingsSuccess = true;
                            } catch (error) {
                                const reason = error.response ? `API Error ${error.response.status}` : error.message;
                                console.warn(` -> Tentative ${standingsAttempts}/${MAX_ATTEMPTS} échouée pour classement (Match ID ${fixture.fixture.id}): ${reason}`);
                                if(standingsAttempts < MAX_ATTEMPTS) await sleep(500);
                            }
                        }
                        if (!standingsSuccess) throw new Error(`Échec final de récupération du classement pour match ${fixture.fixture.id}`);

                        let homeStatsAttempts = 0, homeStatsSuccess = false;
                        while(homeStatsAttempts < MAX_ATTEMPTS && !homeStatsSuccess) {
                            homeStatsAttempts++;
                            try {
                                const hR = await api.get('/teams/statistics', { params: { team: fixture.teams.home.id, league: league.id, season: season } });
                                if (!hR.data?.response?.goals?.for) throw new Error("Stats domicile invalides.");
                                homeStatsData = hR.data;
                                homeStatsSuccess = true;
                            } catch (error) {
                                 const reason = error.response ? `API Error ${error.response.status}` : error.message;
                                 console.warn(` -> Tentative ${homeStatsAttempts}/${MAX_ATTEMPTS} échouée pour stats domicile (Match ID ${fixture.fixture.id}): ${reason}`);
                                 if(homeStatsAttempts < MAX_ATTEMPTS) await sleep(500);
                            }
                        }
                        if (!homeStatsSuccess) throw new Error(`Échec final de récupération stats domicile pour match ${fixture.fixture.id}`);

                        let awayStatsAttempts = 0, awayStatsSuccess = false;
                        while(awayStatsAttempts < MAX_ATTEMPTS && !awayStatsSuccess) {
                            awayStatsAttempts++;
                            try {
                                const aR = await api.get('/teams/statistics', { params: { team: fixture.teams.away.id, league: league.id, season: season } });
                                if (!aR.data?.response?.goals?.for) throw new Error("Stats extérieur invalides.");
                                awayStatsData = aR.data;
                                awayStatsSuccess = true;
                            } catch(error) {
                                const reason = error.response ? `API Error ${error.response.status}` : error.message;
                                console.warn(` -> Tentative ${awayStatsAttempts}/${MAX_ATTEMPTS} échouée pour stats extérieur (Match ID ${fixture.fixture.id}): ${reason}`);
                                if(awayStatsAttempts < MAX_ATTEMPTS) await sleep(500);
                            }
                        }
                        if (!awayStatsSuccess) throw new Error(`Échec final de récupération stats extérieur pour match ${fixture.fixture.id}`);
                        
                        const standings = standingsData.response[0].league.standings[0];
                        const homeTeam = standings.find(t => t.team.id === fixture.teams.home.id);
                        const awayTeam = standings.find(t => t.team.id === fixture.teams.away.id);
                        if (!homeTeam || !awayTeam) throw new Error(`Équipes non trouvées dans le classement pour match ${fixture.fixture.id}`);

                        const p = {};
                        p.home = (parseFloat(homeStatsData.response.goals.for.average.home) + parseFloat(awayStatsData.response.goals.against.average.away)) / 2;
                        p.away = (parseFloat(awayStatsData.response.goals.for.average.away) + parseFloat(homeStatsData.response.goals.against.average.home)) / 2;
                        p.total = p.home + p.away;
                        p.ht = (p.home * getHalfTimeGoalPercentage(homeStatsData.response.goals.for.minute)) + (p.away * getHalfTimeGoalPercentage(awayStatsData.response.goals.for.minute));
                        p.st = p.total - p.ht;

                        const strategies = {
                            'match_over_0.5': calculateScore(p.total, 0.5, 30), 'match_over_1.5': calculateScore(p.total, 1.5, 20),
                            'match_under_3.5': 100 - calculateScore(p.total, 3.5, 25), 'home_over_0.5': calculateScore(p.home, 0.5, 35),
                            'home_under_2.5': 100 - calculateScore(p.home, 2.5, 28), 'away_over_0.5': calculateScore(p.away, 0.5, 35),
                            'away_under_2.5': 100 - calculateScore(p.away, 2.5, 28), 'ht_over_0.5': calculateScore(p.ht, 0.5, 40),
                            'ht_under_1.5': 100 - calculateScore(p.ht, 1.5, 35), 'st_over_0.5': calculateScore(p.st, 0.5, 30),
                            'st_under_1.5': 100 - calculateScore(p.st, 1.5, 30),
                            'double_chance_favori': (() => {
                                const rg = Math.abs(homeTeam.rank - awayTeam.rank); if (rg < RANK_GAP_THRESHOLD) return 20;
                                let score = (rg - (RANK_GAP_THRESHOLD - 1)) * 3 + 25;
                                const fr = Math.min(homeTeam.rank, awayTeam.rank);
                                if (fr <= 3) score += 30; else if (fr <= 6) score += 25; else score += 15;
                                score += (calculateFormScore(homeTeam.form) - calculateFormScore(awayTeam.form)) * (homeTeam.rank < awayTeam.rank ? 1 : -1);
                                return Math.min(100, score * league.coeff);
                            })()};
                        
                        const scores = Object.entries(strategies).map(([m, s]) => ({ market: m, score: Math.round(s) })).sort((a,b) => b.score - a.score);
                        
                        leagueResults.matches.push({
                            home: fixture.teams.home.name, away: fixture.teams.away.name,
                            score: `${fixture.goals.home}-${fixture.goals.away}`,
                            date: new Date(fixture.fixture.date).toLocaleDateString('fr-FR'),
                            favorite: homeTeam.rank < awayTeam.rank ? fixture.teams.home.name : fixture.teams.away.name,
                            scores: scores
                        });
                        totalMatchesAnalyzed++;
                    
                    } catch (matchError) {
                        console.error(`  -> ERREUR sur le match ID ${fixture.fixture.id}: ${matchError.message}. Passage au suivant.`);
                        // L'erreur est contenue, la boucle "for" continue normalement.
                    }
                }
                leagueSuccess = true;
            } catch (error) {
                const reason = error.response ? `API Error ${error.response.status}` : error.message;
                console.warn(` -> Échec de la tentative ${leagueAttempts}/${MAX_ATTEMPTS} pour la ligue ${league.name}: ${reason}`);
                if(leagueAttempts >= MAX_ATTEMPTS) {
                    console.error(`  -> Echec final pour ${league.name}`);
                } else {
                    await sleep(1500);
                }
            }
        }
        if (leagueResults.matches.length > 0) analysisData.push(leagueResults);
    }
    console.log("--- Analyse terminée ---");
    return { leagues: analysisData, totalMatches: totalMatchesAnalyzed };
}

// --- SERVEUR WEB ---
let analysisResults = null;

app.get('/api/results', async (req, res) => {
    try {
        if (!analysisResults) {
            analysisResults = await runPredictionAnalysis();
        }
        res.json(analysisResults);
    } catch (error) {
        res.status(500).json({ error: "Erreur durant l'analyse.", message: error.message });
    }
});

app.get('/', (req, res) => {
    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Résultats d'Analyse Prédictive</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f9; color: #333; margin: 0; padding: 20px; }
        header { text-align: center; border-bottom: 2px solid #ddd; padding-bottom: 20px; margin-bottom: 20px; }
        h1 { color: #2c3e50; }
        h2 { background-color: #34495e; color: white; padding: 10px 15px; border-radius: 5px; margin-top: 40px; }
        .match { background-color: white; border: 1px solid #e1e8ed; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .match-header { padding: 15px; border-bottom: 1px solid #e1e8ed; display: flex; justify-content: space-between; align-items: center; font-weight: bold; flex-wrap: wrap; }
        .match-header .teams { font-size: 1.1em; }
        .match-header .score { font-size: 1.1em; background-color: #ecf0f1; padding: 5px 10px; border-radius: 5px; }
        .scores-list { padding: 15px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
        .score-item { background-color: #f8f9fa; padding: 10px; border-radius: 5px; border-left: 4px solid #3498db; }
        .score-item span { font-weight: bold; color: #2980b9; }
        #loader { font-size: 1.5em; text-align: center; padding: 50px; }
        #footer { text-align: center; margin-top: 40px; padding: 20px; background-color: #34495e; color: white; border-radius: 5px; font-size: 1.2em; }
    </style>
</head>
<body>
    <header><h1>Analyse Prédictive des Matchs</h1></header>
    <div id="results-container">
        <div id="loader">
            <h2>🤖 Lancement de l'analyse...</h2>
            <p>Ce processus peut prendre plusieurs minutes. Veuillez patienter.</p>
        </div>
    </div>
    <div id="footer"></div>
    <script>
        window.addEventListener('DOMContentLoaded', () => {
            const container = document.getElementById('results-container');
            const footer = document.getElementById('footer');
            fetch('/api/results')
                .then(response => response.ok ? response.json() : Promise.reject(response))
                .then(data => {
                    container.innerHTML = '';
                    if (data.error) {
                         container.innerHTML = \`<h1>Erreur lors de l'analyse</h1><p>\${data.message}</p>\`;
                         return;
                    }
                    data.leagues.forEach(league => {
                        const leagueTitle = document.createElement('h2');
                        leagueTitle.textContent = league.name;
                        container.appendChild(leagueTitle);
                        league.matches.forEach(match => {
                            let matchHtml = \`
                                <div class="match">
                                    <div class="match-header">
                                        <div class="teams">\${match.home} vs \${match.away}</div>
                                        <div class="date">\${match.date}</div>
                                        <div class="score">\${match.score}</div>
                                    </div>
                                    <div class="scores-list">\`;
                            match.scores.forEach(s => {
                                let marketName = s.market;
                                if (marketName === 'double_chance_favori') {
                                    marketName = \`Double Chance \${match.favorite}\`;
                                }
                                matchHtml += \`<div class="score-item">\${marketName.replace(/_/g, ' ')} : <span>\${s.score}/100</span></div>\`;
                            });
                            matchHtml += \`</div></div>\`;
                            container.innerHTML += matchHtml;
                        });
                    });
                    footer.textContent = \`Total de \${data.totalMatches} matchs analysés\`;
                })
                .catch(error => {
                    console.error("Erreur:", error);
                    container.innerHTML = '<h1>❌ Erreur de connexion au serveur</h1><p>Vérifiez la console du serveur.</p>';
                });
        });
    </script>
</body>
</html>
    `;
    res.send(htmlContent);
});

app.listen(PORT, () => {
    console.log(`\nServeur démarré !`);
    console.log(`Ouvrez votre navigateur et allez sur http://localhost:${PORT}`);
    console.log(`L'analyse commencera au premier chargement de la page.`);
});