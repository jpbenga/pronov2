const fs = require('fs');
const path = require('path');

const DATA_DIR = "data";
const RESULTS_FILE = path.join(DATA_DIR, "matchResults.json");
const PREDICTIONS_FILE = path.join(DATA_DIR, "predictions.json");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");

function initializeDb() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
    [RESULTS_FILE, PREDICTIONS_FILE, TICKETS_FILE].forEach(filePath => {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '[]', 'utf8');
        }
    });
}

function readData(filePath) {
    const jsonData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(jsonData);
}

function writeData(filePath, data) {
    const jsonString = JSON.stringify(data, null, 4);
    fs.writeFileSync(filePath, jsonString, 'utf8');
}

module.exports = {
    initializeDb,
    getMatchResults: () => readData(RESULTS_FILE),
    saveMatchResults: (data) => writeData(RESULTS_FILE, data),
    getPredictions: () => readData(PREDICTIONS_FILE),
    savePredictions: (data) => writeData(PREDICTIONS_FILE, data),
    getTickets: () => readData(TICKETS_FILE),
    saveTickets: (data) => writeData(TICKETS_FILE, data),
};