const path = require('path');
const { loadSportConfig } = require('../config.js');

function generateTickets(sport, allPicks, context = 'predictions') {
    console.log(`INFO: [TicketGenerator] Démarrage de la génération de tickets pour "${sport}"...`);
    
    const { settings } = loadSportConfig(sport);
    const { tickets: ticketProfiles } = settings;
    const profilesToRun = ticketProfiles[context].filter(p => p.enabled);
    
    const confidenceThreshold = settings.analysisParams.confidenceThreshold;
    const confidentPicks = allPicks.filter(p => p.score >= confidenceThreshold);
    
    console.log(`INFO: ${allPicks.length} pronostics bruts, ${confidentPicks.length} retenus après filtre de confiance global (${confidenceThreshold}%)`);

    const picksByDate = {};
    confidentPicks.forEach(pick => {
        const date = pick.match.date.split('T')[0];
        if (!picksByDate[date]) {
            picksByDate[date] = [];
        }
        picksByDate[date].push(pick);
    });

    const finalTickets = {};
    profilesToRun.forEach(p => {
        finalTickets[p.profileName] = [];
    });

    for (const date in picksByDate) {
        const dailyPicks = picksByDate[date];

        for (const profile of profilesToRun) {
            try {
                const strategyPath = path.join(__dirname, '..', 'strategies', sport, 'ticket_strategies', `${profile.strategy}.js`);
                const ticketStrategy = require(strategyPath);
                
                const dailyGeneratedTickets = ticketStrategy.build(dailyPicks, profile.params, context);
                
                if (dailyGeneratedTickets.length > 0) {
                    finalTickets[profile.profileName].push(...dailyGeneratedTickets);
                }

            } catch (error) {
                console.error(`ERREUR: Impossible de générer les tickets pour le profil "${profile.profileName}" pour la date ${date}.`, error);
            }
        }
    }

    for (const profileName in finalTickets) {
        console.log(`- Profil "${profileName}" a généré ${finalTickets[profileName].length} ticket(s).`);
    }

    return finalTickets;
}

module.exports = { generateTickets };