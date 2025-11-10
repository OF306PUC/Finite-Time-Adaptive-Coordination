const fs = require('fs').promises;

const DATA_PATH = './data/';

let filepath = DATA_PATH + 'dummy.json';
let isFirstLine = true;
let isEnable = false;

// 🆕 Private variable to store the last successfully logged state object
let lastGoodState = null;

// Create data directory if it does not exist
fs.mkdir(DATA_PATH, { recursive: true })


// Function to update the local private filepath variable
function loggerUpdateFilename(filename) {
    filepath = DATA_PATH + filename;
}

// Function to start the logger file with the initial parameters
async function loggerStart(params) {
    try {
        isEnable = true;
        isFirstLine = true;
        // 🆕 Reset lastGoodState on logger start
        lastGoodState = null;

        await fs.writeFile(filepath, '{\n');
        await fs.appendFile(filepath, '"params":' + JSON.stringify(params) + ',\n');
        await fs.appendFile(filepath, '"data": [');
    } catch (error) {
        console.error('Error starting logger file: ', error);
    }
}

// Function to write the data lines of the .json logger file
async function loggerLine(state) {
    if (!isEnable) return;

    try {
        // 🆕 1. Create a deep copy of the current state or last good state
        // 📝 Use state if it's the first sample, otherwise use the substitution logic
        let stateToLog = lastGoodState ? { ...lastGoodState, ...state } : state;

        // 🆕 2. Substitution Logic: Replace null/undefined values with values from lastGoodState
        // This is only relevant after the first good sample has been logged.
        if (lastGoodState) {
            for (const key in stateToLog) {
                // If a value is null or undefined, replace it with the last known good value
                if (stateToLog[key] === null || stateToLog[key] === undefined) {
                    if (lastGoodState[key] !== null && lastGoodState[key] !== undefined) {
                         stateToLog[key] = lastGoodState[key];
                    }
                    // Special handling for neighborVStates array
                    if (key === 'neighborVStates' && Array.isArray(stateToLog[key])) {
                        for (let i = 0; i < stateToLog[key].length; i++) {
                            if (stateToLog[key][i] === null || stateToLog[key][i] === undefined) {
                                stateToLog[key][i] = lastGoodState.neighborVStates[i];
                            }
                        }
                    }
                }
            }
        }

        // 🆕 3. After potential substitution, check if the resulting object is valid
        // (i.e., not entirely null/undefined, which would happen on the very first null sample)
        const isStateValid = stateToLog.timestamp !== null && stateToLog.timestamp !== undefined;

        if (isStateValid) {
            // 🆕 4. Update lastGoodState with the current, substituted, or original good state
            // Only update with a *fully* non-null/non-undefined value if it's the first sample.
            // After the first, update lastGoodState with all the *non-null* values from stateToLog.
            if (!lastGoodState) {
                lastGoodState = stateToLog; // First successful log
            } else {
                // Update specific keys in lastGoodState only if the corresponding value in stateToLog is not null/undefined
                for (const key in stateToLog) {
                     if (stateToLog[key] !== null && stateToLog[key] !== undefined) {
                        lastGoodState[key] = stateToLog[key];
                    }
                    if (key === 'neighborVStates' && Array.isArray(stateToLog[key])) {
                        for (let i = 0; i < stateToLog[key].length; i++) {
                            if (stateToLog[key][i] !== null && stateToLog[key][i] !== undefined) {
                                lastGoodState.neighborVStates[i] = stateToLog[key][i];
                            }
                        }
                    }
                }
            }
        } else {
            // Skip logging entirely if the current sample, even after substitution, is invalid
            // (e.g., if the timestamp is null and there's no lastGoodState to pull from)
            console.warn('Skipping line: timestamp is null/undefined and no last good state available.');
            return;
        }

        // 5. Array Preparation (using the potentially substituted stateToLog)
        const arr = [
            stateToLog.timestamp,
            stateToLog.state,
            stateToLog.vstate,
            stateToLog.vartheta,
            ...(stateToLog.neighborVStates || [])
        ];

        // 6. File writing logic (unchanged)
        if (isFirstLine) {
            await fs.appendFile(filepath, '\n' + JSON.stringify(arr));
            isFirstLine = false;
        } else {
            await fs.appendFile(filepath, ',\n' + JSON.stringify(arr));
        }

    } catch (error) {
        console.error('Error writing to logger file: ', error);
    }
}

// Function to write the last part of the .json logger file
async function loggerEnd() {
    try {
        if (isEnable) {
            await fs.appendFile(filepath, '\n]\n}');
            isFirstLine = false;
            isEnable = false;
            lastGoodState = null; // 🆕 Clean up
            // ... (rest of the loggerEnd function remains the same)
            
            const rawData = await fs.readFile(filepath, { encoding: 'utf8' });
            let objData = JSON.parse(rawData);

            if (objData.data.length > 0) {
                let dataTransposed = objData.data[0].map((_, i) => objData.data.map(row => row[i]));
                objData.data = {};
                objData.data.timestamp = dataTransposed[0];
                objData.data.state = dataTransposed[1];
                objData.data.vstate = dataTransposed[2];
                objData.data.vartheta = dataTransposed[3];
                for (let i in objData.params.neighbors) {
                    objData.data[objData.params.neighbors[i]] = dataTransposed[parseInt(i) + 4];
                }
            }
            await fs.writeFile(filepath, JSON.stringify(objData, null, 2), 'utf8');
        }
    } catch (error) {
        console.error('Error ending logger file: ', error);
    }
}

// Exports:
module.exports = {
    loggerUpdateFilename,
    loggerStart,
    loggerLine,
    loggerEnd
};