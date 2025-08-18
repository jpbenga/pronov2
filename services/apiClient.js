const axios = require('axios');
const Bottleneck = require('bottleneck');
const { loadSportConfig } = require('../config.js');

// Un cache pour nos limiteurs, pour ne pas en créer un pour chaque appel.
const limiters = new Map();

// La clé API doit être externalisée. Pour l'instant, nous la mettons ici.
// Idéalement, ce serait dans un fichier .env ou secrets.js
const { API_KEY } = require('../secrets');

function getLimiter(sport) {
    if (limiters.has(sport)) {
        return limiters.get(sport);
    }

    // Charger la configuration du rate limiter pour le sport demandé
    const sportConfig = loadSportConfig(sport);
    const { requests, per } = sportConfig.settings.rateLimiter;
    const reservoir = requests; // Nombre de requêtes autorisées dans la période
    const reservoirRefreshInterval = per === 'minute' ? 60 * 1000 : 1000; // en ms
    const reservoirRefreshAmount = requests;

    console.log(`INFO: [ApiClient] Création d'un limiteur pour "${sport}" : ${requests} req/${per}`);

    const newLimiter = new Bottleneck({
        reservoir,
        reservoirRefreshInterval,
        reservoirRefreshAmount,
        maxConcurrent: 5, // On peut faire 5 requêtes en parallèle au maximum
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

    console.log(`API Call Queued for ${sport}: ${endpoint} with params ${JSON.stringify(params)}`);

    // On "enveloppe" notre appel API dans le limiteur.
    // Bottleneck s'occupera de la file d'attente et du timing pour nous.
    return limiter.schedule(() => api.get(endpoint, { params }));
}

module.exports = { request };