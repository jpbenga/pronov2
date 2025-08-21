const axios = require('axios');

// --- CONFIGURATION ---
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v3.football.api-sports.io';
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

const api = axios.create({
    baseURL: `https://${API_HOST}`,
    headers: { 'x-apisports-key': API_KEY },
    timeout: 20000
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCurrentRounds() {
    console.log(`--- Démarrage de la récupération avec logique de relance (max 5 tentatives) ---`);
    let leagueCounter = 0;
    const season = new Date().getFullYear();
    const successfulLeaguesData = [];
    const failedLeaguesNames = [];

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
                    throw new Error(`Aucune journée "en cours" trouvée pour la saison ${season}.`);
                }
                
                const currentRound = roundsResponse.data.response[0];
                const fixturesResponse = await api.get('/fixtures', {
                    params: { league: league.id, season: season, round: currentRound }
                });

                console.log(`   ✅ SUCCÈS (tentative ${attempts}) : Journée "${currentRound}" trouvée.`);
                
                if (fixturesResponse.data?.response?.length > 0) {
                     const fixturesData = fixturesResponse.data.response;
                     const matchesForTable = fixturesData.map(fixture => ({
                        'Date et Heure (UTC)': new Date(fixture.fixture.date).toLocaleString('fr-FR', { timeZone: 'UTC' }),
                        'Équipe Domicile': fixture.teams.home.name, 'VS': 'vs', 'Équipe Extérieur': fixture.teams.away.name
                    }));
                    console.table(matchesForTable);
                } else {
                    console.log(`   -> La journée "${currentRound}" ne contient aucune rencontre pour le moment.`);
                }

                successfulLeaguesData.push({ name: league.name, round: currentRound });
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
    }

    console.log('\n\n\n--- ANALYSE TERMINÉE : BILAN FINAL DÉTAILLÉ ---');
    console.log('===================================================');
    console.log(`Total des championnats analysés : ${LEAGUES_TO_ANALYZE.length}`);
    console.log(`✅ Succès : ${successfulLeaguesData.length}`);
    console.log(`❌ Échecs : ${failedLeaguesNames.length}`);
    console.log('===================================================\n');

    if (successfulLeaguesData.length > 0) {
        console.log("--- ✅ Liste des championnats récupérés avec succès ---");
        successfulLeaguesData.forEach(league => console.log(`  - ${league.name} (Journée en cours: ${league.round})`));
        console.log("\n");
    }

    if (failedLeaguesNames.length > 0) {
        console.log("--- ❌ Liste des championnats en échec ---");
        failedLeaguesNames.forEach(name => console.log(`  - ${name}`));
        console.log("\n");
    }
}

fetchCurrentRounds();