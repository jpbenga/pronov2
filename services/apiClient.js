const axios = require('axios');
const Bottleneck = require('bottleneck');
const { loadSportConfig } = require('../config.js');
const { API_KEY } = require('../secrets');

const limiters = new Map();

function getLimiter(sport) {
    if (limiters.has(sport)) {
        return limiters.get(sport);
    }

    const sportConfig = loadSportConfig(sport);
    const { requests, per } = sportConfig.settings.rateLimiter;
    const reservoir = requests;
    const reservoirRefreshInterval = per === 'minute' ? 60 * 1000 : 1000;
    const reservoirRefreshAmount = requests;

    console.log(`INFO: [ApiClient] Création d'un limiteur pour "${sport}" : ${requests} req/${per}`);

    const newLimiter = new Bottleneck({
        reservoir,
        reservoirRefreshInterval,
        reservoirRefreshAmount,
        maxConcurrent: 5,
    });

    limiters.set(sport, newLimiter);
    return newLimiter;
}

async function request(sport, endpoint, params = {}) {
    const limiter = getLimiter(sport);
    const sportConfig = loadSportConfig(sport);
    
    const api = axios.create({
        baseURL: `https://${sportConfig.settings.apiHost}`,
        headers: { 'x-apisports-key': API_KEY },
        timeout: 20000
    });

    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1500;
    let lastError = null;

    console.log(`API Call Queued for ${sport}: ${endpoint} with params ${JSON.stringify(params)}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await limiter.schedule(() => api.get(endpoint, { params }));
            if (response && response.data) {
                return response;
            }
            throw new Error("Réponse de l'API vide ou invalide.");
        } catch (error) {
            lastError = error;
            console.warn(`WARN: Tentative ${attempt}/${MAX_RETRIES} échouée pour ${endpoint}. Erreur: ${error.message}`);
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }

    console.error(`ERROR: Échec final de l'appel API pour ${endpoint} après ${MAX_RETRIES} tentatives.`);
    throw lastError;
}

module.exports = { request };