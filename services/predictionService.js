const dataCollector = require('./dataCollector');
const statsService = require('./statsService');
const analysisEngine = require('./analysisEngine');
const ticketGenerator = require('./ticketGenerator');
const { loadSportConfig } = require('../config');

async function run(strategyWhitelist = new Set()) {
    const sport = 'football';
    const { settings } = loadSportConfig(sport);

    console.log("\n[PROCESSUS QUOTIDIEN] Génération des prédictions pour l'interface...");
    const futureDataRaw = await dataCollector.getFutureMatchData();
    const futureData = await statsService.enrichFixturesWithStandings(futureDataRaw);

    const highRankGapMatches = futureData.filter(fixture => {
        const rankGap = Math.abs(fixture.homeStandings.rank - fixture.awayStandings.rank);
        return rankGap >= settings.analysisParams.rankGapThreshold;
    });

    const allFuturePicks = await analysisEngine.runAnalysis(sport, highRankGapMatches);
    
    const filteredPicks = allFuturePicks.filter(p => {
        const statsBetType = statsService.getStatsBetType(p.betType);
        return strategyWhitelist.has(statsBetType);
    });

    const tickets = ticketGenerator.generateTickets(sport, filteredPicks, 'predictions');

    return {
        picks: filteredPicks,
        tickets
    };
}

module.exports = { run };