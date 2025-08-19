const { shuffleArray } = require('../../../utils.js');

function build(eligiblePicks, params) {
    const { maxTickets = 2, minSize = 10, maxSize = 15 } = params;
    const tickets = [];

    if (eligiblePicks.length < minSize) {
        return [];
    }
    
    const candidates = [...eligiblePicks].sort((a, b) => b.score - a.score);

    for (let i = 0; i < maxTickets; i++) {
        const startIndex = i * maxSize;
        const ticketSize = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

        if (candidates.length >= startIndex + ticketSize) {
            const ticketPicks = candidates.slice(startIndex, startIndex + ticketSize);
            tickets.push({ picks: shuffleArray(ticketPicks) });
        } else {
            break;
        }
    }

    return tickets;
}

module.exports = { build };