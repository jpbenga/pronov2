const roundManager = require('./services/roundManager');
const apiClient = require('./services/apiClient');
const { loadSportConfig } = require('./config.js');

function logMatchesSummary(title, data) {
    console.log(`\n\n--- ${title.toUpperCase()} ---`);
    
    let fixtures = [];
    if (data.length > 0 && data[0]?.fixtures) {
        fixtures = data.flatMap(round => round.fixtures);
    } else {
        fixtures = data;
    }
    
    if (fixtures.length === 0) {
        console.log("Aucun match trouvé par cette méthode.");
        console.log(`--- FIN DU RÉSUMÉ ---`);
        return;
    }

    const matchesByLeague = {};
    fixtures.forEach(fixture => {
        const leagueName = fixture.league.name;
        if (!matchesByLeague[leagueName]) {
            matchesByLeague[leagueName] = [];
        }
        const matchDate = new Date(fixture.fixture.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        matchesByLeague[leagueName].push(`(${matchDate}) ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
    });

    Object.keys(matchesByLeague).sort().forEach(leagueName => {
        console.log(`\n- ${leagueName} (${matchesByLeague[leagueName].length} match(s))`);
        matchesByLeague[leagueName].forEach(matchName => console.log(`  - ${matchName}`));
    });

    console.log(`\nTOTAL MATCHS TROUVÉS : ${fixtures.length}`);
    console.log(`--- FIN DU RÉSUMÉ ---`);
}

async function getFutureMatchDataForTest() {
    const { leagues } = loadSportConfig('football');
    const season = new Date().getFullYear();
    let allFixtures = [];
    const from = new Date();
    const to = new Date();
    to.setDate(from.getDate() + 6);
    const fromString = from.toISOString().split('T')[0];
    const toString = to.toISOString().split('T')[0];

    for (const league of leagues) {
        try {
            const response = await apiClient.request('football', '/fixtures', { league: league.id, season, from: fromString, to: toString });
            if (response.data.response.length > 0) {
                allFixtures.push(...response.data.response);
            }
        } catch (error) {
            // Ignorer silencieusement les erreurs
        }
    }
    return allFixtures;
}

async function runUnifiedTest() {
    console.log("Lancement du test unifié de collecte de données...");

    const roundsToAnalyze = await roundManager.getNewRoundsToAnalyze();
    logMatchesSummary("Matchs récupérés par le ROUND MANAGER (pour le backtest)", roundsToAnalyze);

    const futureFixtures = await getFutureMatchDataForTest();
    logMatchesSummary("Matchs récupérés par DATE GLISSANTE (pour les prédictions)", futureFixtures);
}

runUnifiedTest();