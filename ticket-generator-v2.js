const fs = require('fs');

// --- CONFIGURATION ---
const MAX_TICKETS = 10;
const MIN_TICKET_ODDS = 1.75;
const MAX_TICKET_ODDS = 2.5;

// --- FONCTIONS HELPER ---

/**
 * Affiche les statistiques de performance d'un marché sous forme de tableau.
 * @param {string} marketName - Le nom du marché.
 * @param {object} marketStats - L'objet contenant les stats du marché.
 */
function printMarketStats(marketName, marketStats) {
    console.log(`Performance historique du marché "${marketName}":`);
    console.log("----------------------------------------------------------");
    console.log("Tranche  | Réussite | Total | Taux");
    console.log("----------------------------------------------------------");
    const tranches = ['0-59', '60-69', '70-79', '80-89', '90-100'];
    tranches.forEach(trancheName => {
        const stats = marketStats[trancheName];
        if (stats && stats.total > 0) {
            const rate = ((stats.success / stats.total) * 100).toFixed(2);
            const line = `${trancheName.padEnd(8)} | ${String(stats.success).padEnd(8)} | ${String(stats.total).padEnd(5)} | ${rate}%`;
            console.log(line);
        } else {
            const line = `${trancheName.padEnd(8)} | 0        | 0     | 0.00%
`;
            console.log(line);
        }
    });
    console.log("----------------------------------------------------------\n");
}

/**
 * Mélange un tableau en utilisant l'algorithme de Fisher-Yates.
 * @param {Array} array - Le tableau à mélanger.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- SCRIPT PRINCIPAL ---

// 1. Charger les prédictions sélectionnées
let predictions;
try {
    const data = fs.readFileSync('predictions_selectionnees.json', 'utf-8');
    predictions = JSON.parse(data);
} catch (error) {
    console.error("Erreur: Impossible de lire ou parser 'predictions_selectionnees.json'. Exécutez d'abord le prediction-manager.", error);
    process.exit(1);
}

if (!predictions || predictions.length === 0) {
    console.log("Aucune prédiction sélectionnée à traiter.");
    process.exit(0);
}

// 2. Mélanger les prédictions pour la diversité
shuffleArray(predictions);

const generatedTickets = [];

// 3. Générer des tickets à un seul match
for (const pred of predictions) {
    if (generatedTickets.length >= MAX_TICKETS) break;

    if (pred.odds >= MIN_TICKET_ODDS && pred.odds <= MAX_TICKET_ODDS) {
        const ticket = {
            odds: pred.odds,
            predictions: [pred]
        };
        generatedTickets.push(ticket);
    }
}

// 4. Générer des tickets à deux matchs (si on n'a pas encore atteint le max)
if (generatedTickets.length < MAX_TICKETS) {
    for (let i = 0; i < predictions.length; i++) {
        if (generatedTickets.length >= MAX_TICKETS) break;

        for (let j = i + 1; j < predictions.length; j++) {
            if (generatedTickets.length >= MAX_TICKETS) break;

            const pred1 = predictions[i];
            const pred2 = predictions[j];

            const matchId1 = `${pred1.match_details.home_team}-${pred1.match_details.away_team}`;
            const matchId2 = `${pred2.match_details.home_team}-${pred2.match_details.away_team}`;

            if (matchId1 !== matchId2) {
                const combinedOdds = pred1.odds * pred2.odds;

                if (combinedOdds >= MIN_TICKET_ODDS && combinedOdds <= MAX_TICKET_ODDS) {
                    const ticket = {
                        odds: combinedOdds,
                        predictions: [pred1, pred2]
                    };
                    generatedTickets.push(ticket);
                }
            }
        }
    }
}

// 5. Afficher les tickets générés
console.log(`\n--- ${generatedTickets.length} TICKETS GÉNÉRÉS ---\n`);

generatedTickets.forEach((ticket, index) => {
    console.log(`\n================ TICKET N°${index + 1} ================`);
    console.log(`Cote totale : ${ticket.odds.toFixed(2)}`);
    console.log("============================================\n");

    ticket.predictions.forEach(pred => {
        console.log(`Match: ${pred.match_details.home_team} vs ${pred.match_details.away_team}`);
        console.log(`Pari: ${pred.market} @ ${pred.odds}`);
        console.log(`Confiance: ${pred.confidence.toFixed(2)}%`);
        printMarketStats(pred.market, pred.marketStats);
    });
});
