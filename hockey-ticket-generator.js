const fs = require('fs');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION HOCKEY ---
const PORT = 3003; // Port différent
const MIN_OCCURRENCE_RATE = 60; // Seuil d'occurrence minimum pour qu'un marché soit considéré

// Seuils de confiance par profil
const MIN_CONFIDENCE_SCORE_PRUDENT = 85;
const MIN_CONFIDENCE_SCORE_EQUILIBRE = 78;
const MIN_CONFIDENCE_SCORE_AUDACIEUX = 70;
const MIN_CONFIDENCE_EARLY_SEASON_BOOST = 5; // Bonus de confiance pour les matchs en début de saison

// Limites de génération
const MAX_TICKETS_PER_PROFILE = 20;
const MAX_BET_USAGE = 5; // Un même pari (ex: "NYR vs BOS: home_win") peut être utilisé dans 5 tickets max
const MAX_MATCH_USAGE = 3; // Un même match peut apparaître dans 3 tickets max par profil

// Configuration du profil PRUDENT
const MIN_ODD_PRUDENT = 1.2; // Cote minimale pour un pari simple
const TARGET_ODD_PRUDENT_MIN = 1.8;
const TARGET_ODD_PRUDENT_MAX = 3.5;
const MAX_MATCHES_PRUDENT = 2;

// Configuration du profil EQUILIBRE
const MIN_ODD_EQUILIBRE = 1.2;
const TARGET_ODD_EQUILIBRE_MIN = 4;
const TARGET_ODD_EQUILIBRE_MAX = 10;
const MIN_MATCHES_EQUILIBRE = 3;
const MAX_MATCHES_EQUILIBRE = 5;

// Configuration du profil AUDACIEUX
const MIN_ODD_AUDACIEUX = 1.4;
const TARGET_ODD_AUDACIEUX_MIN = 20;
const TARGET_ODD_AUDACIEUX_MAX = 200;
const MIN_MATCHES_AUDACIEUX = 6;
const MAX_MATCHES_AUDACIEUX = 10;

// Probabilités pour une répartition naturelle du nombre de matchs dans les tickets
const MATCH_COUNT_WEIGHTS = {
    Prudent: { 1: 0.3, 2: 0.7 },
    Equilibre: { 3: 0.4, 4: 0.4, 5: 0.2 },
    Audacieux: { 6: 0.3, 7: 0.3, 8: 0.2, 9: 0.1, 10: 0.1 }
};


// --- FONCTIONS UTILITAIRES ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getMarketTagClass(market) {
    if (market.includes('win')) return 'tag-winner';
    if (market.includes('over')) return 'tag-over';
    if (market.includes('under')) return 'tag-under';
    return 'tag-match';
}

function chooseMatchCount(profile) {
    const weights = MATCH_COUNT_WEIGHTS[profile];
    const rand = Math.random();
    let cumulative = 0;
    for (const count in weights) {
        cumulative += weights[count];
        if (rand <= cumulative) return parseInt(count);
    }
    return parseInt(Object.keys(weights)[Object.keys(weights).length - 1]); // Fallback
}

function isTicketUnique(newTicket, existingTickets) {
    const newBetIds = new Set(newTicket.map(bet => bet.id));
    for (const ticket of existingTickets) {
        const existingBetIds = new Set(ticket.bets.map(bet => bet.id));
        if (newBetIds.size === existingBetIds.size && [...newBetIds].every(id => existingBetIds.has(id))) {
            return false;
        }
    }
    return true;
}

