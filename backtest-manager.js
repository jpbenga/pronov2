const axios = require('axios');

// --- CONFIGURATION ---
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
    { name: 'Veikkausliiga', id: 244 }, { name: 'Ligue 1', id: 61 },
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

const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBacktestDataCollector() {
    console.log("--- Démarrage du collecteur de données pour Backtesting (Journée N-1) ---");
    let leagueCounter = 0;
    const season = new Date().getFullYear();
    const successfulLeaguesData = [];
    const failedLeaguesNames = [];
    const allPreviousRoundMatches = [];

    for (const league of LEAGUES_TO_ANALYZE) {
        leagueCounter++;
        console.log(`\n================================================================`);
        console.log(`[${leagueCounter}/${LEAGUES_TO_ANALYZE.length}] Traitement de : ${league.name} (ID: ${league.id})`);

        let attempts = 0;
        const maxAttempts = 5;
        let isSuccess = false;

        while (attempts < maxAttempts && !isSuccess) {
            attempts++;
            if (attempts > 1) {
                console.log(`   -> Nouvelle tentative (${attempts}/${maxAttempts})...`);
            }
            try {
                const roundsResponse = await api.get('/fixtures/rounds', {
                    params: { league: league.id, season: season, current: 'true' }
                });

                if (!roundsResponse.data?.response?.length) {
                    throw new Error(`Aucune journée "en cours" trouvée.`);
                }
                
                const currentRoundName = roundsResponse.data.response[0];
                console.log(`  - Journée en cours identifiée : "${currentRoundName}"`);

                const roundParts = currentRoundName.match(/(\D+)(\d+)/);
                if (!roundParts || parseInt(roundParts[2], 10) <= 1) {
                    throw new Error(`Pas de journée précédente à analyser (en cours: ${currentRoundName}).`);
                }

                const prefix = roundParts[1].trim();
                const currentRoundNumber = parseInt(roundParts[2], 10);
                const previousRoundName = `${prefix} ${currentRoundNumber - 1}`;
                
                console.log(`  - Recherche des matchs pour la journée N-1 : "${previousRoundName}"`);
                const fixturesResponse = await api.get('/fixtures', {
                    params: { league: league.id, season: season, round: previousRoundName }
                });

                const finishedMatches = fixturesResponse.data.response.filter(f => f.fixture.status.short === 'FT');
                console.log(`  ✅ SUCCÈS (tentative ${attempts}) : ${finishedMatches.length} match(s) terminé(s) trouvé(s).`);
                
                finishedMatches.forEach(fixture => {
                    allPreviousRoundMatches.push({
                        'Championnat': league.name,
                        'Journée': previousRoundName,
                        'Domicile': fixture.teams.home.name,
                        'Score': `${fixture.goals.home} - ${fixture.goals.away}`,
                        'Extérieur': fixture.teams.away.name
                    });
                });

                successfulLeaguesData.push({ name: league.name, round: previousRoundName });
                isSuccess = true;

            } catch (error) {
                const reason = error.response ? `API Error ${error.response.status}` : error.message;
                console.warn(`   -> Échec (tentative ${attempts}/${maxAttempts}) : ${reason}`);

                if (attempts >= maxAttempts) {
                    console.error(`\n   ❌ ERREUR FINALE pour ${league.name} après ${maxAttempts} tentatives.`);
                    failedLeaguesNames.push(`${league.name} (Raison finale: ${reason})`);
                } else {
                    await sleep(1000);
                }
            }
        }
        
        // *** MODIFICATION ICI ***
        await sleep(500); // Pause d'une demi-seconde entre chaque championnat
    }

    console.log('\n\n\n--- BILAN FINAL DU COLLECTEUR DE DONNÉES ---');
    console.log('===================================================');
    console.log(`Total des championnats analysés : ${LEAGUES_TO_ANALYZE.length}`);
    console.log(`✅ Championnats avec une journée N-1 analysée : ${successfulLeaguesData.length}`);
    console.log(`❌ Championnats en échec ou sans journée N-1 : ${failedLeaguesNames.length}`);
    console.log(`📋 Total des matchs de journée N-1 collectés : ${allPreviousRoundMatches.length}`);
    console.log('===================================================\n');

    if (allPreviousRoundMatches.length > 0) {
        console.log("--- Liste des matchs collectés ---");
        console.table(allPreviousRoundMatches);
    }

    if (failedLeaguesNames.length > 0) {
        console.log("\n--- Liste des championnats en échec ---");
        failedLeaguesNames.forEach(name => console.log(`  - ${name}`));
    }
}

runBacktestDataCollector();