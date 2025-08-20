const apiClient = require('./apiClient');
const stateManager = require('../stateManager');
const { loadSportConfig } = require('../config');
const crypto = require('crypto');

const sport = 'football';
const season = new Date().getFullYear();

function generateRoundSignature(fixtures) {
    if (!fixtures || fixtures.length === 0) return null;
    const fixtureIds = fixtures.map(f => f.fixture.id).sort().join(',');
    return crypto.createHash('md5').update(fixtureIds).digest('hex');
}

async function getNewRoundsToAnalyze() {
    const state = stateManager.loadState();
    const { leagues } = loadSportConfig(sport);
    const roundsToProcess = [];

    if (!state.leagues) state.leagues = {};

    for (const league of leagues) {
        try {
            const leagueState = state.leagues[league.id] || { analyzedRounds: {} };
            const allRoundsResponse = await apiClient.request(sport, '/fixtures/rounds', { league: league.id, season });
            const allRounds = allRoundsResponse.data.response;
            if (!allRounds || allRounds.length === 0) continue;

            const lastAnalyzedRoundName = Object.keys(leagueState.analyzedRounds).pop();
            const nextRoundIndex = lastAnalyzedRoundName ? allRounds.indexOf(lastAnalyzedRoundName) + 1 : 0;

            for (let i = nextRoundIndex; i < allRounds.length; i++) {
                const roundName = allRounds[i];
                const fixtureResponse = await apiClient.request(sport, '/fixtures', { league: league.id, season, round: roundName });
                const fixtures = fixtureResponse.data.response;

                if (!fixtures || fixtures.length === 0) continue;

                const isRoundComplete = fixtures.every(f => f.fixture.status.short === 'FT');

                if (isRoundComplete) {
                    const signature = generateRoundSignature(fixtures);
                    if (!Object.values(leagueState.analyzedRounds).includes(signature)) {
                        roundsToProcess.push({
                            leagueId: league.id,
                            leagueName: league.name,
                            round: roundName,
                            fixtures: fixtures,
                            signature: signature
                        });
                    }
                } else {
                    break;
                }
            }
        } catch (error) {
            console.warn(`WARN: [RoundManager] Erreur lors de la vérification de la ligue ${league.name}: ${error.message}`);
        }
    }
    return roundsToProcess;
}

module.exports = { getNewRoundsToAnalyze };