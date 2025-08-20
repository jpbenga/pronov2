// strategies/football/ticket_strategies/comboBuilder.js
const { shuffleArray } = require('../../../utils');

function build(eligiblePicks, params) {
    const { minMatches, maxMatches, maxTickets } = params;
    const tickets = [];
    
    // On ne garde que les 60 meilleurs pronostics pour cette stratégie pour garantir la performance.
    const candidates = [...eligiblePicks].sort((a, b) => b.score - a.score).slice(0, 60);

    if (candidates.length < minMatches) return [];

    let attempts = 0;
    while (tickets.length < maxTickets && attempts < maxTickets * 5) {
        // On mélange les candidats pour créer des tickets variés
        const shuffled = shuffleArray([...candidates]);
        
        // On choisit une taille de ticket aléatoire dans la fourchette définie
        const ticketSize = Math.floor(Math.random() * (maxMatches - minMatches + 1)) + minMatches;
        
        if (shuffled.length >= ticketSize) {
            const newTicketPicks = shuffled.slice(0, ticketSize);
            
            // On vérifie que le ticket n'existe pas déjà pour éviter les doublons
            const ticketExists = tickets.some(t => {
                const existingIds = t.picks.map(p => p.match.id).sort().join(',');
                const newIds = newTicketPicks.map(p => p.match.id).sort().join(',');
                return existingIds === newIds;
            });

            if (!ticketExists) {
                tickets.push({ picks: newTicketPicks });
            }
        }
        attempts++;
    }
    
    return tickets;
}
module.exports = { build };