const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { getCombinations } = require('./utils');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

// --- CONFIGURATION ---
const API_KEY = '7f7700a471beeeb52aecde406a3870ba'; // REMPLACEZ PAR VOTRE CLÉ API
const API_HOST = 'v3.football.api-sports.io';
const BOOKMAKER_PRIORITY = [ { id: 16, name: 'Unibet' }, { id: 8, name: 'Bet365' }, { id: 6, name: '1xBet' }];
const LEAGUES_TO_ANALYZE = [
    { name: 'Bundesliga', id: 78, coeff: 1.0 }, { name: 'Bundesliga 2', id: 79, coeff: 0.85 },
    { name: 'Premier League', id: 39, coeff: 1.0 }, { name: 'Championship', id: 40, coeff: 0.85 },
    { name: 'Saudi Pro League', id: 307, coeff: 0.75 }, { name: 'Liga Profesional', id: 128, coeff: 0.85 },
    { name: 'Bundesliga (Autriche)', id: 218, coeff: 0.75 }, { name: 'Pro League', id: 144, coeff: 0.8 },
    { name: 'Série A (Brésil)', id: 71, coeff: 0.85 }, { name: 'Parva Liga', id: 172, coeff: 0.7 },
    { name: 'Primera Division (Chili)', id: 265, coeff: 0.75 }, { name: 'Super League (Chine)', id: 169, coeff: 0.7 },
    { name: 'Primera A', id: 239, coeff: 0.75 }, { name: 'K League 1', id: 292, coeff: 0.8 },
    { name: 'HNL', id: 210, coeff: 0.75 }, { name: 'Superliga', id: 119, coeff: 0.8 },
    { name: 'Premiership', id: 179, coeff: 0.75 }, { name: 'Liga Pro', id: 240, coeff: 0.7 },
    { name: 'La Liga', id: 140, coeff: 1.0 }, { name: 'La Liga 2', id: 141, coeff: 0.85 },
    { name: 'Meistriliiga', id: 327, coeff: 0.65 }, { name: 'MLS', id: 253, coeff: 0.8 },
    { name: 'Veikkausliiga', id: 244, coeff: 0.7 }, { name: 'Ligue 1', id: 61, coeff: 1.0 },
    { name: 'Ligue 2', id: 62, coeff: 0.85 }, { name: 'Erovnuli Liga', id: 329, coeff: 0.65 },
    { name: 'Super League (Grèce)', id: 197, coeff: 0.8 }, { name: 'OTP Bank Liga', id: 271, coeff: 0.7 },
    { name: 'Premier Division', id: 357, coeff: 0.7 }, { name: 'Besta deild karla', id: 164, coeff: 0.65 },
    { name: 'Serie A', id: 135, coeff: 1.0 }, { name: 'Serie B', id: 136, coeff: 0.85 },
    { name: 'J1 League', id: 98, coeff: 0.8 }, { name: 'A Lyga', id: 331, coeff: 0.65 },
    { name: 'Liga MX', id: 262, coeff: 0.8 }, { name: 'Eliteserien', id: 103, coeff: 0.75 },
    { name: 'Primera Division (Paraguay)', id: 284, coeff: 0.7 }, { name: 'Eredivisie', id: 88, coeff: 0.85 },
    { name: 'Cymru Premier', id: 110, coeff: 0.65 }, { name: 'Ekstraklasa', id: 106, coeff: 0.75 },
    { name: 'Liga Portugal', id: 94, coeff: 0.85 }, { name: 'Liga Portugal 2', id: 95, coeff: 0.75 },
    { name: 'Fortuna Liga', id: 345, coeff: 0.7 }, { name: 'Liga 1', id: 283, coeff: 0.7 },
    { name: 'Super Liga', id: 286, coeff: 0.7 }, { name: 'Nike Liga', id: 334, coeff: 0.65 },
    { name: 'Prva Liga', id: 373, coeff: 0.65 }, { name: 'Allsvenskan', id: 113, coeff: 0.75 },
    { name: 'Super League (Suisse)', id: 207, coeff: 0.8 }, { name: 'Super Lig', id: 203, coeff: 0.8 },
    { name: 'Premier League (Ukraine)', id: 235, coeff: 0.75 }
];
const RANK_GAP_THRESHOLD = 8;
const PERFORMANCE_THRESHOLD = 67; 
const CONFIDENCE_THRESHOLD = 85;
const EARLY_SEASON_COEFF = 0.9;

