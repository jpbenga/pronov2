const axios = require('axios');

function getApiClient(apiKey, apiHost) {
    return axios.create({
        baseURL: `https://${apiHost}`,
        headers: { 'x-apisports-key': apiKey },
        timeout: 20000
    });
}

async function fetchFixturesForDateRange(api, leagues, from, to, status = null) {
    let allFixtures = [];
    const season = new Date(from).getFullYear();
    for (const league of leagues) {
        try {
            const params = { league: league.id, season: season, from, to };
            if (status) params.status = status;
            const response = await api.get('/fixtures', { params });
            if (response.data.response && response.data.response.length > 0) {
                allFixtures.push(...response.data.response);
            }
        } catch (error) {
            console.error(`Erreur pour la ligue ${league.name} (ID: ${league.id}):`, error.message);
        }
    }
    return allFixtures;
}

// NOUVELLE FONCTION UTILITAIRE PLUS SÛRE
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = {
    getApiClient,
    fetchFixturesForDateRange,
    shuffleArray, // On exporte la nouvelle fonction
};