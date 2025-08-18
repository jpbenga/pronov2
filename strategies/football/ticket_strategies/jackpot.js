// strategies/football/ticket_strategies/jackpot.js
const { shuffleArray } = require('../../../utils.js');

function build(eligiblePicks, params) {
    const { maxTickets, minTotalOdd = 30 } = params;
    const tickets = [];
    
    const candidates = [...eligiblePicks].sort((a, b) => (b.odds || 0) - (a.odds || 0));
    
    let attemptSize = 5;
    while (tickets.length < maxTickets && attemptSize <= 10) {
        if (candidates.length < attemptSize) break;
        const shuffled = shuffleArray([...candidates]);
        const newTicket = { picks: shuffled.slice(0, attemptSize) };
        const totalOdds = newTicket.picks.reduce((acc, p) => acc * p.odds, 1);

        // --- CORRECTION : On ne garde que les tickets avec une cote suffisante ---
        if (totalOdds >= minTotalOdd) {
             tickets.push(newTicket);
        }
        attemptSize++;
    }
    return tickets;
}
module.exports = { build };