const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const cache = { odds: new Map(), standings: new Map(), stats: new Map() };

// --- FONCTIONS DE BASE ---
async function safeApiCall(endpoint, params, cacheKey = null) {
    const key = cacheKey ? `${cacheKey.type}_${cacheKey.key}` : null;
    if (key && cache[cacheKey.type] && cache[cacheKey.type].has(key)) return cache[cacheKey.type].get(key);
    try {
        await new Promise(resolve => setTimeout(resolve, 150));
        const response = await api.get(endpoint, { params });
        const data = response.data;
        if (key) {
            if (!cache[cacheKey.type]) cache[cacheKey.type] = new Map();
            cache[cacheKey.type].set(key, data);
        }
        return data;
    } catch (error) { 
        console.error(`Erreur API pour ${endpoint} avec params ${JSON.stringify(params)}: ${error.message}`);
        return null; 
    }
}
function calculateFormScore(formString) {
    if (!formString) return 0;
    return formString.split('').reduce((acc, char) => (char === 'W' ? acc + 3 : char === 'D' ? acc + 1 : acc), 0);
}
function getOddsForMarket(oddsData, marketId, marketValue) {
    if (!oddsData?.response?.[0]) return null;
    for (const bookmaker of BOOKMAKER_PRIORITY) {
        const bookmakerData = oddsData.response[0].bookmakers.find(b => b.id === bookmaker.id);
        if (bookmakerData) {
            const market = bookmakerData.bets.find(b => b.id === marketId);
            if (market) {
                const value = market.values.find(v => v.value === marketValue);
                if (value) return { odd: parseFloat(value.odd), bookmakerName: bookmaker.name };
            }
        }
    }
    return null;
}
function getStatsBetType(pick) {
    if (pick.finalBetType.startsWith('Victoire')) return 'Victoire Favori';
    if (pick.finalBetType.startsWith('Double Chance')) return 'Double Chance';
    return pick.strategyName;
};
function isSuccess(pick, homeGoals, awayGoals){
    if (homeGoals === null || awayGoals === null) return null;
    const totalGoals = homeGoals + awayGoals;
    const favIsHome = pick.match.favoriteName === pick.match.homeName;
    const favWins = (favIsHome && homeGoals > awayGoals) || (!favIsHome && awayGoals > homeGoals);
    const statsBetType = getStatsBetType(pick);
    if(statsBetType === "Victoire Favori") return favWins;
    if(statsBetType === "Double Chance") return favWins || homeGoals === awayGoals;
    switch (pick.strategyName) {
        case 'Over 1.5': return totalGoals > 1.5; case 'Under 1.5': return totalGoals < 1.5;
        case 'Over 2.5': return totalGoals > 2.5; case 'Under 2.5': return totalGoals < 2.5;
        case 'Over 3.5': return totalGoals > 3.5; case 'Under 3.5': return totalGoals < 3.5;
        case 'BTTS': return homeGoals > 0 && awayGoals > 0; case 'BTTS - Non': return homeGoals === 0 || awayGoals === 0;
        default: return null;
    }
}
async function performAnalysis(startDate, endDate) {
    Object.keys(cache).forEach(key => cache[key].clear());
    let allPicks = [];
    const season = new Date(startDate).getFullYear();
    console.log(`\n--- Recherche des matchs entre ${startDate} et ${endDate} ---`);
    let allFixtures = [];
    for (const league of LEAGUES_TO_ANALYZE) {
        const fixturesData = await safeApiCall('/fixtures', { league: league.id, season: season, from: startDate, to: endDate });
        if (fixturesData && fixturesData.response.length > 0) {
            allFixtures.push(...fixturesData.response);
        }
    }
    console.log(`--- Total de ${allFixtures.length} matchs trouvés. Début de l'analyse détaillée... ---`);
    for (const fixture of allFixtures) {
        try {
            const league = LEAGUES_TO_ANALYZE.find(l => l.id === fixture.league.id);
            if (!league) continue;
            const standingsData = await safeApiCall('/standings', { league: league.id, season: season }, { type: 'standings', key: `${league.id}_${season}` });
            if (!standingsData?.response?.[0]?.league?.standings[0]) continue;
            const teamData = new Map();
            standingsData.response[0].league.standings[0].forEach(t => teamData.set(t.team.id, { rank: t.rank, form: t.form }));
            const homeData = teamData.get(fixture.teams.home.id), awayData = teamData.get(fixture.teams.away.id);
            if (!homeData || !awayData) continue;
            const homeStatsData = await safeApiCall('/teams/statistics', { team: fixture.teams.home.id, league: league.id, season: season }, { type: 'stats', key: `${fixture.teams.home.id}_${league.id}_${season}`});
            const awayStatsData = await safeApiCall('/teams/statistics', { team: fixture.teams.away.id, league: league.id, season: season }, { type: 'stats', key: `${fixture.teams.away.id}_${league.id}_${season}`});
            const homeAvgFor = parseFloat(homeStatsData?.response?.goals?.for?.average?.total || 0);
            const homeAvgAgainst = parseFloat(homeStatsData?.response?.goals?.against?.average?.total || 0);
            const awayAvgFor = parseFloat(awayStatsData?.response?.goals?.for?.average?.total || 0);
            const awayAvgAgainst = parseFloat(awayStatsData?.response?.goals?.against?.average?.total || 0);
            const formMomentum = (calculateFormScore(homeData.form) - calculateFormScore(awayData.form)) / 15 * 0.1;
            const projectedGoals = ((homeAvgFor + awayAvgFor + homeAvgAgainst + awayAvgAgainst) / 2) + formMomentum;
            const bttsPotential = ((homeAvgFor + awayAvgAgainst) / 2 + (awayAvgFor + homeAvgAgainst) / 2) / 2;
            const calculateScore = (p, b, s) => Math.max(5, Math.min(95, 50 + (p - b) * s));
            const dcScore = (() => {
                const rankGap = Math.abs(homeData.rank - awayData.rank);
                if (rankGap < RANK_GAP_THRESHOLD) return 0;
                let score = (rankGap - (RANK_GAP_THRESHOLD - 1)) * 3 + 25;
                const favRank = Math.min(homeData.rank, awayData.rank);
                if (favRank <= 3) score += 30; else if (favRank <= 6) score += 25; else score += 15;
                score += rankGap * 1.8;
                return Math.min(100, score * league.coeff);
            })();
            
            let isBeforeRound6 = false;
            const roundString = fixture.league.round || '';
            const roundMatch = roundString.match(/\d+/);
            if (roundMatch && parseInt(roundMatch[0], 10) < 6) {
                isBeforeRound6 = true;
            }

            const strategies = {
                'Double Chance': dcScore, 'Over 1.5': calculateScore(projectedGoals, 1.5, 15), 'Under 1.5': 100 - calculateScore(projectedGoals, 1.5, 15),
                'Over 2.5': calculateScore(projectedGoals, 2.5, 22), 'Under 2.5': 100 - calculateScore(projectedGoals, 2.5, 22),
                'Over 3.5': calculateScore(projectedGoals, 3.5, 25), 'Under 3.5': 100 - calculateScore(projectedGoals, 3.5, 25),
                'BTTS': calculateScore(bttsPotential, 1.25, 40), 'BTTS - Non': 100 - calculateScore(bttsPotential, 1.25, 40)
            };
            const matchInfo = { 
                id: fixture.fixture.id, date: fixture.fixture.date.split('T')[0], leagueName: league.name, leagueCountry: fixture.league.country,
                homeName: fixture.teams.home.name, awayName: fixture.teams.away.name, homeLogo: fixture.teams.home.logo, awayLogo: fixture.teams.away.logo, 
                favoriteName: homeData.rank < awayData.rank ? fixture.teams.home.name : fixture.teams.away.name, 
                score: fixture.fixture.status.short === 'FT' ? `${fixture.goals.home} - ${fixture.goals.away}` : 'À venir',
                isBeforeRound6
            };
            const oddsData = await safeApiCall('/odds', { fixture: fixture.fixture.id }, { type: 'odds', key: fixture.fixture.id });
            for (const stratName in strategies) {
                const score = strategies[stratName];
                let oddsResult = null;
                let finalBetType = stratName;

                if (stratName === 'Double Chance') {
                    const favIsHome = matchInfo.favoriteName === matchInfo.homeName;
                    const dcResult = getOddsForMarket(oddsData, 12, favIsHome ? 'Home or Draw' : 'Away or Draw');
                    if (dcResult) {
                        oddsResult = dcResult;
                        finalBetType = `Double Chance ${matchInfo.favoriteName}`;
                    }
                } else {
                     const marketMap = { 'Over 1.5': {id: 5, v: 'Over 1.5'}, 'Under 1.5': {id: 5, v: 'Under 1.5'}, 'Over 2.5': {id: 5, v: 'Over 2.5'}, 'Under 2.5': {id: 5, v: 'Under 2.5'}, 'Over 3.5': {id: 5, v: 'Over 3.5'}, 'Under 3.5': {id: 5, v: 'Under 3.5'}, 'BTTS': {id: 8, v: 'Yes'}, 'BTTS - Non': {id: 8, v: 'No'} };
                     const market = marketMap[stratName];
                     if(market) oddsResult = getOddsForMarket(oddsData, market.id, market.v);
                }
                const [home, away] = matchInfo.score !== 'À venir' ? matchInfo.score.split(' - ').map(Number) : [null, null];
                
                const pickData = {
                    match: matchInfo, strategyName: stratName, finalBetType, odds: oddsResult?.odd || null,
                    bookmakerName: oddsResult?.bookmakerName || 'N/A', score
                };
                pickData.isSuccess = isSuccess(pickData, home, away);
                
                allPicks.push(pickData);
            }
        } catch (error) {
            console.error(`--- ERREUR : Impossible d'analyser le match ID ${fixture.fixture.id}. Passage au suivant. Erreur: ${error.message}`);
        }
    }
    return allPicks;
}