// --- MOTEUR DE GÉNÉRATION ---
function generateAndServeTickets() {
    console.log(chalk.blue.bold("--- 🏒 Générateur de Tickets Hockey ---"));
    
    let bilanData, predictionsData;
    try {
        console.log("\n1. Lecture des fichiers de bilan et de prédictions hockey...");
        bilanData = JSON.parse(fs.readFileSync('bilan_backtest_hockey.json', 'utf8'));
        predictionsData = JSON.parse(fs.readFileSync('predictions_hockey_du_jour.json', 'utf8'));
        console.log(chalk.green("   -> Fichiers chargés."));
    } catch (error) {
        console.error(chalk.red("Erreur : Fichiers de données non trouvés."));
        console.error(chalk.red("Assurez-vous d'avoir lancé les scripts de backtest et de prédiction pour le hockey."));
        return;
    }

    console.log(`\n2. Identification des marchés fiables (occurrence > ${MIN_OCCURRENCE_RATE}%)...`);
    const trustworthyMarkets = new Set();
    const totalBacktestMatches = bilanData.totalMatchesAnalyzed;
    if (!totalBacktestMatches) {
        console.error(chalk.red("Erreur: 'totalMatchesAnalyzed' est à 0 dans le bilan."));
        return;
    }
    
    for (const market in bilanData.marketOccurrences) {
        const count = bilanData.marketOccurrences[market];
        const rate = (count / totalBacktestMatches) * 100;
        if (rate > MIN_OCCURRENCE_RATE) {
            trustworthyMarkets.add(market);
            console.log(chalk.gray(`   - ${market.padEnd(25)} (Taux: ${rate.toFixed(2)}%)`));
        }
    }

    let eligibleBets = [];
    for (const leagueName in predictionsData) {
        predictionsData[leagueName].forEach(match => {
            const minScores = {
                Prudent: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_PRUDENT + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_PRUDENT,
                Equilibre: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_EQUILIBRE + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_EQUILIBRE,
                Audacieux: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_AUDACIEUX + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_AUDACIEUX
            };
            for (const market in match.scores) {
                if (!trustworthyMarkets.has(market)) continue;
                
                const score = match.scores[market];
                const odd = match.odds ? match.odds[market] : undefined;

                if (odd) {
                    const profiles = [];
                    if (score >= minScores.Prudent && odd >= MIN_ODD_PRUDENT) profiles.push('Prudent');
                    if (score >= minScores.Equilibre && odd >= MIN_ODD_EQUILIBRE) profiles.push('Equilibre');
                    if (score >= minScores.Audacieux && odd >= MIN_ODD_AUDACIEUX) profiles.push('Audacieux');

                    if (profiles.length > 0) {
                        eligibleBets.push({
                            id: `${match.matchLabel}|${market}`,
                            matchLabel: match.matchLabel,
                            homeTeam: match.homeTeam, awayTeam: match.awayTeam,
                            homeLogo: match.homeLogo, awayLogo: match.awayLogo,
                            date: match.date, time: match.time,
                            market, score, odd, profiles,
                            isEarlySeason: match.isEarlySeason,
                            expectedValue: (score / 100) * odd
                        });
                    }
                }
            }
        });
    }
    
    console.log(chalk.cyan(`\n3. ${eligibleBets.length} paris éligibles trouvés.`));
    
    const finalTickets = {};
    const betsByDay = eligibleBets.reduce((acc, bet) => {
        (acc[bet.date] = acc[bet.date] || []).push(bet);
        return acc;
    }, {});

    for (const day in betsByDay) {
        console.log(chalk.cyan(`\n4. Génération des tickets pour le ${day}...`));
        finalTickets[day] = { Prudent: [], Equilibre: [], Audacieux: [] };
        const dayBets = betsByDay[day];
        const usageCounters = { Prudent: {}, Equilibre: {}, Audacieux: {} };
        const matchUsageCounters = { Prudent: {}, Equilibre: {}, Audacieux: {} };

        // --- PROFIL PRUDENT ---
        generateProfileTickets(dayBets.filter(b => b.profiles.includes('Prudent')), 'Prudent', finalTickets[day], usageCounters, matchUsageCounters);
        // --- PROFIL EQUILIBRE ---
        generateProfileTickets(dayBets.filter(b => b.profiles.includes('Equilibre')), 'Equilibre', finalTickets[day], usageCounters, matchUsageCounters);
        // --- PROFIL AUDACIEUX ---
        generateProfileTickets(dayBets.filter(b => b.profiles.includes('Audacieux')), 'Audacieux', finalTickets[day], usageCounters, matchUsageCounters);
    }

    // --- SERVEUR WEB ---
    const app = express();
    app.get('/', (req, res) => {
        // ... (Le code HTML est long, on le met à la fin)
        let html = generateHtml(finalTickets, betsByDay);
        res.send(html);
    });

    app.listen(PORT, () => {
        console.log(chalk.inverse(`\n🚀 Serveur de tickets démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    });
}

function generateProfileTickets(bets, profileName, finalTicketsForDay, usageCounters, matchUsageCounters) {
    let availableBets = [...bets];
    let iterations = 0;
    const maxIterations = 500;
    
    const config = {
        Prudent: { minOdd: TARGET_ODD_PRUDENT_MIN, maxOdd: TARGET_ODD_PRUDENT_MAX, minMatches: 1, maxMatches: MAX_MATCHES_PRUDENT },
        Equilibre: { minOdd: TARGET_ODD_EQUILIBRE_MIN, maxOdd: TARGET_ODD_EQUILIBRE_MAX, minMatches: MIN_MATCHES_EQUILIBRE, maxMatches: MAX_MATCHES_EQUILIBRE },
        Audacieux: { minOdd: TARGET_ODD_AUDACIEUX_MIN, maxOdd: TARGET_ODD_AUDACIEUX_MAX, minMatches: MIN_MATCHES_AUDACIEUX, maxMatches: MAX_MATCHES_AUDACIEUX }
    }[profileName];

    while (finalTicketsForDay[profileName].length < MAX_TICKETS_PER_PROFILE && iterations < maxIterations) {
        iterations++;
        const matchCount = chooseMatchCount(profileName);
        if (availableBets.length < matchCount) break;

        let newTicket = [];
        let totalOdd = 1;
        let matchLabelsInTicket = new Set();
        
        availableBets = shuffle(availableBets);
        
        for (const bet of availableBets) {
            if (newTicket.length >= matchCount) break;

            const betUsage = usageCounters[profileName][bet.id] || 0;
            const matchUsage = matchUsageCounters[profileName][bet.matchLabel] || 0;

            if (betUsage < MAX_BET_USAGE && matchUsage < MAX_MATCH_USAGE && !matchLabelsInTicket.has(bet.matchLabel)) {
                newTicket.push(bet);
                totalOdd *= bet.odd;
                matchLabelsInTicket.add(bet.matchLabel);
            }
        }
        
        if (newTicket.length === matchCount && totalOdd >= config.minOdd && totalOdd <= config.maxOdd && isTicketUnique(newTicket, finalTicketsForDay[profileName])) {
            finalTicketsForDay[profileName].push({ bets: newTicket, totalOdd });
            newTicket.forEach(b => {
                usageCounters[profileName][b.id] = (usageCounters[profileName][b.id] || 0) + 1;
                matchUsageCounters[profileName][b.matchLabel] = (matchUsageCounters[profileName][b.matchLabel] || 0) + 1;
            });
        }
    }
}


function generateHtml(finalTickets, betsByDay) {
    let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Tickets Hockey Générés</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            h1, h2, h3 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
            .day-container { margin-bottom: 40px; }
            .profile-container { margin-left: 20px; }
            .ticket-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 20px; }
            .ticket { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 15px; }
            .ticket-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; color: #fff; text-align: center; border-bottom: 1px solid #373737; padding-bottom: 10px; }
            .bet-line { padding: 10px 0; border-bottom: 1px solid #2a2a2a; } .bet-line:last-child { border-bottom: none; }
            .match-header { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1.1em; font-weight: bold; margin-bottom: 5px; }
            .team-logo { width: 24px; height: 24px; }
            .match-details { text-align: center; font-size: 0.8em; color: #aaa; margin-bottom: 10px; }
            .bet-details { text-align: center; }
            .bet-market { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; margin-right: 5px; color: white; }
            .bet-odd { font-weight: bold; color: #03dac6; }
            .tag-winner { background-color: #fd7e14; }
            .tag-over { background-color: #28a745; }
            .tag-under { background-color: #dc3545; }
            .tag-match { background-color: #007bff; }
            .score-pill { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.9em; color: #121212; font-weight: bold; background-color: #17a2b8; color: white;}
            .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
            .eligible-bets-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            .eligible-bets-table th, .eligible-bets-table td { border: 1px solid #373737; padding: 8px; text-align: left; font-size: 0.9em; }
            .eligible-bets-table th { background-color: #1e1e1e; color: #bb86fc; }
        </style>
        </head><body><h1>🏒 Tickets Hockey Recommandés</h1>`;
    
    html += `<h2>Paris Éligibles du Jour</h2>`;
    for (const day in betsByDay) {
        html += `<div class="day-container"><h3>🗓️ Le ${day}</h3>`;
        html += `<table class="eligible-bets-table">
            <tr><th>Match</th><th>Marché</th><th>Score</th><th>Cote</th><th>VE</th><th>Profils</th></tr>`;
        const dayBets = betsByDay[day].sort((a, b) => b.expectedValue - a.expectedValue);
        dayBets.forEach(bet => {
            html += `<tr>
                <td>${bet.matchLabel} ${bet.isEarlySeason ? '<span class="early-season-tag">Début Saison</span>' : ''}</td>
                <td><span class="bet-market ${getMarketTagClass(bet.market)}">${bet.market}</span></td>
                <td><span class="score-pill">${bet.score.toFixed(0)}%</span></td>
                <td><span class="bet-odd">@ ${bet.odd.toFixed(2)}</span></td>
                <td>${bet.expectedValue.toFixed(2)}</td>
                <td>${bet.profiles.join(', ')}</td>
            </tr>`;
        });
        html += `</table></div>`;
    }

    let totalTicketsGenerated = 0;
    Object.values(finalTickets).forEach(d => Object.values(d).forEach(p => totalTicketsGenerated += p.length));

    if (totalTicketsGenerated === 0) {
        html += `<h2>Aucun ticket n'a pu être généré avec les critères actuels.</h2>`;
    }

    for (const day in finalTickets) {
        html += `<div class="day-container"><h2>🗓️ Tickets pour le ${day}</h2>`;
        for (const profile in finalTickets[day]) {
            const tickets = finalTickets[day][profile];
            if (tickets.length > 0) {
                html += `<div class="profile-container"><h3>Profil ${profile} (${tickets.length} tickets)</h3><div class="ticket-grid">`;
                tickets.forEach((ticket, i) => {
                    html += `<div class="ticket"><div class="ticket-header">Ticket #${i + 1} &nbsp;&nbsp;&nbsp; Cote Totale : <span class="bet-odd">${ticket.totalOdd.toFixed(2)}</span></div>`;
                    ticket.bets.forEach(bet => {
                        html += `<div class="bet-line">
                            <div class="match-header"><img src="${bet.homeLogo}" class="team-logo"><span>${bet.homeTeam} vs ${bet.awayTeam}</span><img src="${bet.awayLogo}" class="team-logo"></div>
                            <div class="match-details">${bet.time} ${bet.isEarlySeason ? '<span class="early-season-tag">Début Saison</span>' : ''}</div>
                            <div class="bet-details">
                                <span class="bet-market ${getMarketTagClass(bet.market)}">${bet.market}</span>
                                <span class="score-pill">${bet.score.toFixed(0)}%</span>
                                <span class="bet-odd">@ ${bet.odd.toFixed(2)}</span>
                            </div>
                        </div>`;
                    });
                    html += `</div>`;
                });
                html += `</div></div>`;
            }
        }
        html += `</div>`;
    }
    html += `</body></html>`;
    return html;
}

generateAndServeTickets();