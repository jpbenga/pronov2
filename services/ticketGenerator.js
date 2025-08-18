const path = require('path');
const { loadSportConfig } = require('../config.js');

function generateTickets(sport, allPicks, context = 'predictions') {
    console.log(`INFO: [TicketGenerator] Démarrage de la génération de tickets pour "${sport}"...`);
    
    const { settings } = loadSportConfig(sport);
    const { tickets: ticketProfiles } = settings;
    const profilesToRun = ticketProfiles[context].filter(p => p.enabled);
    const finalTickets = {};

    // --- CORRECTION DÉFINITIVE DU FILTRE GLOBAL ---
    // On utilise la bonne clé: "confidenceThreshold" et non "globalConfidenceThreshold"
    const confidenceThreshold = settings.analysisParams.confidenceThreshold;
    
    // On applique le seuil comme toute première étape.
    const confidentPicks = allPicks.filter(p => p.score >= confidenceThreshold);
    
    console.log(`INFO: ${allPicks.length} pronostics bruts, ${confidentPicks.length} retenus après filtre de confiance global (${confidenceThreshold}%)`);
    // --- FIN DE LA CORRECTION ---

    for (const profile of profilesToRun) {
        try {
            const strategyPath = path.join(__dirname, '..', 'strategies', sport, 'ticket_strategies', `${profile.strategy}.js`);
            const ticketStrategy = require(strategyPath);
            
            const generated = ticketStrategy.build(confidentPicks, profile.params);
            
            finalTickets[profile.profileName] = generated;
            console.log(`- Profil "${profile.profileName}" a généré ${generated.length} ticket(s).`);

        } catch (error) {
            console.error(`ERREUR: Impossible de générer les tickets pour le profil "${profile.profileName}".`, error);
            finalTickets[profile.profileName] = [];
        }
    }
    return finalTickets;
}

module.exports = { generateTickets };