// --- FONCTIONS STATISTIQUES ET DE GROUPEMENT ---
function calculateStatistics(picks) {
    const createStatObject = () => ({
        confidenceBrackets: { under60: { total: 0, success: 0 }, '60-69': { total: 0, success: 0 }, '70-79': { total: 0, success: 0 }, '80-89': { total: 0, success: 0 }, '90-100': { total: 0, success: 0 } },
        betTypes: {}
    });
    const stats = { global: createStatObject(), earlySeason: createStatObject(), regularSeason: createStatObject() };
    for (const pick of picks) {
        if (pick.isSuccess === null) continue;
        const statGroup = pick.match.isBeforeRound6 ? stats.earlySeason : stats.regularSeason;
        const groups = [stats.global, statGroup];
        const score = pick.score;
        let bracket;
        if (score < 60) bracket = 'under60'; else if (score < 70) bracket = '60-69'; else if (score < 80) bracket = '70-79'; else if (score < 90) bracket = '80-89'; else bracket = '90-100';
        const statsBetType = getStatsBetType(pick);
        groups.forEach(group => {
            group.confidenceBrackets[bracket].total++;
            if(pick.isSuccess) group.confidenceBrackets[bracket].success++;
            if (!group.betTypes[statsBetType]) group.betTypes[statsBetType] = { total: 0, success: 0 };
            group.betTypes[statsBetType].total++;
            if(pick.isSuccess) group.betTypes[statsBetType].success++;
        });
    }
    for (const category of Object.values(stats)) {
        Object.values(category.confidenceBrackets).forEach(b => b.rate = b.total > 0 ? (b.success / b.total) * 100 : 0);
        Object.values(category.betTypes).forEach(t => t.rate = t.total > 0 ? (t.success / t.total) * 100 : 0);
    }
    return stats;
}
const groupPicksByDay = (picks) => {
    const dailyPicks = {};
    for (const pick of picks) {
        const date = pick.match.date;
        if (!dailyPicks[date]) dailyPicks[date] = [];
        dailyPicks[date].push(pick);
    }
    Object.values(dailyPicks).forEach(day => day.sort((a,b) => b.score - a.score));
    return dailyPicks;
};

