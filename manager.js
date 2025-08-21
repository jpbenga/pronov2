const axios = require('axios');

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
const MAX_ATTEMPTS = 5;

const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeApiCall(endpoint, params) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            const response = await api.get(endpoint, { params });
            if (response.data && typeof response.data.response !== 'undefined') {
                return response.data;
            }
            throw new Error("Réponse de l'API invalide ou vide.");
        } catch (error) {
            const reason = error.response ? `API Error ${error.response.status}` : error.message;
            if (attempts >= MAX_ATTEMPTS) {
                console.error(`   ❌ ÉCHEC DÉFINITIF pour ${endpoint} (${JSON.stringify(params)}) après ${attempts} tentatives. Raison: ${reason}`);
                return null;
            }
            await sleep(1500);
        }
    }
    return null;
}

async function findLastPlayedRound(leagueId, season) {
    const roundsData = await safeApiCall('/fixtures/rounds', { league: leagueId, season: season });
    if (!roundsData || roundsData.response.length === 0) {
        return null;
    }

    // On parcourt les journées en partant de la fin pour trouver la plus récente avec des matchs terminés
    const rounds = roundsData.response;
    for (let i = rounds.length - 1; i >= 0; i--) {
        const roundName = rounds[i];
        const fixturesData = await safeApiCall('/fixtures', { league: leagueId, season: season, round: roundName });
        const hasFinishedMatch = fixturesData?.response.some(f => f.fixture.status.short === 'FT');
        if (hasFinishedMatch) {
            return roundName; // On retourne le nom de la dernière journée jouée
        }
    }
    return null; // Aucune journée avec des matchs terminés n'a été trouvée
}

async function runStableManager() {
    const season = new Date().getFullYear();
    const allAnalyzedMatches = [];
    let activeLeaguesCount = 0;

    console.log("--- Démarrage du Manager Stable ---");
    console.log("--- PHASE 1: Recherche de la dernière journée jouée pour chaque championnat... ---");
    
    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(`\n[Ligue] Traitement de : ${league.name}`);
        const lastPlayedRound = await findLastPlayedRound(league.id, season);

        if (lastPlayedRound) {
            activeLeaguesCount++;
            console.log(`  ✅ Dernière journée jouée trouvée: "${lastPlayedRound}". Analyse des matchs...`);
            
            const fixturesData = await safeApiCall('/fixtures', { league: league.id, season: season, round: lastPlayedRound });

            if (fixturesData && fixturesData.response.length > 0) {
                console.log(`  -> ${fixturesData.response.length} match(s) trouvé(s) dans cette journée.`);
                for (const fixture of fixturesData.response) {
                    if (fixture.fixture.status.short !== 'FT') continue;

                    allAnalyzedMatches.push({
                        'Championnat': league.name,
                        'Journée': lastPlayedRound,
                        'Domicile': fixture.teams.home.name,
                        'Score': `${fixture.goals.home} - ${fixture.goals.away}`,
                        'Extérieur': fixture.teams.away.name
                    });
                }
            }
        } else {
            console.log(`  ⚪️ ${league.name}: Aucune journée avec des matchs terminés n'a été trouvée pour cette saison.`);
        }
    }

    console.log('\n\n--- BILAN FINAL DU MANAGER STABLE ---');
    console.log('========================================');
    console.log(` Championnats avec au moins une journée jouée : ${activeLeaguesCount}`);
    console.log(` Matchs analysés (dernières journées jouées) : ${allAnalyzedMatches.length}`);
    console.log('========================================\n');
    
    if (allAnalyzedMatches.length > 0) {
        console.table(allAnalyzedMatches);
    } else {
        console.log("Aucun match terminé n'a pu être analysé.");
    }
}

runStableManager();