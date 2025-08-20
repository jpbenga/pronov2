const apiClient = require('./apiClient');
const { loadSportConfig } = require('../config.js');

const sport = 'football';
const season = new Date().getFullYear();

async function getRoundsToAnalyze(state) {
    const { leagues } = loadSportConfig(sport);
    const roundsToProcess = [];

    for (const league of leagues) {
        try {
            const lastAnalyzedRound = state.leagues[league.id]?.lastAnalyzedRound;
            
            const allRoundsResponse = await apiClient.request(sport, '/fixtures/rounds', { league: league.id, season });
            const allRounds = allRoundsResponse.data.response;
            if (!allRounds || allRounds.length === 0) continue;

            const nextRoundIndex = lastAnalyzedRound ? allRounds.indexOf(lastAnalyzedRound) + 1 : 0;

            if (nextRoundIndex < allRounds.length) {
                const nextRound = allRounds[nextRoundIndex];
                const fixtureResponse = await apiClient.request(sport, '/fixtures', { league: league.id, season, round: nextRound });
                const fixtures = fixtureResponse.data.response;

                if (fixtures && fixtures.length > 0 && fixtures.every(f => f.fixture.status.short === 'FT')) {
                    roundsToProcess.push({
                        leagueId: league.id,
                        leagueName: league.name,
                        round: nextRound,
                        fixtures: fixtures
                    });
                }
            }
        } catch (error) {
            console.warn(`WARN: [DataCollector] Erreur lors de la recherche de la prochaine journée pour ${league.name}`);
        }
    }
    return roundsToProcess;
}

async function getFutureMatchData() {
    const { leagues } = loadSportConfig(sport);
    let allFixtures = [];

    const from = new Date();
    const to = new Date();
    to.setDate(from.getDate() + 6);
    const fromString = from.toISOString().split('T')[0];
    const toString = to.toISOString().split('T')[0];

    for (const league of leagues) {
        try {
            const response = await apiClient.request(sport, '/fixtures', { league: league.id, season, from: fromString, to: toString });
            if (response.data.response.length > 0) {
                allFixtures.push(...response.data.response);
            }
        } catch (error) {
            // Silently ignore errors for individual leagues
        }
    }
    return allFixtures;
}

module.exports = { getFutureMatchData, getRoundsToAnalyze };