// --- NOUVELLES FONCTIONS DE STRATÉGIE DE TICKETS ---

function generateMontanteTickets(dailyPicks, targetOdd = 3.0, numTickets = 5) {
    const allMontanteTickets = {};

    for (const date in dailyPicks) {
        const picks = dailyPicks[date];
        if (picks.length < 2) continue;

        const relevantPicks = picks.slice(0, 15); // On prend les 15 pronos les plus sûrs de la journée
        let potentialCombinations = [];

        // Fonction récursive pour trouver les combinaisons intelligemment
        function findCombos(startIndex, currentCombo) {
            const currentOdds = currentCombo.reduce((acc, p) => acc * p.odds, 1);

            // Condition d'arrêt (élagage) : si la cote est déjà trop haute, on arrête cette branche
            if (currentOdds > targetOdd + 7) {
                return;
            }

            // On ajoute la combinaison actuelle si elle est valide (plus de 1 pick)
            if (currentCombo.length > 1) {
                potentialCombinations.push({
                    picks: [...currentCombo],
                    totalOdds: currentOdds,
                    diff: Math.abs(currentOdds - targetOdd)
                });
            }
            
            // On continue de construire la combinaison
            for (let i = startIndex; i < relevantPicks.length; i++) {
                currentCombo.push(relevantPicks[i]);
                findCombos(i + 1, currentCombo);
                currentCombo.pop(); // Backtracking
            }
        }

        findCombos(0, []);
        
        if (potentialCombinations.length > 0) {
            potentialCombinations.sort((a, b) => a.diff - b.diff);

            // Logique de diversification
            const selectedTickets = [];
            const matchUsageCount = new Map();
            const MAX_MATCH_USAGE = 2;

            for(const combo of potentialCombinations) {
                if(selectedTickets.length >= numTickets) break;

                let canAdd = true;
                const tempUsage = new Map(matchUsageCount);
                
                for(const pick of combo.picks) {
                    const currentCount = tempUsage.get(pick.match.id) || 0;
                    if(currentCount + 1 > MAX_MATCH_USAGE) {
                        canAdd = false;
                        break;
                    }
                    tempUsage.set(pick.match.id, currentCount + 1);
                }

                if(canAdd) {
                    selectedTickets.push({ picks: combo.picks });
                    for(const pick of combo.picks) {
                        matchUsageCount.set(pick.match.id, (matchUsageCount.get(pick.match.id) || 0) + 1);
                    }
                }
            }
            allMontanteTickets[date] = selectedTickets;
        }
    }
    return allMontanteTickets;
}

