const fs = require('fs');
const path = require('path');

const stateFilePath = path.join(__dirname, 'state.json');

function loadState() {
    if (fs.existsSync(stateFilePath)) {
        try {
            const fileContent = fs.readFileSync(stateFilePath, 'utf-8');
            return JSON.parse(fileContent);
        } catch (e) {
            return { leagues: {} };
        }
    }
    return { leagues: {} };
}

function saveState(newState) {
    fs.writeFileSync(stateFilePath, JSON.stringify(newState, null, 2));
}

module.exports = { loadState, saveState };