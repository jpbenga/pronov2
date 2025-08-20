// strategies/football/ticket_strategies/distribution.js

function build(eligiblePicks, params) {
    const { numTickets = 5, maxSize = 20 } = params;

    // Trier par score de confiance pour commencer avec les meilleurs pronostics
    const sortedPicks = [...eligiblePicks].sort((a, b) => b.score - a.score);
    
    // Initialiser les tickets vides
    const tickets = Array.from({ length: numTickets }, () => ({ picks: [] }));

    // Distribuer les pronostics un par un dans les tickets
    sortedPicks.forEach(pick => {
        for (let i = 0; i < tickets.length; i++) {
            // On utilise l'ID du match pour diversifier la distribution
            const ticketIndex = (pick.match.id + i) % numTickets;
            const currentTicket = tickets[ticketIndex];

            // Conditions pour ajouter le prono au ticket
            const notFull = currentTicket.picks.length < maxSize;
            const notDuplicate = !currentTicket.picks.some(p => p.match.id === pick.match.id);

            if (notFull && notDuplicate) {
                currentTicket.picks.push(pick);
                break; // Passer au prono suivant une fois qu'il est placé
            }
        }
    });

    // Retourner uniquement les tickets qui ont plus d'un match
    return tickets.filter(t => t.picks.length > 1);
}

module.exports = { build };