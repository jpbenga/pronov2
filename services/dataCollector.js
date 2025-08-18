const apiClient = require('./apiClient');
const { loadSportConfig } = require('../config.js');

const sport = 'football';

async function fetchFixturesForDateRange(from, to, status = null) {
    const { leagues } = loadSportConfig(sport);
    let allFixtures = [];
    
    console.log(`INFO: [DataCollector] Demande de matchs pour ${leagues.length} ligues...`);

    const requests = leagues.map(league => {
        const params = { league: league.id, season: new Date(from).getFullYear(), from, to };
        if (status) params.status = status;
        return apiClient.request(sport, '/fixtures', params);
    });

    const responses = await Promise.all(requests);

    for (const response of responses) {
        if (response.data.response && response.data.response.length > 0) {
            allFixtures.push(...response.data.response);
        }
    }
    // On retourne maintenant la donnée brute, sans la transformer
    return allFixtures;
}

async function getFutureMatchData() {
    console.log("INFO: [DataCollector] Collecte des matchs futurs...");
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);
    
    return await fetchFixturesForDateRange(today.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);
}

async function getPastMatchData() {
    console.log("INFO: [DataCollector] Collecte des résultats passés...");
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    
    return await fetchFixturesForDateRange(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], 'FT');
}

module.exports = { getFutureMatchData, getPastMatchData };