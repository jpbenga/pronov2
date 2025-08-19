// testOdds.js (Corrigé pour tout afficher)

const apiClient = require('./services/apiClient');

const TEST_DATE = '2025-08-17';
const K_LEAGUE_ID = 292;
const SEASON = 2025;
const BOOKMAKERS_TO_CHECK = [
    { id: 16, name: 'Unibet' },
    // { id: ID_POUR_BETCLIC, name: 'Betclic' }
];

async function runOddsTest() {
    console.log(`--- Lancement du test de récupération de cotes ---`);
    console.log(`Date: ${TEST_DATE}, Championnat: K League 1 (ID: ${K_LEAGUE_ID})`);

    console.log('\n[Étape 1] Recherche des matchs...');
    const fixturesResponse = await apiClient.request('football', '/fixtures', { league: K_LEAGUE_ID, season: SEASON, date: TEST_DATE });
    const fixtures = fixturesResponse?.data?.response || [];

    if (fixtures.length === 0) {
        console.log("-> AUCUN MATCH TROUVÉ pour cette date et ce championnat.");
        return;
    }
    console.log(`-> ${fixtures.length} match(s) trouvé(s).`);
    console.log('\n[Étape 2] Récupération et analyse des cotes...');

    for (const fixture of fixtures) {
        console.log(`\n======================================================`);
        console.log(`Match: ${fixture.teams.home.name} vs ${fixture.teams.away.name} (ID: ${fixture.fixture.id})`);
        console.log(`======================================================`);

        const oddsResponse = await apiClient.request('football', '/odds', { fixture: fixture.fixture.id });
        const oddsData = oddsResponse?.data?.response[0];

        if (!oddsData || !oddsData.bookmakers || oddsData.bookmakers.length === 0) {
            console.log("  -> AUCUNE COTE disponible pour ce match via l'API.");
            continue;
        }

        for (const bookmaker of BOOKMAKERS_TO_CHECK) {
            console.log(`\n  --- Bookmaker: ${bookmaker.name} (ID: ${bookmaker.id}) ---`);
            const bookmakerData = oddsData.bookmakers.find(b => b.id === bookmaker.id);

            if (bookmakerData) {
                const availableMarkets = bookmakerData.bets;
                console.log(`  -> TROUVÉ ! ${availableMarkets.length} marchés disponibles.`);
                
                availableMarkets.forEach(market => {
                    console.log(`    - Marché: "${market.name}" (ID: ${market.id})`);
                    const values = market.values.map(v => `${v.value} (${v.odd})`).join(' | ');
                    console.log(`      Valeurs: ${values}`);
                });

            } else {
                console.log("  -> NON TROUVÉ. Aucune cote de ce bookmaker pour ce match.");
            }
        }
    }
}

runOddsTest();