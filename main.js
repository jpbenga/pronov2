const database = require('./database');
const config = require('./config/config');
const dataCollector = require('./services/dataCollector');
const analysisEngine = require('./services/analysisEngine');
const ticketGenerator = require('./services/ticketGenerator');
const verificationTool = require('./services/verificationTool');

function main() {
    console.log("--- PROJECT INITIALIZATION ---");
    database.initializeDb();
    
    console.log("\n--- STEP 1: BACKTESTING PHASE ---");
    const pastData = dataCollector.getPastMatchData(config.DAYS_TO_ANALYZE);
    analysisEngine.runBacktesting(pastData);
    
    console.log("\n--- STEP 2: PREDICTION PHASE ---");
    const futureMatches = dataCollector.getFutureMatchData(config.DAYS_TO_PREDICT);
    const predictions = analysisEngine.generatePredictions(futureMatches);
    database.savePredictions(predictions);
    console.log("INFO: Predictions saved.");
    
    console.log("\n--- STEP 3: TICKET GENERATION ---");
    const tickets = ticketGenerator.createTickets(predictions);
    database.saveTickets(tickets);
    console.log("INFO: Tickets saved.");

    console.log("\n--- STEP 4: VERIFICATION OF PAST TICKETS ---");
    
    
    
    
    console.log("\n--- EXECUTION COMPLETE ---");
}

main();
