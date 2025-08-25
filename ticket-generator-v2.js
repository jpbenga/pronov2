const fs = require('fs');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION ---
const PORT = 3002;
const MIN_OCCURRENCE_RATE = 65;
const MIN_CONFIDENCE_SCORE_PRUDENT = 85; // +5% en début de saison (90%)
const MIN_CONFIDENCE_SCORE_EQUILIBRE = 80; // +5% en début de saison (85%)
const MIN_CONFIDENCE_SCORE_AUDACIEUX = 70; // +5% en début de saison (75%)
const MIN_CONFIDENCE_EARLY_SEASON_BOOST = 5; // +5% pour début de saison
const MAX_TICKETS_PER_PROFILE = 20;
const MIN_ODD_PRUDENT = 1.5;
const MAX_ODD_PRUDENT = 3; // Tolérance jusqu'à 3.1
const TOLERANCE_ODD_PRUDENT = 0.1;
const MIN_ODD_EQUILIBRE = 1.2;
const MIN_ODD_AUDACIEUX = 1.35;
const TARGET_ODD_EQUILIBRE_MIN = 5;
const TARGET_ODD_EQUILIBRE_MAX = 12;
const TARGET_ODD_AUDACIEUX_MIN = 30;
const TARGET_ODD_AUDACIEUX_MAX = 500;
const MAX_MATCHES_PRUDENT = 2;
const MIN_MATCHES_EQUILIBRE = 3;
const MAX_MATCHES_EQUILIBRE = 6;
const MIN_MATCHES_AUDACIEUX = 8;
const MAX_MATCHES_AUDACIEUX = 15;
const MAX_BET_USAGE = 5;
const MAX_MATCH_USAGE = 3; // Nouvelle limite pour éviter la répétition des matchs
const MIN_TICKET_PROBABILITY = 0.001; // 0.1% pour Audacieux
const RISKY_MARKETS_AUDACIEUX = []; // Supprimé les marchés risqués
const LOW_OCCURRENCE_MARKETS = ['away_ht_over_3.5', 'home_ht_over_3.5', 'away_st_over_3.5', 'home_st_over_3.5'];