function generateJackpotTickets(allPicks, numTickets = 2, maxSize = 20) {
    if (allPicks.length < 2) return [];
    
    // On filtre les cotes trop basses et on trie par cote décroissante
    const sortedByOdds = [...allPicks].filter(p => p.odds > 1.40).sort((a, b) => (b.odds || 0) - (a.odds || 0));
    if(sortedByOdds.length < 5) return []; // Il faut un minimum de matchs pour un jackpot

    const tickets = [];
    for (let i = 0; i < numTickets; i++) {
        const start = i * 5; // On décale pour diversifier
        if(start >= sortedByOdds.length) break;

        const ticketPicks = sortedByOdds.slice(start, start + maxSize);
        if (ticketPicks.length > 1) {
            tickets.push({ picks: ticketPicks });
        }
    }
    return tickets;
}

function generateTicketsBySegmentation(allPicks) {
    const sortedPicks = [...allPicks].sort((a, b) => b.score - a.score);
    const tier1End = Math.floor(sortedPicks.length * 0.2);
    const tier2End = tier1End + Math.floor(sortedPicks.length * 0.5);
    const lingotsPicks = sortedPicks.slice(0, tier1End);
    const piecesPicks = sortedPicks.slice(tier1End, tier2End);
    const pepitesPicks = sortedPicks.slice(tier2End);
    const buildCombos = (picks, size) => {
        const tickets = [];
        let availablePicks = [...picks];
        while(availablePicks.length >= size) {
            const ticketPicks = [];
            const usedMatchIds = new Set();
            const remainingPicksForNextLoop = [];
            for(const pick of availablePicks) {
                if(ticketPicks.length < size && !usedMatchIds.has(pick.match.id)) {
                    ticketPicks.push(pick);
                    usedMatchIds.add(pick.match.id);
                } else {
                    remainingPicksForNextLoop.push(pick);
                }
            }
            if(ticketPicks.length === size) tickets.push({ picks: ticketPicks });
            availablePicks = remainingPicksForNextLoop;
        }
        return tickets;
    };
    return { lingots: buildCombos(lingotsPicks, 2), pieces: buildCombos(piecesPicks, 4), pepites: buildCombos(pepitesPicks, 3) };
}

