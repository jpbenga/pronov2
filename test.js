const express = require('express');
const axios = require('axios');
const chalk = require('chalk');

// --- CONFIGURATION ---
const PORT = 3000;
const API_KEY = '7f7700a471beeeb52aecde406a3870ba'; // Votre clé API
const API_HOST = 'v1.rugby.api-sports.io';

// --- DÉTAILS DU MATCH CIBLÉ ---
const MATCH_ID = 49037;
const HOME_TEAM_ID = 233;
const AWAY_TEAM_ID = 228;
const LEAGUE_ID = 80;
const SEASON = 2025;

const app = express();
const api = axios.create({
    baseURL: `https://${API_HOST}`,
    headers: { 'x-apisports-key': API_KEY },
});

let matchData = null;
let status = 'loading'; // 'loading', 'ready', 'error'
let errorMessage = '';

// --- FONCTION POUR RÉCUPÉRER TOUTES LES DONNÉES ---
async function fetchAllMatchData() {
    console.log(chalk.blue('Étape 1/3 : Récupération des informations de base du match (Stats, H2H)...'));
    try {
        // --- ÉTAPE 1: Récupérer les données de base (fixture, stats, h2h) ---
        const [fixtureRes, homeStatsRes, awayStatsRes, h2hRes] = await Promise.all([
            api.get('/games', { params: { id: MATCH_ID } }),
            api.get('/teams/statistics', { params: { league: LEAGUE_ID, team: HOME_TEAM_ID, season: SEASON } }),
            api.get('/teams/statistics', { params: { league: LEAGUE_ID, team: AWAY_TEAM_ID, season: SEASON } }),
            api.get('/games/h2h', { params: { h2h: `${HOME_TEAM_ID}-${AWAY_TEAM_ID}` } })
        ]);

        matchData = {
            fixture: fixtureRes.data.response[0] || 'Non trouvé',
            homeStats: homeStatsRes.data.response || 'Non trouvé',
            awayStats: awayStatsRes.data.response || 'Non trouvé',
            h2h: h2hRes.data.response || 'Non trouvé',
            allOdds: [] // On initialise un tableau pour stocker les cotes
        };
        console.log(chalk.green('Informations de base récupérées.'));

        // --- ÉTAPE 2: Récupérer la liste de tous les bookmakers ---
        console.log(chalk.blue('Étape 2/3 : Récupération de la liste de tous les bookmakers...'));
        const bookmakersRes = await api.get('/bookmakers');
        const bookmakers = bookmakersRes.data.response;
        console.log(chalk.green(`${bookmakers.length} bookmakers trouvés.`));

        // --- ÉTAPE 3: Interroger chaque bookmaker pour les cotes de ce match ---
        console.log(chalk.blue('Étape 3/3 : Recherche des cotes chez chaque bookmaker (cela peut prendre un moment)...'));
        
        const oddsPromises = bookmakers.map(bookmaker => 
            api.get('/odds', { params: { game: MATCH_ID, bookmaker: bookmaker.id } })
        );

        // Promise.allSettled permet de continuer même si certaines requêtes échouent
        const oddsResults = await Promise.allSettled(oddsPromises);

        const successfulOdds = oddsResults
            .filter(result => result.status === 'fulfilled' && result.value.data.response.length > 0)
            .map(result => result.value.data.response[0]);

        matchData.allOdds = successfulOdds;
        
        status = 'ready';
        console.log(chalk.green.bold(`\nAnalyse terminée. ${successfulOdds.length} bookmakers avec des cotes trouvées pour ce match.`));

    } catch (error) {
        status = 'error';
        errorMessage = error.message;
        console.error(chalk.red('Erreur lors de la récupération des données:', error.message));
    }
}

// --- FONCTION POUR GÉNÉRER L'AFFICHAGE HTML ---
function renderHtml() {
    let bodyContent = '';

    if (status === 'loading') {
        bodyContent = '<h1>Chargement des données...</h1><p>Le script interroge tous les bookmakers, cela peut prendre jusqu\'à une minute.</p>';
    } else if (status === 'error') {
        bodyContent = `<h1>Erreur</h1><p>${errorMessage}</p>`;
    } else {
        const { fixture, homeStats, awayStats, h2h, allOdds } = matchData;
        
        let allOddsHtml = `<div class="card"><h2>Aucun bookmaker avec des cotes n'a été trouvé pour ce match.</h2></div>`;

        if (allOdds && allOdds.length > 0) {
            allOddsHtml = allOdds.map(oddsData => {
                const bookmaker = oddsData.bookmaker;
                const bets = oddsData.bets;
                
                const oddsTable = bets.map(bet => {
                    const values = bet.values;
                    return `
                        <tr>
                            <td>${bet.name}</td>
                            <td>${values[0] ? `${values[0].value} (Cote: ${values[0].odd})` : 'N/A'}</td>
                            <td>${values[1] ? `${values[1].value} (Cote: ${values[1].odd})` : 'N/A'}</td>
                            <td>${values[2] ? `${values[2].value} (Cote: ${values[2].odd})` : 'N/A'}</td>
                        </tr>
                    `;
                }).join('');

                return `
                    <div class="card">
                        <h2>Cotes de ${bookmaker.name} (ID: ${bookmaker.id})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Marché (Market)</th>
                                    <th>Option 1 (ex: Domicile / Over)</th>
                                    <th>Option 2 (ex: Extérieur / Under)</th>
                                    <th>Option 3 (ex: Nul)</th>
                                </tr>
                            </thead>
                            <tbody>${oddsTable}</tbody>
                        </table>
                    </div>
                `;
            }).join('');
        }

        bodyContent = `
            <h1>Analyse Complète du Match</h1>
            <div class="card">
                <h2>${fixture.teams.home.name} vs ${fixture.teams.away.name}</h2>
                <p><strong>Score Final :</strong> ${fixture.scores.home} - ${fixture.scores.away}</p>
                <p><strong>Compétition :</strong> ${fixture.league.name} (${fixture.league.season})</p>
                <p><strong>Date :</strong> ${new Date(fixture.date).toLocaleString()}</p>
            </div>

            ${allOddsHtml}

            <div class="container">
                <div class="card">
                    <h2>Statistiques : ${homeStats.team.name}</h2>
                    <pre>${JSON.stringify(homeStats, null, 2)}</pre>
                </div>
                <div class="card">
                    <h2>Statistiques : ${awayStats.team.name}</h2>
                    <pre>${JSON.stringify(awayStats, null, 2)}</pre>
                </div>
            </div>
             <div class="card">
                <h2>Historique des Confrontations (H2H)</h2>
                <pre>${JSON.stringify(h2h, null, 2)}</pre>
            </div>
            <div class="card">
                <h2>Détails Bruts du Match (Fixture)</h2>
                <pre>${JSON.stringify(fixture, null, 2)}</pre>
            </div>
        `;
    }

    return `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <title>Détails du Match - Tous les Bookmakers</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 20px; }
                h1, h2 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
                .card { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
                .container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                pre { background-color: #2a2a2a; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word; font-size: 0.9em; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #373737; }
                th { background-color: #2a2a2a; }
                tbody tr:hover { background-color: #373737; }
            </style>
        </head>
        <body>${bodyContent}</body>
        </html>
    `;
}

// --- DÉMARRAGE DU SERVEUR ---
app.get('/', (req, res) => {
    res.send(renderHtml());
});

app.listen(PORT, () => {
    console.log(chalk.inverse(`\n🚀 Serveur web démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    fetchAllMatchData();
});