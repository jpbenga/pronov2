const fs = require('fs');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION RUGBY ---
const PORT = 3003;
const MIN_OCCURRENCE_RATE = 60;
const MIN_CONFIDENCE_SCORE_PRUDENT = 85;
const MIN_CONFIDENCE_SCORE_EQUILIBRE = 80;
const MIN_CONFIDENCE_SCORE_AUDACIEUX = 70;
const MIN_CONFIDENCE_EARLY_SEASON_BOOST = 5;
const MAX_TICKETS_PER_PROFILE = 20;
const MIN_ODD_PRUDENT = 1.4;
const MAX_ODD_PRUDENT = 3.0;
const TOLERANCE_ODD_PRUDENT = 0.1;
const MIN_ODD_EQUILIBRE = 1.2;
const MIN_ODD_AUDACIEUX = 1.35;
const TARGET_ODD_EQUILIBRE_MIN = 4;
const TARGET_ODD_EQUILIBRE_MAX = 10;
const TARGET_ODD_AUDACIEUX_MIN = 25;
const TARGET_ODD_AUDACIEUX_MAX = 500;
const MAX_MATCHES_PRUDENT = 2;
const MAX_MATCHES_EQUILIBRE = 5;
const MAX_MATCHES_AUDACIEUX = 12;
const MAX_BET_USAGE = 5;
const MAX_MATCH_USAGE = 3;

const MATCH_COUNT_WEIGHTS = {
    Prudent: { 1: 0.5, 2: 0.5 },
    Equilibre: { 3: 0.4, 4: 0.4, 5: 0.2 },
    Audacieux: { 6: 0.3, 7: 0.3, 8: 0.2, 9: 0.1, 10: 0.05, 11: 0.03, 12: 0.02 }
};

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getMarketTagClass(market) {
    if (['favorite_win', 'outsider_win'].includes(market)) return 'tag-winner';
    if (market.startsWith('home')) return 'tag-home';
    if (market.startsWith('away')) return 'tag-away';
    if (market.startsWith('match')) return 'tag-match';
    return '';
}

function chooseMatchCount(profile) {
    const weights = MATCH_COUNT_WEIGHTS[profile];
    const rand = Math.random();
    let cumulative = 0;
    for (const count in weights) {
        cumulative += weights[count];
        if (rand <= cumulative) return parseInt(count);
    }
    return parseInt(Object.keys(weights).slice(-1)[0]);
}

function isTicketUnique(newTicket, existingTickets) {
    const newMatchLabels = new Set(newTicket.map(bet => bet.matchLabel));
    for (const ticket of existingTickets) {
        const existingMatchLabels = new Set(ticket.bets.map(bet => bet.matchLabel));
        if (newMatchLabels.size === existingMatchLabels.size && [...newMatchLabels].every(label => existingMatchLabels.has(label))) {
            return false;
        }
    }
    return true;
}

