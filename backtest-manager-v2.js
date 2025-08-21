const axios = require('axios');

// --- CONFIGURATION ---
const API_KEY = '7f7700a471beeeb52aecde406a3870ba';
const API_HOST = 'v3.football.api-sports.io';
const LEAGUES_TO_ANALYZE = [
    { name: 'Bundesliga', id: 78 }, { name: 'Bundesliga 2', id: 79 },
    { name: 'Premier League', id: 39 }, { name: 'Championship', id: 40 },
    { name: 'Saudi Pro League', id: 307 }, { name: 'Liga Profesional', id: 128 },
    { name: 'Bundesliga (Autriche)', id: 218 }, { name: 'Pro League', id: 144 },
    { name: 'Série A (Brésil)', id: 71 }, { name: 'Parva Liga', id: 172 },
    { name: 'Primera Division (Chili)', id: 265 }, { name: 'Super League (Chine)', id: 169 },
    { name: 'Primera A', id: 239 }, { name: 'K League 1', id: 292 },
    { name: 'HNL', id: 210 }, { name: 'Superliga', id: 119 },
    { name: 'Premiership', id: 179 }, { name: 'Liga Pro', id: 240 },
    { name: 'La Liga', id: 140 }, { name: 'La Liga 2', id: 141 },
    { name: 'Meistriliiga', id: 327 }, { name: 'MLS', id: 253 },
    { name: 'Veikkausliiga', id: 244 }, { name: 'Ligue 1', id: 61 },
    { name: 'Ligue 2', id: 62 }, { name: 'Erovnuli Liga', id: 329 },
    { name: 'Super League (Grèce)', id: 197 }, { name: 'OTP Bank Liga', id: 271 },
    { name: 'Premier Division', id: 357 }, { name: 'Besta deild karla', id: 164 },
    { name: 'Serie A', id: 135 }, { name: 'Serie B', id: 136 },
    { name: 'J1 League', id: 98 }, { name: 'A Lyga', id: 331 },
    { name: 'Liga MX', id: 262 }, { name: 'Eliteserien', id: 103 },
    { name: 'Primera Division (Paraguay)', id: 284 }, { name: 'Eredivisie', id: 88 },
    { name: 'Cymru Premier', id: 110 }, { name: 'Ekstraklasa', id: 106 },
    { name: 'Liga Portugal', id: 94 }, { name: 'Liga Portugal 2', id: 95 },
    { name: 'Fortuna Liga', id: 345 }, { name: 'Liga 1', id: 283 },
    { name: 'Super Liga', id: 286 }, { name: 'Nike Liga', id: 334 },
    { name: 'Prva Liga', id: 373 }, { name: 'Allsvenskan', id: 113 },
    { name: 'Super League (Suisse)', id: 207 }, { name: 'Super Lig', id: 203 },
    { name: 'Premier League (Ukraine)', id: 235 }
];
const MAX_ATTEMPTS = 5;

const api = axios.create({ baseURL: `https://${API_HOST}`, headers: { 'x-apisports-key': API_KEY }, timeout: 20000 });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function analyzeMatchMarkets(fixture) {
    const results = {};
    const fh = fixture.score.halftime;
    const ff = fixture.goals;

    if (ff.home === null || ff.away === null || fh.home === null || fh.away === null) {
        return null;
    }

    const sh = { home: ff.home - fh.home, away: ff.away - fh.away };
    results.btts = ff.home > 0 && ff.away > 0;
    const thresholds = [0.5, 1.5, 2.5, 3.5];
    thresholds.forEach(t => {
        results[`match_over_${t}`] = (ff.home + ff.away) > t;
        results[`match_under_${t}`] = (ff.home + ff.away) < t;
        results[`ht_over_${t}`] = (fh.home + fh.away) > t;
        results[`ht_under_${t}`] = (fh.home + fh.away) < t;
        results[`st_over_${t}`] = (sh.home + sh.away) > t;
        results[`st_under_${t}`] = (sh.home + sh.away) < t;
        results[`home_over_${t}`] = ff.home > t;
        results[`home_under_${t}`] = ff.home < t;
        results[`away_over_${t}`] = ff.away > t;
        results[`away_under_${t}`] = ff.away < t;
        results[`home_ht_over_${t}`] = fh.home > t;
        results[`home_ht_under_${t}`] = fh.home < t;
        results[`away_ht_over_${t}`] = fh.away > t;
        results[`away_ht_under_${t}`] = fh.away < t;
        results[`home_st_over_${t}`] = sh.home > t;
        results[`home_st_under_${t}`] = sh.home < t;
        results[`away_st_over_${t}`] = sh.away > t;
        results[`away_st_under_${t}`] = sh.away < t;
    });
    return results;
}

