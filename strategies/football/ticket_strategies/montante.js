// strategies/football/ticket_strategies/montante.js

function build(eligiblePicks, params) {
    const { maxMatches, targetOdd, minOdd, maxOdd, maxTickets } = params;
    const potentialTickets = [];
    
    // On ne garde que les 40 pronos les plus sûrs et pertinents
    const candidates = [...eligiblePicks].sort((a, b) => b.score - a.score).slice(0, 40);
    if (candidates.length < 2) return [];

    // On explore les petites combinaisons (2 et 3 matchs) de manière contrôlée
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            // Combinaisons de 2
            const combo2 = [candidates[i], candidates[j]];
            const totalOdds2 = combo2.reduce((acc, p) => acc * p.odds, 1);
            if (totalOdds2 >= minOdd && totalOdds2 <= maxOdd) {
                potentialTickets.push({ picks: combo2, diff: Math.abs(totalOdds2 - targetOdd) });
            }

            // Combinaisons de 3 (si autorisé)
            if (maxMatches >= 3 && j + 1 < candidates.length) {
                for (let k = j + 1; k < candidates.length; k++) {
                     const combo3 = [candidates[i], candidates[j], candidates[k]];
                     const totalOdds3 = combo3.reduce((acc, p) => acc * p.odds, 1);
                     if (totalOdds3 >= minOdd && totalOdds3 <= maxOdd) {
                         potentialTickets.push({ picks: combo3, diff: Math.abs(totalOdds3 - targetOdd) });
                     }
                }
            }
        }
    }

    // On trie par la plus proche de la cote cible et on limite le nombre de tickets
    return potentialTickets
        .sort((a, b) => a.diff - b.diff)
        .slice(0, maxTickets);
}
module.exports = { build };