function generateAndServeTickets() {
    console.log(chalk.blue.bold("--- Générateur de Tickets Rugby ---"));
    
    let bilanData;
    let predictionsData;
    try {
        console.log("\n1. Lecture des fichiers de bilan et de prédictions rugby...");
        bilanData = JSON.parse(fs.readFileSync('rugby_bilan_backtest.json', 'utf8'));
        predictionsData = JSON.parse(fs.readFileSync('rugby_predictions_du_jour.json', 'utf8'));
        console.log(chalk.green("   -> Fichiers chargés."));
    } catch (error) {
        console.error(chalk.red("Erreur : Fichiers de données rugby non trouvés."));
        console.error(chalk.red("Assurez-vous d'avoir lancé les scripts de backtest et de prédiction pour le rugby."));
        return;
    }

    console.log(`\n2. Identification des marchés fiables (occurrence > ${MIN_OCCURRENCE_RATE}%)...`);
    const trustworthyMarkets = new Set();
    const totalBacktestMatches = bilanData.totalMatchesAnalyzed;
    if (!totalBacktestMatches) {
        console.error(chalk.red("Erreur: 'totalMatchesAnalyzed' non trouvé dans le bilan."));
        return;
    }
    
    for (const market in bilanData.marketOccurrences) {
        const count = bilanData.marketOccurrences[market];
        const rate = (count / totalBacktestMatches) * 100;
        if (rate > MIN_OCCURRENCE_RATE) {
            trustworthyMarkets.add(market);
        }
    }
    console.log(chalk.cyan(`   -> ${trustworthyMarkets.size} marchés fiables retenus.`));


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
                        eligibleBets.push({ ...match, market, score, odd, profiles, id: `${match.matchLabel}|${market}`});
                    }
                }
            }
        });
    }
    console.log(chalk.cyan(`\n3. ${eligibleBets.length} paris éligibles trouvés sur tous les profils.`));
    
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
        const matchUsageCounters = {};

        // Profil Prudent
        const prudentBets = shuffle([...dayBets.filter(b => b.profiles.includes('Prudent'))]);
        let prudentIterations = 0;
        while (prudentIterations < 500 && finalTickets[day].Prudent.length < MAX_TICKETS_PER_PROFILE) {
            const matchCount = chooseMatchCount('Prudent');
            const availableBets = shuffle([...prudentBets]);
            let newTicket = [];
            let totalOdd = 1;
            let matchLabelsInTicket = new Set();
            for (const bet of availableBets) {
                if (newTicket.length >= matchCount) break;
                if ((usageCounters.Prudent[bet.id] || 0) < MAX_BET_USAGE && 
                    (matchUsageCounters[bet.matchLabel] || 0) < MAX_MATCH_USAGE && 
                    !matchLabelsInTicket.has(bet.matchLabel)) {
                    
                    const newTotalOdd = totalOdd * bet.odd;
                    if (newTotalOdd <= (MAX_ODD_PRUDENT + TOLERANCE_ODD_PRUDENT)) {
                        newTicket.push(bet);
                        totalOdd = newTotalOdd;
                        matchLabelsInTicket.add(bet.matchLabel);
                    }
                }
            }
            if (totalOdd >= MIN_ODD_PRUDENT && newTicket.length > 0 && isTicketUnique(newTicket, finalTickets[day].Prudent)) {
                finalTickets[day].Prudent.push({ bets: newTicket, totalOdd });
                newTicket.forEach(b => {
                    usageCounters.Prudent[b.id] = (usageCounters.Prudent[b.id] || 0) + 1;
                    matchUsageCounters[b.matchLabel] = (matchUsageCounters[b.matchLabel] || 0) + 1;
                });
            }
            prudentIterations++;
        }

        // Profils Équilibré et Audacieux
        generateCombinationTickets(dayBets.filter(b => b.profiles.includes('Equilibre')), TARGET_ODD_EQUILIBRE_MIN, MAX_MATCHES_EQUILIBRE, 'Equilibre', finalTickets[day], usageCounters, matchUsageCounters);
        generateCombinationTickets(dayBets.filter(b => b.profiles.includes('Audacieux')), TARGET_ODD_AUDACIEUX_MIN, MAX_MATCHES_AUDACIEUX, 'Audacieux', finalTickets[day], usageCounters, matchUsageCounters);
    }

    startWebServer(finalTickets);
}

function generateCombinationTickets(bets, targetOddMin, maxMatches, profileName, finalTickets, usageCounters, matchUsageCounters) {
    let iterations = 0;
    while (finalTickets[profileName].length < MAX_TICKETS_PER_PROFILE && iterations < 2000) {
        const matchCount = chooseMatchCount(profileName);
        let availableBets = shuffle([...bets]);
        let newTicket = [];
        let totalOdd = 1;
        let matchLabelsInTicket = new Set();
        
        for (const bet of availableBets) {
            if (newTicket.length >= matchCount) break;
            if ((usageCounters[profileName][bet.id] || 0) < MAX_BET_USAGE && 
                (matchUsageCounters[bet.matchLabel] || 0) < MAX_MATCH_USAGE &&
                !matchLabelsInTicket.has(bet.matchLabel)) {
                
                newTicket.push(bet);
                totalOdd *= bet.odd;
                matchLabelsInTicket.add(bet.matchLabel);
            }
        }

        if (totalOdd >= targetOddMin && newTicket.length > 0 && isTicketUnique(newTicket, finalTickets[profileName])) {
            finalTickets[profileName].push({ bets: newTicket, totalOdd });
            newTicket.forEach(b => {
                usageCounters[profileName][b.id] = (usageCounters[profileName][b.id] || 0) + 1;
                matchUsageCounters[b.matchLabel] = (matchUsageCounters[b.matchLabel] || 0) + 1;
            });
        }
        iterations++;
    }
}

