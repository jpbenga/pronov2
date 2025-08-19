// testOddsRetention.js (Corrigé)

const apiClient = require('./services/apiClient');
const { loadSportConfig } = require('./config.js'); // CHEMIN CORRIGÉ

const { leagues } = loadSportConfig('football');
const UNIBET_ID = 16; 

async function findOneFixtureForDate(date) {
    for (const league of leagues) {
        try {
            const fixturesResponse = await apiClient.request('football', '/fixtures', {
                league: league.id,
                season: new Date(date).getFullYear(),
                date: date,
                status: 'FT'
            });
            const fixtures = fixturesResponse?.data?.response || [];
            if (fixtures.length > 0) {
                return fixtures[0];
            }
        } catch (e) { /* Ignorer les erreurs pour les ligues sans matchs */ }
    }
    return null;
}

async function runRetentionTest() {
    console.log('--- Lancement du test de rétention des cotes (Bookmaker: Unibet) ---');
    let consecutiveFailures = 0;
    
    for (let i = 1; i <= 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        
        console.log(`\n-------------------------------------------------`);
        console.log(`Recherche pour le J-${i} (${dateString})`);
        
        const fixture = await findOneFixtureForDate(dateString);

        if (!fixture) {
            console.log("  -> Aucun match terminé trouvé pour cette date dans vos ligues.");
            continue;
        }

        console.log(`  -> Match trouvé: ${fixture.teams.home.name} vs ${fixture.teams.away.name} (ID: ${fixture.fixture.id})`);

        const oddsResponse = await apiClient.request('football', '/odds', { fixture: fixture.fixture.id });
        const oddsData = oddsResponse?.data?.response[0];
        
        const unibetOdds = oddsData?.bookmakers.find(b => b.id === UNIBET_ID);

        if (unibetOdds && unibetOdds.bets.length > 0) {
            console.log(`  ✅ Cotes TROUVÉES (${unibetOdds.bets.length} marchés)`);
            consecutiveFailures = 0;
        } else {
            console.log(`  ❌ Cotes ABSENTES pour Unibet.`);
            consecutiveFailures++;
        }

        if (consecutiveFailures >= 3) {
            console.log('\n-------------------------------------------------');
            console.log(`Arrêt du test : 3 jours consécutifs sans cotes trouvées.`);
            console.log(`La durée de rétention des cotes semble être d'environ ${i - 3} jour(s).`);
            break;
        }
    }
    if (consecutiveFailures < 3) {
        console.log('\n-------------------------------------------------');
        console.log('Test terminé. Des cotes ont été trouvées sur la majorité de la période de 10 jours.');
    }
}

runRetentionTest();