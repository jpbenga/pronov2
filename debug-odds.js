const axios = require('axios');
const chalk = require('chalk');

// --- CONFIGURATION ---
const API_KEY = '7f7700a471beeeb52aecde406a3870ba'; // Remplacez par votre clé API
const API_HOST = 'v3.football.api-sports.io';
const BUNDESLIGA_ID = 78; // ID pour la Bundesliga
const SEASON = new Date().getFullYear();

const api = axios.create({
    baseURL: `https://${API_HOST}`,
    headers: { 'x-apisports-key': API_KEY }
});

async function runDebug() {
    console.log(chalk.blue.bold("--- Script de débogage des cotes (Filtre : Unibet) ---"));

    // --- 1. Trouver le prochain match de Bundesliga ---
    let nextFixture;
    try {
        console.log(`\n1. Recherche du prochain match de Bundesliga (ID: ${BUNDESLIGA_ID})...`);
        const fixtureResponse = await api.get('/fixtures', {
            params: {
                league: BUNDESLIGA_ID,
                season: SEASON,
                next: 1
            }
        });

        if (!fixtureResponse.data.response || fixtureResponse.data.response.length === 0) {
            console.log(chalk.red("Aucun match à venir trouvé pour la Bundesliga."));
            return;
        }
        nextFixture = fixtureResponse.data.response[0];
        console.log(chalk.green(`   -> Match trouvé : ${nextFixture.teams.home.name} vs ${nextFixture.teams.away.name}`));
        console.log(chalk.green(`   -> ID du match : ${nextFixture.fixture.id}`));

    } catch (error) {
        console.error(chalk.red("Erreur lors de la recherche du match :"), error.message);
        return;
    }

    // --- 2. Récupérer les cotes pour ce match ---
    try {
        console.log(`\n2. Récupération des cotes pour le match ID ${nextFixture.fixture.id}...`);
        const oddsResponse = await api.get('/odds', {
            params: {
                fixture: nextFixture.fixture.id
            }
        });

        if (!oddsResponse.data.response || oddsResponse.data.response.length === 0) {
            console.log(chalk.yellow("L'API n'a retourné aucune cote pour ce match."));
            return;
        }

        const oddsData = oddsResponse.data.response[0];

        // --- 3. Afficher les données brutes (MODIFIÉ POUR FILTRER SUR UNIBET) ---
        console.log(chalk.cyan.bold("\n--- DONNÉES DE COTES BRUTES POUR UNIBET ---"));
        
        // On cherche spécifiquement Unibet dans la liste
        const unibetData = oddsData.bookmakers.find(bookmaker => bookmaker.name === 'Unibet');

        if (!unibetData) {
            console.log(chalk.yellow.bold("\nUnibet n'a pas été trouvé dans la liste des bookmakers pour ce match."));
            return;
        }

        console.log(chalk.yellow.bold(`\n\n================ BOOKMAKER: ${unibetData.name} ================`));
            
        unibetData.bets.forEach(bet => {
            console.log(chalk.white(`\n  ------------------------------------------------`));
            console.log(chalk.green.bold(`  | ID du Pari: ${bet.id} | Nom du Pari: ${bet.name}`));
            console.log(`  ------------------------------------------------`);

            bet.values.forEach(val => {
                console.log(`      - Valeur: "${val.value}", Cote: ${val.odd}`);
            });
        });

    } catch (error) {
        console.error(chalk.red("Erreur lors de la récupération des cotes :"), error.message);
    }
}

runDebug();