function startWebServer(finalTickets) {
    const app = express();
    app.get('/', (req, res) => {
        let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Tickets Rugby Générés</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
                h1, h2, h3 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
                .day-container { margin-bottom: 40px; }
                .profile-container { margin-left: 20px; }
                .ticket-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 20px; }
                .ticket { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 15px; }
                .ticket-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; text-align: center; border-bottom: 1px solid #373737; padding-bottom: 10px; }
                .bet-line { padding: 10px 0; border-bottom: 1px solid #2a2a2a; }
                .bet-line:last-child { border-bottom: none; }
                .match-header { display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: bold; }
                .team-logo { width: 24px; height: 24px; }
                .match-details { text-align: center; font-size: 0.8em; color: #aaa; margin-bottom: 10px; }
                .bet-details { text-align: center; }
                .bet-market { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; margin-right: 5px; color: white; }
                .bet-odd { font-weight: bold; color: #03dac6; }
                .tag-winner { background-color: #fd7e14; }
                .tag-match { background-color: #007bff; }
                .tag-home { background-color: #28a745; }
                .tag-away { background-color: #dc3545; }
                .score-pill { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.9em; color: black; font-weight: bold; }
                .score-gold { background-color: #ffd700; }
                .score-green { background-color: #28a745; color: white; }
                .score-blue { background-color: #17a2b8; color: white; }
                .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
            </style>
            </head><body><h1>Tickets Rugby Recommandés</h1>`;

        let totalTicketsGenerated = 0;
        Object.values(finalTickets).forEach(d => Object.values(d).forEach(p => totalTicketsGenerated += p.length));

        if (totalTicketsGenerated === 0) {
            html += `<p>Aucun ticket n'a pu être généré avec les prédictions et critères actuels.</p>`;
        }
        
        for (const day in finalTickets) {
            html += `<div class="day-container"><h2>🗓️ Le ${day}</h2>`;
            for (const profile in finalTickets[day]) {
                const tickets = finalTickets[day][profile];
                if (tickets.length > 0) {
                    html += `<div class="profile-container"><h3>Profil ${profile} (${tickets.length} tickets)</h3><div class="ticket-grid">`;
                    tickets.forEach((ticket, i) => {
                        html += `<div class="ticket"><div class="ticket-header">Ticket #${i + 1} &nbsp;&nbsp;&nbsp; Cote Totale : <span class="bet-odd">${ticket.totalOdd.toFixed(2)}</span></div>`;
                        ticket.bets.forEach(bet => {
                            const marketTagClass = getMarketTagClass(bet.market);
                            let scorePillClass = 'score-blue';
                            if (bet.score >= 95) scorePillClass = 'score-gold';
                            else if (bet.score >= 88) scorePillClass = 'score-green';
                            const earlySeasonTag = bet.isEarlySeason ? '<span class="early-season-tag">Début de Saison</span>' : '';
                            html += `<div class="bet-line">
                                        <div class="match-header"><img src="${bet.homeLogo}" class="team-logo"><span>${bet.homeTeam} vs ${bet.awayTeam}</span><img src="${bet.awayLogo}" class="team-logo"></div>
                                        <div class="match-details">${bet.league} - ${bet.time} ${earlySeasonTag}</div>
                                        <div class="bet-details">
                                            <span class="bet-market ${marketTagClass}">${bet.market}</span>
                                            <span class="score-pill ${scorePillClass}">${bet.score.toFixed(0)}%</span>
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
        res.send(html);
    });

    app.listen(PORT, () => {
        console.log(chalk.inverse(`\n🚀 Serveur de tickets démarré. Ouvrez http://localhost:${PORT} dans votre navigateur.`));
    });
}

generateAndServeTickets();