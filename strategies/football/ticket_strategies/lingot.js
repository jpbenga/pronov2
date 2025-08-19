function build(eligiblePicks, params) {
    const { maxTickets = 10 } = params;
    const tickets = [];

    const candidates = [...eligiblePicks].sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
        return [];
    }

    // Étape 1 : Créer des tickets simples pour les 5 meilleurs pronostics
    const singlePicks = candidates.slice(0, 5);
    singlePicks.forEach(pick => {
        tickets.push({ picks: [pick] });
    });

    // Étape 2 : Créer des combinés de 2 avec le meilleur pronostic comme ancre
    const anchorPick = candidates[0];
    const otherPicks = candidates.slice(1, 10);

    otherPicks.forEach(otherPick => {
        // On s'assure de ne pas combiner deux pronostics du même match
        if (anchorPick.match.id !== otherPick.match.id) {
            tickets.push({ picks: [anchorPick, otherPick] });
        }
    });

    // On s'assure de ne pas dépasser le nombre max de tickets et on retourne
    return tickets.slice(0, maxTickets);
}

module.exports = { build };