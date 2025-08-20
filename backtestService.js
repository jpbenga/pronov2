const roundManager = require('./roundManager');
const statsService = require('./statsService'); // L'ancien statsService, qui contient encore des utilitaires
const analysisEngine = require('./analysisEngine');
const ticketGenerator = require('./ticketGenerator');
const stateManager = require('../stateManager');

async function run() {
    const state = stateManager.loadState();
    
    console.log("Étape 1: Recherche des nouvelles journées terminées via le RoundManager...");
    const roundsToAnalyze = await roundManager.getNewRoundsToAnalyze();
    
    if (roundsToAnalyze.length === 0) {
        console.log(" -> Aucune nouvelle journée à backtester.");
        return null;
    }

    console.log(` -> ${roundsToAnalyze.length} nouvelle(s) journée(s) à traiter.`);
    const allFixtures = roundsToAnalyze.flatMap(r => r.fixtures);
    const enrichedFixtures = await statsService.enrichFixturesWithStandings(allFixtures);
    
    const picks = await analysisEngine.runAnalysis('football', enrichedFixtures);
    const { whitelist, fullStats } = await statsService.calculatePerformanceStats(picks);
    const tickets = ticketGenerator.generateTickets('football', picks, 'backtest');

    roundsToAnalyze.forEach(round => {
        if (!state.leagues) state.leagues = {};
        if (!state.leagues[round.leagueId]) state.leagues[round.leagueId] = { analyzedRounds: {} };
        state.leagues[round.leagueId].analyzedRounds[round.round] = round.signature;
    });
    stateManager.saveState(state);
    console.log("   -> Analyse des nouvelles journées terminée et état sauvegardé.");

    return {
        analyzedFixtures: enrichedFixtures,
        picks,
        tickets,
        strategyWhitelist: whitelist,
        strategyStats: fullStats
    };
}

module.exports = { run };