function generateTicketsByDistribution(allPicks, numTickets = 5) {
    const TICKET_MAX_SIZE = 20;
    const sortedPicks = [...allPicks].sort((a, b) => b.score - a.score);
    const tickets = Array.from({ length: numTickets }, () => ({ picks: [] }));
    sortedPicks.forEach(pick => {
        for (let i = 0; i < tickets.length; i++) {
            const ticketIndex = (pick.match.id + i) % numTickets;
            if (tickets[ticketIndex].picks.length < TICKET_MAX_SIZE && !tickets[ticketIndex].picks.some(p => p.match.id === pick.match.id)) {
                tickets[ticketIndex].picks.push(pick);
                break;
            }
        }
    });
    return tickets.filter(t => t.picks.length > 1);
}

function generateTicketsByPivots(allPicks, numPivots = 3, numSatellitesPerTicket = 2, limit = 30) {
    const sortedPicks = [...allPicks].sort((a, b) => b.score - a.score);
    const uniquePicks = [];
    const seenMatchIds = new Set();
    for (const pick of sortedPicks) {
        if (!seenMatchIds.has(pick.match.id)) {
            uniquePicks.push(pick);
            seenMatchIds.add(pick.match.id);
        }
    }
    if (uniquePicks.length < numPivots + numSatellitesPerTicket) return [];
    
    const pivots = uniquePicks.slice(0, numPivots);
    const satellites = uniquePicks.slice(numPivots, numPivots + 12); // On limite les satellites pour la performance
    if (satellites.length < numSatellitesPerTicket) return [];

    const tickets = [];
    const satelliteCombinations = getCombinations(satellites, numSatellitesPerTicket);
    pivots.forEach(pivot => {
        satelliteCombinations.forEach(combination => {
            tickets.push({ picks: [pivot, ...combination] });
        });
    });

    // On mélange et on limite
    return tickets.sort(() => 0.5 - Math.random()).slice(0, limit);
}

// --- FONCTIONS DE BILAN ---
function calculateStrategyBilan(tickets, isBacktest = true) {
    if (!tickets || tickets.length === 0) {
        return { total: 0, success: 0, rate: 0, roi: 0, tickets: [] };
    }
    tickets.forEach(ticket => {
        ticket.totalOdds = ticket.picks.reduce((acc, pick) => acc * (pick.odds || 1), 1);
        if (isBacktest) ticket.isSuccess = ticket.picks.every(pick => pick.isSuccess === true);
        else ticket.isSuccess = null;
    });
    if (!isBacktest) return { total: tickets.length, tickets: tickets };
    let successCount = 0;
    let totalGain = 0;
    tickets.forEach(ticket => {
        if (ticket.isSuccess) {
            successCount++;
            totalGain += ticket.totalOdds;
        }
    });
    const totalTickets = tickets.length;
    const roi = totalTickets > 0 ? ((totalGain - totalTickets) / totalTickets) * 100 : 0;
    return { total: totalTickets, success: successCount, rate: totalTickets > 0 ? (successCount / totalTickets) * 100 : 0, roi: roi.toFixed(1) };
}

// --- ROUTE POUR VÉRIFIER LES RÉSULTATS ---
app.post('/check-results', async (req, res) => {
    const { fixtureIds } = req.body;
    if (!fixtureIds || !Array.isArray(fixtureIds) || fixtureIds.length === 0) {
        return res.status(400).json({ error: 'Liste d\'IDs de matchs requise.' });
    }
    console.log(`Vérification des résultats pour ${fixtureIds.length} matchs.`);
    const results = {};
    try {
        for (const id of fixtureIds) {
            const fixtureData = await safeApiCall('/fixtures', { id });
            if (fixtureData && fixtureData.response && fixtureData.response.length > 0) {
                const fixture = fixtureData.response[0];
                if (fixture.fixture.status.short === 'FT') { 
                    results[id] = { status: 'FT', home: fixture.goals.home, away: fixture.goals.away };
                }
            }
        }
        res.json(results);
    } catch (error) {
        console.error("Erreur durant la vérification des résultats:", error);
        res.status(500).json({ error: "Une erreur interne est survenue lors de la vérification des résultats." });
    }
});

