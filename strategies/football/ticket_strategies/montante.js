function build(eligiblePicks, params) {
    const { maxTickets = 10, ticketSize = 2 } = params;
    const tickets = [];

    const candidates = [...eligiblePicks].sort((a, b) => b.score - a.score);

    if (candidates.length < ticketSize) {
        return [];
    }

    for (let i = 0; i <= candidates.length - ticketSize; i += ticketSize) {
        const ticketPicks = candidates.slice(i, i + ticketSize);
        
        // On vérifie que les matchs dans le ticket sont uniques
        const matchIds = new Set(ticketPicks.map(p => p.match.id));
        if (matchIds.size === ticketSize) {
            tickets.push({ picks: ticketPicks });
        }
        
        if (tickets.length >= maxTickets) {
            break;
        }
    }

    return tickets;
}

module.exports = { build };