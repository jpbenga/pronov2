const fs = require('fs');
const express = require('express');
const chalk = require('chalk');

// --- CONFIGURATION ---
const PORT = 3002;
const MIN_OCCURRENCE_RATE = 65;
const MIN_CONFIDENCE_SCORE = 85;
const MAX_TICKETS_PER_PROFILE = 20;

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// NOUVEAU : Fonction pour attribuer une classe de couleur au marché
function getMarketTagClass(market) {
    if (market.startsWith('favorite') || market.startsWith('outsider') || market.startsWith('draw')) return 'tag-winner';
    if (market.startsWith('double_chance')) return 'tag-double-chance';
    if (market.startsWith('btts')) return 'tag-btts';
    if (market.startsWith('home')) return 'tag-home';
    if (market.startsWith('away')) return 'tag-away';
    if (market.startsWith('ht') || market.startsWith('st')) return 'tag-halftime';
    if (market.startsWith('match')) return 'tag-match';
    return ''; // Fallback
}


// --- MOTEUR DE GÉNÉRATION DE TICKETS ---
function generateAndServeTickets() {
    console.log(chalk.blue.bold("--- Générateur de Tickets de Prédiction (v4) ---"));
    
    // ... (début de la fonction inchangé)
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

    let eligibleBets = [];
    for (const leagueName in predictionsData) {
        predictionsData[leagueName].forEach(match => {
            if (!match.homeTeam || !match.awayTeam) return;
            for (const market in match.scores) {
                const score = match.scores[market];
                const odd = match.odds ? match.odds[market] : undefined;
                if (trustworthyMarkets.has(market) && score >= MIN_CONFIDENCE_SCORE) {
                    eligibleBets.push({ id: `${match.matchLabel}|${market}`, league: leagueName, matchLabel: match.matchLabel, homeTeam: match.homeTeam, awayTeam: match.awayTeam, homeLogo: match.homeLogo, awayLogo: match.awayLogo, date: match.date, time: match.time, market: market, score: score, odd: odd });
                }
            }
        });
    }
    console.log(chalk.green(`\n   -> ${eligibleBets.length} paris potentiels trouvés pour les tickets.`));

    // ... (le reste de la logique de génération de tickets est inchangée)
    const betsByDay = eligibleBets.reduce((acc, bet) => { (acc[bet.date] = acc[bet.date] || []).push(bet); return acc; }, {});
    const finalTickets = {};
    const usageCounters = { Prudent: {}, Equilibre: {}, Audacieux: {} };
    for (const day in betsByDay) {
        console.log(chalk.cyan(`\n3. Génération des tickets pour le ${day}...`));
        finalTickets[day] = { Prudent: [], Equilibre: [], Audacieux: [] };
        const dayBets = betsByDay[day].sort((a, b) => b.score - a.score);
        const safeBetsWithOdd150 = dayBets.filter(b => b.odd && b.odd >= 1.5);
        const safeBetsWithOdd120 = dayBets.filter(b => b.odd && b.odd >= 1.2);
        safeBetsWithOdd150.forEach(bet => {
            if (finalTickets[day].Prudent.length >= MAX_TICKETS_PER_PROFILE) return;
            const betCount = usageCounters.Prudent[bet.id] || 0;
            if (betCount < 3) {
                finalTickets[day].Prudent.push({ bets: [bet], totalOdd: bet.odd });
                usageCounters.Prudent[bet.id] = betCount + 1;
            }
        });
        for (let i = 0; i < safeBetsWithOdd120.length; i++) {
            if (finalTickets[day].Prudent.length >= MAX_TICKETS_PER_PROFILE) break;
            for (let j = i + 1; j < safeBetsWithOdd120.length; j++) {
                if (finalTickets[day].Prudent.length >= MAX_TICKETS_PER_PROFILE) break;
                const bet1 = safeBetsWithOdd120[i];
                const bet2 = safeBetsWithOdd120[j];
                const count1 = usageCounters.Prudent[bet1.id] || 0;
                const count2 = usageCounters.Prudent[bet2.id] || 0;
                if (bet1.matchLabel !== bet2.matchLabel && count1 < 3 && count2 < 3) {
                    const ticket = { bets: [bet1, bet2], totalOdd: calculateTicketOdd([bet1, bet2]) };
                    finalTickets[day].Prudent.push(ticket);
                    usageCounters.Prudent[bet1.id] = count1 + 1;
                    usageCounters.Prudent[bet2.id] = count2 + 1;
                }
            }
        }
        const highOddBets = dayBets.filter(b => b.odd && b.odd >= 1.35);
        generateCombinationTickets(shuffle([...highOddBets]), 4, 6, 'Equilibre', finalTickets[day], usageCounters);
        generateCombinationTickets(shuffle([...highOddBets]), 10, 15, 'Audacieux', finalTickets[day], usageCounters);
    }

    const app = express();
    app.get('/', (req, res) => {
        let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Tickets Générés</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
                h1, h2, h3 { color: #bb86fc; border-bottom: 2px solid #373737; padding-bottom: 10px; }
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
                
                /* NOUVEAU : Tags de couleur par type de marché */
                .tag-winner { background-color: #fd7e14; color: white; }
                .tag-double-chance { background-color: #20c997; color: white; }
                .tag-match { background-color: #007bff; color: white; }
                .tag-btts { background-color: #6f42c1; color: white; }
                .tag-home { background-color: #28a745; color: white; }
                .tag-away { background-color: #dc3545; color: white; }
                .tag-halftime { background-color: #ffc107; color: black; }
                
                /* NOUVEAU : Pastilles de couleur pour les scores de confiance */
                .score-pill { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.9em; color: #121212; font-weight: bold; }
                .score-gold { background-color: #ffd700; }
                .score-green { background-color: #28a745; color: white; }
                .score-blue { background-color: #17a2b8; color: white; }
            </style>
            </head><body><h1>Tickets Recommandés</h1>`;

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
                            
                            // MODIFIÉ : Logique d'affichage avec les nouvelles couleurs
                            const marketTagClass = getMarketTagClass(bet.market);
                            let scorePillClass = 'score-blue';
                            if (bet.score >= 95) scorePillClass = 'score-gold';
                            else if (bet.score >= 88) scorePillClass = 'score-green';

                            html += `<div class="bet-line">
                                        <div class="match-header"><img src="${bet.homeLogo}" class="team-logo"><span>${bet.homeTeam} vs ${bet.awayTeam}</span><img src="${bet.awayLogo}" class="team-logo"></div>
                                        <div class="match-details">${bet.league} - ${bet.time}</div>
                                        <div class="bet-details">
                                            <span class="bet-market ${marketTagClass}">${bet.market}</span>
                                            <span class="score-pill ${scorePillClass}">${bet.score}%</span>
                                            <span class="bet-odd"> ${oddDisplay}</span>
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

function generateCombinationTickets(bets, minSize, maxSize, profileName, finalTickets, usageCounters) {
    let availableBets = [...bets];
    while (availableBets.length >= minSize && finalTickets[profileName].length < MAX_TICKETS_PER_PROFILE) {
        let newTicket = [];
        let remainingBets = [];
        let matchLabelsInTicket = new Set();
        for (const bet of availableBets) {
            const betCount = usageCounters[profileName][bet.id] || 0;
            if (betCount < 3 && !matchLabelsInTicket.has(bet.matchLabel) && newTicket.length < maxSize) {
                newTicket.push(bet);
                matchLabelsInTicket.add(bet.matchLabel);
            } else {
                remainingBets.push(bet);
            }
        }
        if (newTicket.length >= minSize) {
            const ticket = { bets: newTicket, totalOdd: calculateTicketOdd(newTicket) };
            finalTickets[profileName].push(ticket);
            newTicket.forEach(b => {
                usageCounters[profileName][b.id] = (usageCounters[profileName][b.id] || 0) + 1;
            });
            availableBets = remainingBets;
        } else {
            break;
        }
    }
}

// Lancer le script
generateAndServeTickets();