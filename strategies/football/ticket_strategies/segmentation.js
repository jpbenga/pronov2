// strategies/football/ticket_strategies/segmentation.js

function build(eligiblePicks, params) {
    const { sourceTier, ticketSize } = params;

    // 1. Trier les pronostics par score décroissant
    const sortedPicks = [...eligiblePicks].sort((a, b) => b.score - a.score);

    // 2. Définir les "tiers" (segments) de pronostics
    const tier1End = Math.floor(sortedPicks.length * 0.2); // 20% les plus sûrs = lingots
    const tier2End = tier1End + Math.floor(sortedPicks.length * 0.5); // 50% suivants = pièces
    
    let picksForThisTier;
    if (sourceTier === 'lingots') {
        picksForThisTier = sortedPicks.slice(0, tier1End);
    } else if (sourceTier === 'pieces') {
        picksForThisTier = sortedPicks.slice(tier1End, tier2End);
    } else { // pépites
        picksForThisTier = sortedPicks.slice(tier2End);
    }

    // 3. Construire les tickets
    const tickets = [];
    let availablePicks = [...picksForThisTier];
    while(availablePicks.length >= ticketSize) {
        const ticketPicks = [];
        const usedMatchIds = new Set();
        const remainingPicksForNextLoop = [];

        // Itérer pour créer un ticket sans doublon de match
        for(const pick of availablePicks) {
            if(ticketPicks.length < ticketSize && !usedMatchIds.has(pick.match.id)) {
                ticketPicks.push(pick);
                usedMatchIds.add(pick.match.id);
            } else {
                remainingPicksForNextLoop.push(pick);
            }
        }
        if(ticketPicks.length === ticketSize) {
            tickets.push({ picks: ticketPicks });
        }
        availablePicks = remainingPicksForNextLoop;
    }
    
    return tickets;
}

module.exports = { build };