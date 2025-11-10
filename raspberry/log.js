const fs = require('fs').promises; 

const DATA_PATH ='./data/'; 

let filepath = DATA_PATH + 'dummy.json'; 
let isFirstLine = true; 
let isEnable = false; 

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

        await fs.writeFile(filepath, '{\n'); 
        await fs.appendFile(filepath, '"params":' + JSON.stringify(params) + ',\n');
        await fs.appendFile(filepath, '"data": [');
    } catch (error) {
        console.error('Error starting logger file: ', error);
    }
}

// Function to write the data lines of the .json logger file 
async function loggerLine(state) {
    try {
        const arr = [
            state.timestamp, 
            state.state, 
            state.vstate, 
            state.vartheta, 
            ...state.neighborVStates
        ]; 

        if (isEnable) {
            if (isFirstLine) {
                await fs.appendFile(filepath, '\n' + JSON.stringify(arr));
                isFirstLine = false;
            } else {
                await fs.appendFile(filepath, ',\n' + JSON.stringify(arr));
            }
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
