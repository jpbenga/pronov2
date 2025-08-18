// strategies/football/ticket_strategies/lingot.js
function build(eligiblePicks, params) {
    const { maxMatches, singleMatchMinOdd, singleMatchMaxOdd, maxTickets, maxTotalOdd = 2.3 } = params;
    const tickets = [];

    const singlePicks = eligiblePicks.filter(p => p.odds >= singleMatchMinOdd && p.odds <= singleMatchMaxOdd);
    singlePicks.forEach(pick => tickets.push({ picks: [pick] }));

    const comboPicks = eligiblePicks.filter(p => p.odds >= params.minOddPerPick);
    if (comboPicks.length >= maxMatches) {
        for (let i = 0; i < comboPicks.length; i++) {
            for (let j = i + 1; j < comboPicks.length; j++) {
                const combo = [comboPicks[i], comboPicks[j]];
                const totalOdds = combo.reduce((acc, p) => acc * p.odds, 1);
                // --- CORRECTION : On borne la cote totale ---
                if (totalOdds <= maxTotalOdd) {
                    tickets.push({ picks: combo });
                }
            }
        }
    }
    return tickets
        .sort((a,b) => b.picks.reduce((acc, p) => acc * p.odds, 1) - a.picks.reduce((acc, p) => acc * p.odds, 1))
        .slice(0, maxTickets);
}
module.exports = { build };