// --- ROUTE PRINCIPALE ---
app.get('/analyze-all', async (req, res) => {
    try {
        console.log("--- Lancement de l'analyse complète (Passé & Futur) ---");
        const today = new Date();
        const endDateBacktest = new Date(today);
        endDateBacktest.setDate(today.getDate() - 1);
        const startDateBacktest = new Date(endDateBacktest);
        startDateBacktest.setDate(endDateBacktest.getDate() - 6);
        
        // --- 1. ANALYSE DU PASSÉ (BACKTEST) ---
        const backtestPicksRaw = await performAnalysis(startDateBacktest.toISOString().split('T')[0], endDateBacktest.toISOString().split('T')[0]);
        const eligibleForStats = backtestPicksRaw.filter(p => p.isSuccess !== null);
        const backtestStats = calculateStatistics(eligibleForStats);
        
        const strategyPerformance = [];
        const performantBetTypesWhitelist = new Set();
        for (const betTypeName in backtestStats.global.betTypes) {
            const betTypeData = backtestStats.global.betTypes[betTypeName];
            const isPerformant = betTypeData.rate > PERFORMANCE_THRESHOLD;
            strategyPerformance.push({ name: betTypeName, rate: betTypeData.rate, status: isPerformant ? 'Accepté' : 'Refusé' });
            if (isPerformant) performantBetTypesWhitelist.add(betTypeName);
        }
        
        const eligibleForTicketsBacktest = eligibleForStats.filter(p => {
            const score = p.match.isBeforeRound6 ? p.score * EARLY_SEASON_COEFF : p.score;
            return score >= CONFIDENCE_THRESHOLD && p.odds && performantBetTypesWhitelist.has(getStatsBetType(p));
        });
        const backtestDailyPicks = groupPicksByDay(eligibleForTicketsBacktest);
        const allMontanteBacktestTickets = Object.values(generateMontanteTickets(backtestDailyPicks, 3.0, 5)).flat();

        const bilanBacktest = {
             segmentation: {
                lingots: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsBacktest).lingots, true),
                pieces: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsBacktest).pieces, true),
                pepites: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsBacktest).pepites, true)
            },
            distribution: calculateStrategyBilan(generateTicketsByDistribution(eligibleForTicketsBacktest, 5), true),
            pivots: calculateStrategyBilan(generateTicketsByPivots(eligibleForTicketsBacktest, 3, 2, 30), true),
            jackpot: calculateStrategyBilan(generateJackpotTickets(eligibleForTicketsBacktest, 3, 20), true),
            montante: calculateStrategyBilan(allMontanteBacktestTickets, true)
        };

        // --- 2. ANALYSE DU FUTUR (PRÉDICTIONS) ---
        const startDatePrediction = new Date(today);
        const endDatePrediction = new Date(today);
        endDatePrediction.setDate(today.getDate() + 6);
        const predictionPicksRaw = await performAnalysis(startDatePrediction.toISOString().split('T')[0], endDatePrediction.toISOString().split('T')[0]);
        
        const eligibleForTicketsPrediction = predictionPicksRaw.filter(p => {
            const adjustedScore = p.match.isBeforeRound6 ? p.score * EARLY_SEASON_COEFF : p.score;
            return adjustedScore >= CONFIDENCE_THRESHOLD && p.odds && performantBetTypesWhitelist.has(getStatsBetType(p));
        });
        
        const predictionDailyPicks = groupPicksByDay(eligibleForTicketsPrediction);
        const montanteTickets = generateMontanteTickets(predictionDailyPicks, 3.0, 5);

        const suggestedTickets = {
            segmentation: {
                lingots: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsPrediction).lingots, false),
                pieces: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsPrediction).pieces, false),
                pepites: calculateStrategyBilan(generateTicketsBySegmentation(eligibleForTicketsPrediction).pepites, false)
            },
            distribution: calculateStrategyBilan(generateTicketsByDistribution(eligibleForTicketsPrediction, 5), false),
            pivots: calculateStrategyBilan(generateTicketsByPivots(eligibleForTicketsPrediction, 3, 2, 30), false),
            jackpot: calculateStrategyBilan(generateJackpotTickets(eligibleForTicketsPrediction, 3, 20), false),
            montante: montanteTickets
        };
        
        res.json({ 
            backtestData: { 
                stats: backtestStats, 
                strategyPerformance: strategyPerformance,
                dailyPicks: groupPicksByDay(eligibleForStats.filter(p => p.score >= CONFIDENCE_THRESHOLD)), 
                strategyResults: bilanBacktest
            },
            predictionData: { 
                dailyPicks: predictionDailyPicks, 
                suggestedTickets: suggestedTickets 
            }
        });

    } catch(error) {
        console.error("Erreur durant l'analyse globale:", error);
        res.status(500).json({ error: "Une erreur interne est survenue." });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Le serveur est lancé sur http://localhost:${PORT}`));