async function runBacktestAnalyzer() {
    console.log("--- Démarrage de l'analyseur de backtesting rapide ---");
    const season = new Date().getFullYear();
    const allMarketResults = [];
    const analysisFailures = [];
    let totalMatchesFound = 0;

    for (const league of LEAGUES_TO_ANALYZE) {
        console.log(`\n================================================================`);
        console.log(`[${LEAGUES_TO_ANALYZE.indexOf(league) + 1}/${LEAGUES_TO_ANALYZE.length}] Traitement : ${league.name}`);

        let leagueAttempts = 0, leagueSuccess = false;
        
        while (leagueAttempts < MAX_ATTEMPTS && !leagueSuccess) {
            leagueAttempts++;
            if (leagueAttempts > 1) console.log(`   -> Tentative ${leagueAttempts}/${MAX_ATTEMPTS} pour la ligue...`);
            try {
                const roundsResponse = await api.get('/fixtures/rounds', { params: { league: league.id, season: season, current: 'true' } });
                if (!roundsResponse.data?.response?.length) {
                    console.log(`  -> Aucune journée "en cours" trouvée pour cette ligue.`);
                    leagueSuccess = true; 
                    continue; 
                }
                
                const currentRoundName = roundsResponse.data.response[0];
                const roundParts = currentRoundName.match(/(\D+)(\d+)/);
                
                if (!roundParts || parseInt(roundParts[2], 10) <= 1) {
                    console.log(`  -> Pas de journée N-1 à analyser (en cours: ${currentRoundName}).`);
                    leagueSuccess = true;
                    continue; 
                }
                
                const prefix = roundParts[1].trim();
                const previousRoundName = `${prefix} ${parseInt(roundParts[2], 10) - 1}`;
                
                console.log(`  - Journée N-1 à analyser : "${previousRoundName}"`);
                const fixturesResponse = await api.get('/fixtures', { params: { league: league.id, season: season, round: previousRoundName } });
                
                const finishedMatches = fixturesResponse.data.response.filter(f => f.fixture.status.short === 'FT');
                totalMatchesFound += finishedMatches.length;
                console.log(`  - ${finishedMatches.length} match(s) terminé(s) trouvé(s). Analyse en cours...`);

                for (const fixture of finishedMatches) {
                    const marketResults = analyzeMatchMarkets(fixture);
                    if (marketResults) {
                        allMarketResults.push(marketResults);
                    } else {
                        analysisFailures.push({ Championnat: league.name, Match: `${fixture.teams.home.name} vs ${fixture.teams.away.name}`, Raison: "Données de score invalides" });
                    }
                }
                leagueSuccess = true;

            } catch (error) {
                const reason = error.response ? `API Error ${error.response.status}` : error.message;
                console.warn(`   -> Échec de la tentative ${leagueAttempts}/${MAX_ATTEMPTS} : ${reason}`);
                if (leagueAttempts >= MAX_ATTEMPTS) {
                    console.error(`\n   ❌ ERREUR FINALE pour ${league.name}`);
                    analysisFailures.push({ Championnat: league.name, Match: 'N/A', Raison: `Échec de récupération de la ligue: ${reason}` });
                } else {
                    await sleep(1500);
                }
            }
        }
        await sleep(500);
    }

    console.log('\n\n\n--- BILAN FINAL DE L\'ANALYSE DES MARCHÉS ---');
    console.log('===================================================');
    const totalMatchesAnalyzed = allMarketResults.length;
    
    if (totalMatchesFound === 0 && totalMatchesAnalyzed === 0) {
        console.log("Aucun match n'a été trouvé pour le backtesting.");
        return;
    }

    const stats = {};
    allMarketResults.forEach(result => {
        for (const key in result) {
            if (result[key]) {
                stats[key] = (stats[key] || 0) + 1;
            }
        }
    });

    const marketReport = [];
    
    // *** CORRECTION ICI : Liste complète de tous les marchés à afficher ***
    const marketOrder = Object.keys(stats).sort(); // Affiche tous les marchés calculés par ordre alphabétique

    for (const key of marketOrder) {
        const count = stats[key] || 0;
        const rate = totalMatchesAnalyzed > 0 ? ((count / totalMatchesAnalyzed) * 100).toFixed(2) : "0.00";
        marketReport.push({
            'Marché': key,
            'Taux Apparition': `${rate}%`,
            'Occurrences': count,
        });
    }
    
    console.log(`Matchs récupérés pour le backtesting : ${totalMatchesFound}`);
    console.log(`Matchs analysés avec succès : ${totalMatchesAnalyzed}`);
    console.table(marketReport);

    if (analysisFailures.length > 0) {
        console.log("\n--- Journal des échecs d'analyse ---");
        console.table(analysisFailures);
    }
    console.log('===================================================');
}

runBacktestAnalyzer();