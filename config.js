const fs = require('fs');
const path = require('path');

function loadSportConfig(sport) {
    const configPath = path.join(__dirname, 'config', sport);
    if (!fs.existsSync(configPath)) {
        throw new Error(`La configuration pour le sport "${sport}" est introuvable.`);
    }

    const leagues = JSON.parse(fs.readFileSync(path.join(configPath, 'leagues.json'), 'utf8'));
    const settings = JSON.parse(fs.readFileSync(path.join(configPath, 'settings.json'), 'utf8'));
    const tickets = JSON.parse(fs.readFileSync(path.join(configPath, 'tickets.json'), 'utf8'));

    // On combine "settings" et "tickets" pour plus de simplicité
    settings.tickets = tickets;

    return { leagues, settings };
}

// Configuration générale de l'application (non spécifique à un sport)
const APP_CONFIG = {
    DAYS_TO_ANALYZE: 7,
    DAYS_TO_PREDICT: 7,
};

module.exports = {
    loadSportConfig,
    APP_CONFIG
};