// Probabilités pour une répartition naturelle du nombre de matchs
const MATCH_COUNT_WEIGHTS = {
    Prudent: { 1: 0.5, 2: 0.5 },
    Equilibre: { 3: 0.3, 4: 0.3, 5: 0.2, 6: 0.2 },
    Audacieux: { 8: 0.25, 9: 0.25, 10: 0.2, 11: 0.15, 12: 0.1, 13: 0.05, 14: 0.03, 15: 0.02 }
};

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getMarketTagClass(market) {
    if (['draw', 'favorite_win', 'outsider_win'].includes(market)) return 'tag-winner';
    if (market.startsWith('home')) return 'tag-home';
    if (market.startsWith('away')) return 'tag-away';
    if (market.startsWith('ht') || market.startsWith('st')) return 'tag-halftime';
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
    return parseInt(Object.keys(weights)[0]); // Fallback
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

// --- MOTEUR DE GÉNÉRATION DE TICKETS ---
function generateAndServeTickets() {
    console.log(chalk.blue.bold("--- Générateur de Tickets de Prédiction (v12) ---"));
    
    let bilanData;
    let predictionsData;
    try {
        console.log("\n1. Lecture des fichiers de bilan et de prédictions...");
        bilanData = JSON.parse(fs.readFileSync('bilan_backtest.json', 'utf8'));
        predictionsData = JSON.parse(fs.readFileSync('predictions_du_jour.json', 'utf8'));
        console.log(chalk.green("   -> Fichiers chargés."));
    } catch (error) {
        console.error(chalk.red("Erreur : Fichiers de données non trouvés."));
        console.error(chalk.red("Assurez-vous d'avoir (re)lancé les deux autres scripts pour générer les fichiers à jour."));
        return;
    }

    console.log(`\n2. Identification des marchés fiables (occurrence > ${MIN_OCCURRENCE_RATE}%)...`);
    const trustworthyMarkets = new Set();
    const totalBacktestMatches = bilanData.totalMatchesAnalyzed;
    if (!totalBacktestMatches) {
        console.error(chalk.red("Erreur: 'totalMatchesAnalyzed' non trouvé dans bilan_backtest.json."));
        return;
    }
    
    console.log(chalk.cyan("   --- Marchés fiables retenus ---"));
    for (const market in bilanData.marketOccurrences) {
        if (LOW_OCCURRENCE_MARKETS.includes(market)) continue;
        const count = bilanData.marketOccurrences[market];
        const rate = (count / totalBacktestMatches) * 100;
        if (rate > MIN_OCCURRENCE_RATE) {
            trustworthyMarkets.add(market);
            console.log(chalk.gray(`   - ${market.padEnd(25)} (Taux: ${rate.toFixed(2)}%)`));
        }
    }

    if (trustworthyMarkets.size === 0) {
        console.log(chalk.yellow("\nAucun marché n'atteint le seuil de fiabilité requis."));
    }

    // Compter tous les matchs avant filtrage
    const allMatchesByDay = {};
    for (const leagueName in predictionsData) {
        predictionsData[leagueName].forEach(match => {
            if (!match.homeTeam || !match.awayTeam) return;
            const day = match.date;
            allMatchesByDay[day] = allMatchesByDay[day] || new Set();
            allMatchesByDay[day].add(match.matchLabel);
        });
    }

    let eligibleBets = [];
    const eligibleMatchesByDay = {};
    const matchUsageCounters = {}; // Compteur d'utilisation des matchs
    for (const leagueName in predictionsData) {
        predictionsData[leagueName].forEach(match => {
            if (!match.homeTeam || !match.awayTeam) return;
            const day = match.date;
            eligibleMatchesByDay[day] = eligibleMatchesByDay[day] || new Set();
            let hasEligibleBet = false;
            const minScores = {
                Prudent: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_PRUDENT + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_PRUDENT,
                Equilibre: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_EQUILIBRE + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_EQUILIBRE,
                Audacieux: match.isEarlySeason ? MIN_CONFIDENCE_SCORE_AUDACIEUX + MIN_CONFIDENCE_EARLY_SEASON_BOOST : MIN_CONFIDENCE_SCORE_AUDACIEUX
            };
            for (const market in match.scores) {
                if (!trustworthyMarkets.has(market)) continue; // Exclure tout marché non fiable
                const score = match.scores[market];
                const odd = match.odds ? match.odds[market] : undefined;
                if (['draw', 'favorite_win', 'outsider_win'].includes(market) && score < 90) continue;
                if (odd) {
                    const profiles = [];
                    if (score >= minScores.Prudent && odd >= MIN_ODD_PRUDENT) profiles.push('Prudent');
                    if (score >= minScores.Equilibre && odd >= MIN_ODD_EQUILIBRE) profiles.push('Equilibre');
                    if (score >= minScores.Audacieux && odd >= MIN_ODD_AUDACIEUX) profiles.push('Audacieux');
                    if (profiles.length > 0) {
                        const expectedValue = (score / 100) * odd;
                        eligibleBets.push({
                            id: `${match.matchLabel}|${market}`,
                            league: leagueName,
                            matchLabel: match.matchLabel,
                            homeTeam: match.homeTeam,
                            awayTeam: match.awayTeam,
                            homeLogo: match.homeLogo,
                            awayLogo: match.awayLogo,
                            date: match.date,
                            time: match.time,
                            market: market,
                            score: score,
                            odd: odd,
                            isEarlySeason: match.isEarlySeason,
                            expectedValue: expectedValue,
                            profiles: profiles
                        });
                        hasEligibleBet = true;
                    }
                }
            }
            if (hasEligibleBet) {
                eligibleMatchesByDay[day].add(match.matchLabel);
            }
        });
    }

    // Afficher les stats dans les logs
    console.log(chalk.cyan(`\n3. Matchs et paris éligibles (${eligibleBets.length} paris trouvés) :`));
    const betsByDay = eligibleBets.reduce((acc, bet) => {
        (acc[bet.date] = acc[bet.date] || []).push(bet);
        return acc;
    }, {});
    for (const day in betsByDay) {
        const totalMatches = allMatchesByDay[day] ? allMatchesByDay[day].size : 0;
        const eligibleMatches = eligibleMatchesByDay[day] ? eligibleMatchesByDay[day].size : 0;
        console.log(chalk.cyan(`\n   --- ${day} ---`));
        console.log(chalk.gray(`   Nombre total de matchs : ${totalMatches}`));
        console.log(chalk.gray(`   Nombre de matchs retenus : ${eligibleMatches}`));
        console.log(chalk.gray(`   Nombre de paris éligibles : ${betsByDay[day].length}`));
        const earlySeasonBets = betsByDay[day].filter(b => b.isEarlySeason);
        const regularBets = betsByDay[day].filter(b => !b.isEarlySeason);
        console.log(chalk.gray(`   Paris en début de saison : ${earlySeasonBets.length}`));
        console.log(chalk.gray(`   Paris hors début de saison : ${regularBets.length}`));
        betsByDay[day].forEach(bet => {
            const profilesStr = bet.profiles.join(', ');
            console.log(chalk.gray(
                `   - ${bet.homeTeam} vs ${bet.awayTeam} (${bet.league}, ${bet.time}): ` +
                `${bet.market}, ${bet.score.toFixed(0)}%, @${bet.odd.toFixed(2)}, ` +
                `VE:${bet.expectedValue.toFixed(2)}, ${bet.isEarlySeason ? 'Début de saison' : 'Régulier'}, Profils: ${profilesStr}`
            ));
        });
    }

    const finalTickets = {};
    const usageCounters = { Prudent: {}, Equilibre: {}, Audacieux: {} };
    for (const day in betsByDay) {
        console.log(chalk.cyan(`\n4. Génération des tickets pour le ${day}...`));
        finalTickets[day] = { Prudent: [], Equilibre: [], Audacieux: [] };
        const dayBets = betsByDay[day];

        // Profil Prudent : Simples et doubles uniquement
        const prudentBets = shuffle([...dayBets.filter(b => b.profiles.includes('Prudent'))]); // Mélange initial pour plus de diversité
        const maxPrudentIterations = 500; // Augmenté pour plus de chances de diversité
        let prudentIterations = 0;
        while (prudentIterations < maxPrudentIterations && finalTickets[day].Prudent.length < MAX_TICKETS_PER_PROFILE) {
            const matchCount = chooseMatchCount('Prudent');
            const availableBets = shuffle([...prudentBets]);
            let newTicket = [];
            let totalOdd = 1;
            let matchLabelsInTicket = new Set();
            let marketCounts = {};
            let matchUsage = { ...matchUsageCounters[day] || {} };

            for (const bet of availableBets) {
                if (newTicket.length >= matchCount || totalOdd > (MAX_ODD_PRUDENT + TOLERANCE_ODD_PRUDENT)) break;
                const betCount = usageCounters.Prudent[bet.id] || 0;
                const matchCountUsage = matchUsage[bet.matchLabel] || 0;
                const marketType = bet.market.split('_')[0];
                marketCounts[marketType] = marketCounts[marketType] || 0;
                if (betCount < MAX_BET_USAGE && matchCountUsage < MAX_MATCH_USAGE && !matchLabelsInTicket.has(bet.matchLabel) && marketCounts[marketType] < 2) {
                    const newTotalOdd = totalOdd * bet.odd;
                    if (newTotalOdd <= (MAX_ODD_PRUDENT + TOLERANCE_ODD_PRUDENT) || newTicket.length < matchCount) {
                        newTicket.push(bet);
                        totalOdd = newTotalOdd;
                        matchLabelsInTicket.add(bet.matchLabel);
                        marketCounts[marketType]++;
                        matchUsage[bet.matchLabel] = (matchUsage[bet.matchLabel] || 0) + 1;
                    }
                }
            }

            if (totalOdd >= MIN_ODD_PRUDENT && totalOdd <= (MAX_ODD_PRUDENT + TOLERANCE_ODD_PRUDENT) && newTicket.length === matchCount && isTicketUnique(newTicket, finalTickets[day].Prudent)) {
                finalTickets[day].Prudent.push({ bets: newTicket, totalOdd });
                newTicket.forEach(b => {
                    usageCounters.Prudent[b.id] = (usageCounters.Prudent[b.id] || 0) + 1;
                });
                matchUsageCounters[day] = matchUsage;
            }
            prudentIterations++;
        }

        // Profils Équilibré et Audacieux
        generateCombinationTickets(
            dayBets.filter(b => b.profiles.includes('Equilibre')),
            TARGET_ODD_EQUILIBRE_MIN,
            TARGET_ODD_EQUILIBRE_MAX,
            'Equilibre',
            finalTickets[day],
            usageCounters,
            matchUsageCounters
        );
        generateCombinationTickets(
            dayBets.filter(b => b.profiles.includes('Audacieux')),
            TARGET_ODD_AUDACIEUX_MIN,
            TARGET_ODD_AUDACIEUX_MAX,
            'Audacieux',
            finalTickets[day],
            usageCounters,
            matchUsageCounters
        );
    }

    const app = express();
    app.get('/', (req, res) => {
        let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Tickets Générés</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
                h1, h2, h3, h4 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
                .day-container { margin-bottom: 40px; }
                .profile-container { margin-left: 20px; }
                .ticket-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
                .ticket { background-color: #1e1e1e; border: 1px solid #373737; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; }
                .ticket-header { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; color: #fff; text-align: center; border-bottom: 1px solid #373737; padding-bottom: 10px; }
                .ticket-body { flex-grow: 1; }
                .bet-line { padding: 10px 0; border-bottom: 1px solid #2a2a2a; }
                .bet-line:last-child { border-bottom: none; }
                .match-header { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1.1em; font-weight: bold; margin-bottom: 5px; }
                .team-logo { width: 24px; height: 24px; }
                .match-details { text-align: center; font-size: 0.8em; color: #aaa; margin-bottom: 10px; }
                .bet-details { text-align: center; }
                .bet-market { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; margin-right: 5px; }
                .bet-odd { font-weight: bold; color: #03dac6; }
                .na { color: #666; }
                .tag-winner { background-color: #fd7e14; color: white; }
                .tag-match { background-color: #007bff; color: white; }
                .tag-home { background-color: #28a745; color: white; }
                .tag-away { background-color: #dc3545; color: white; }
                .tag-halftime { background-color: #ffc107; color: black; }
                .score-pill { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.9em; color: #121212; font-weight: bold; }
                .score-gold { background-color: #ffd700; }
                .score-green { background-color: #28a745; color: white; }
                .score-blue { background-color: #17a2b8; color: white; }
                .early-season-tag { background-color: #ffc107; color: black; font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
                .confidence-tag { font-size: 0.8em; padding: 2px 6px; border-radius: 4px; margin-left: 5px; }
                .confidence-80-89 { background-color: #17a2b8; color: white; }
                .confidence-90-100 { background-color: #ffd700; color: black; }
                .eligible-bets-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
                .eligible-bets-table th, .eligible-bets-table td { border: 1px solid #373737; padding: 8px; text-align: left; font-size: 0.9em; }
                .eligible-bets-table th { background-color: #1e1e1e; color: #bb86fc; }
                .eligible-bets-table tr:nth-child(even) { background-color: #181818; }
                .stats { font-size: 0.9em; color: #aaa; margin-bottom: 20px; }
            </style>
            </head><body><h1>Tickets Recommandés</h1>`;

        // Section Matchs Éligibles
        html += `<h2>Matchs Éligibles</h2>`;
        for (const day in betsByDay) {
            const totalMatches = allMatchesByDay[day] ? allMatchesByDay[day].size : 0;
            const eligibleMatches = eligibleMatchesByDay[day] ? eligibleMatchesByDay[day].size : 0;
            html += `<div class="day-container"><h3>🗓️ Le ${day}</h3>`;
            html += `<div class="stats">Nombre total de matchs : ${totalMatches}<br>Nombre de matchs retenus : ${eligibleMatches}<br>Nombre de paris éligibles : ${betsByDay[day].length}</div>`;
            html += `<table class="eligible-bets-table">
                <tr>
                    <th>Match</th>
                    <th>Ligue</th>
                    <th>Heure</th>
                    <th>Marché</th>
                    <th>Score</th>
                    <th>Cote</th>
                    <th>VE</th>
                    <th>Début de Saison</th>
                    <th>Profils</th>
                </tr>`;
            const dayBets = betsByDay[day].sort((a, b) => b.expectedValue - a.expectedValue);
            dayBets.forEach(bet => {
                const marketTagClass = getMarketTagClass(bet.market);
                let scorePillClass = 'score-blue';
                if (bet.score >= 95) scorePillClass = 'score-gold';
                else if (bet.score >= 88) scorePillClass = 'score-green';
                const confidenceTag = bet.score >= 90 ? '<span class="confidence-tag confidence-90-100">90-100%</span>' : '<span class="confidence-tag confidence-80-89">80-89%</span>';
                const earlySeasonTag = bet.isEarlySeason ? '<span class="early-season-tag">Oui</span>' : 'Non';
                const profilesStr = bet.profiles.join(', ');
                html += `<tr>
                    <td>${bet.homeTeam} vs ${bet.awayTeam}</td>
                    <td>${bet.league}</td>
                    <td>${bet.time}</td>
                    <td><span class="bet-market ${marketTagClass}">${bet.market}</span></td>
                    <td><span class="score-pill ${scorePillClass}">${bet.score.toFixed(0)}%</span> ${confidenceTag}</td>
                    <td><span class="bet-odd">@ ${bet.odd.toFixed(2)}</span></td>
                    <td>${bet.expectedValue.toFixed(2)}</td>
                    <td>${earlySeasonTag}</td>
                    <td>${profilesStr}</td>
                </tr>`;
            });
            html += `</table></div>`;
        }

        let totalTicketsGenerated = 0;
        Object.values(finalTickets).forEach(d => Object.values(d).forEach(p => totalTicketsGenerated += p.length));

        if (totalTicketsGenerated === 0) {
            html += `<p>Aucun ticket n'a pu être généré avec les critères actuels.</p>`;
        }
        
        for (const day in finalTickets) {
            html += `<div class="day-container"><h2>🗓️ Le ${day}</h2>`;
            for (const profile in finalTickets[day]) {
                const tickets = finalTickets[day][profile];
                if (tickets.length > 0) {
                    html += `<div class="profile-container"><h3>Profil ${profile} (${tickets.length} tickets)</h3><div class="ticket-grid">`;
                    tickets.forEach((ticket, i) => {
                        const totalOddDisplay = typeof ticket.totalOdd === 'number' ? ticket.totalOdd.toFixed(2) : '<span class="na">N/A</span>';
                        html += `<div class="ticket"><div class="ticket-header">Ticket #${i + 1} &nbsp;&nbsp;&nbsp;&nbsp; Cote Totale : <span class="bet-odd">${totalOddDisplay}</span></div><div class="ticket-body">`;
                        ticket.bets.forEach(bet => {
                            const oddDisplay = bet.odd ? `@ ${bet.odd.toFixed(2)}` : '<span class="na">@ N/A</span>';
                            const marketTagClass = getMarketTagClass(bet.market);
                            let scorePillClass = 'score-blue';
                            if (bet.score >= 95) scorePillClass = 'score-gold';
                            else if (bet.score >= 88) scorePillClass = 'score-green';
                            const confidenceTag = bet.score >= 90 ? '<span class="confidence-tag confidence-90-100">90-100%</span>' : '<span class="confidence-tag confidence-80-89">80-89%</span>';
                            const earlySeasonTag = bet.isEarlySeason ? '<span class="early-season-tag">⚠️ Début de Saison</span>' : '';
                            const impliedProb = bet.odd ? (1 / bet.odd * 100).toFixed(0) + '%' : 'N/A';
                            const expectedValue = bet.expectedValue.toFixed(2);
                            html += `<div class="bet-line">
                                        <div class="match-header"><img src="${bet.homeLogo}" class="team-logo"><span>${bet.homeTeam} vs ${bet.awayTeam}</span><img src="${bet.awayLogo}" class="team-logo"></div>
                                        <div class="match-details">${bet.league} - ${bet.time} ${earlySeasonTag}</div>
                                        <div class="bet-details">
                                            <span class="bet-market ${marketTagClass}">${bet.market}</span>
                                            <span class="score-pill ${scorePillClass}">${bet.score.toFixed(0)}%</span>
                                            ${confidenceTag}
                                            <span class="bet-odd"> ${oddDisplay}</span>
                                            <span style="color: #aaa; font-size: 0.8em;">(Prob. implicite: ${impliedProb}, VE: ${expectedValue})</span>
                                        </div>
                                     </div>`;
                        });
                        html += `</div></div>`;
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

function calculateTicketOdd(bets) {
    let totalOdd = 1;
    let hasOdds = false;
    bets.forEach(bet => {
        if (typeof bet.odd === 'number') {
            totalOdd *= bet.odd;
            hasOdds = true;
        }
    });
    return hasOdds ? totalOdd : 'N/A';
}

function calculateTicketProbability(bets) {
    let probability = 1;
    bets.forEach(bet => {
        if (bet.odd) {
            probability *= (1 / bet.odd);
        }
    });
    return probability;
}

function generateCombinationTickets(bets, targetOddMin, targetOddMax, profileName, finalTickets, usageCounters, matchUsageCounters) {
    let availableBets = [...bets];
    let iterations = 0;
    const maxIterations = profileName === 'Prudent' ? 500 : 200;
    const minMatches = profileName === 'Equilibre' ? MIN_MATCHES_EQUILIBRE : MIN_MATCHES_AUDACIEUX;
    const maxMatches = profileName === 'Equilibre' ? MAX_MATCHES_EQUILIBRE : MAX_MATCHES_AUDACIEUX;

    while (availableBets.length >= minMatches && finalTickets[profileName].length < MAX_TICKETS_PER_PROFILE && iterations < maxIterations) {
        const matchCount = chooseMatchCount(profileName);
        let newTicket = [];
        let totalOdd = 1;
        let matchLabelsInTicket = new Set();
        let marketCounts = {};
        let matchUsage = { ...matchUsageCounters[finalTickets[profileName][0]?.bets[0]?.date] || {} };
        availableBets = shuffle(availableBets);

        for (const bet of availableBets) {
            if (newTicket.length >= matchCount || totalOdd > targetOddMax) break;
            const betCount = usageCounters[profileName][bet.id] || 0;
            const matchCountUsage = matchUsage[bet.matchLabel] || 0;
            const marketType = bet.market.split('_')[0];
            marketCounts[marketType] = marketCounts[marketType] || 0;
            if (betCount < MAX_BET_USAGE && matchCountUsage < MAX_MATCH_USAGE && !matchLabelsInTicket.has(bet.matchLabel) && marketCounts[marketType] < 2) {
                const newTotalOdd = totalOdd * bet.odd;
                if (newTotalOdd <= targetOddMax || newTicket.length < matchCount) {
                    newTicket.push(bet);
                    totalOdd = newTotalOdd;
                    matchLabelsInTicket.add(bet.matchLabel);
                    marketCounts[marketType]++;
                    matchUsage[bet.matchLabel] = (matchUsage[bet.matchLabel] || 0) + 1;
                }
            }
        }

        const ticketProbability = calculateTicketProbability(newTicket);
        if (totalOdd >= targetOddMin && totalOdd <= targetOddMax && newTicket.length === matchCount && (profileName !== 'Audacieux' || ticketProbability >= MIN_TICKET_PROBABILITY) && isTicketUnique(newTicket, finalTickets[profileName])) {
            finalTickets[profileName].push({ bets: newTicket, totalOdd });
            newTicket.forEach(b => {
                usageCounters[profileName][b.id] = (usageCounters[profileName][b.id] || 0) + 1;
            });
            matchUsageCounters[finalTickets[profileName][0]?.bets[0]?.date] = matchUsage;
        }
        iterations++;
    }
}

// Lancer le script
generateAndServeTickets();