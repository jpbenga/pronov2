const apiClient = require('./apiClient');
const { loadSportConfig } = require('../config.js');

const sport = 'football';

function getFootballSeason(dateObject) {
    const year = dateObject.getFullYear();
    const month = dateObject.getMonth();
    if (month < 6) {
        return year - 1;
    }
    return year;
}

async function fetchFixturesForDateRange(from, to, status = null) {
    const { leagues } = loadSportConfig(sport);
    let allFixtures = [];

    console.log(`INFO: [DataCollector] Demande de matchs pour ${leagues.length} ligues du ${from} au ${to}...`);

    const seasonFrom = getFootballSeason(new Date(from));
    const seasonTo = getFootballSeason(new Date(to));
    const seasonsToQuery = [...new Set([seasonFrom, seasonTo])]; 

    console.log(`INFO: [DataCollector] Saisons calculées pour cet intervalle : ${seasonsToQuery.join(', ')}`);

    for (const season of seasonsToQuery) {
        for (const league of leagues) {
            try {
                const params = { league: league.id, season, from, to };
                if (status) params.status = status;

                const response = await apiClient.request(sport, '/fixtures', params);

                if (response.data.response && response.data.response.length > 0) {
                    allFixtures.push(...response.data.response);
                }
            } catch (error) {
                console.error(`WARN: [DataCollector] Erreur pour la ligue ${league.name} (ID: ${league.id}) saison ${season}.`, error.message);
            }
        }
    }
    
    const uniqueFixtures = Array.from(new Map(allFixtures.map(fixture => [fixture.fixture.id, fixture])).values());

    console.log(`INFO: [DataCollector] ${uniqueFixtures.length} matchs trouvés au total.`);
    return uniqueFixtures;
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
    const endDate = new Date();
    endDate.setDate(today.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);

    return await fetchFixturesForDateRange(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], 'FT');
}

module.exports = { getFutureMatchData, getPastMatchData };