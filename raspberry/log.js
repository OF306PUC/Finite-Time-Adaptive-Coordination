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
        // Row format:
        //   [timestamp, state, vstate, vartheta,
        //    nb0_vstate, nb0_received,  nb1_vstate, nb1_received, ...]
        // received: 1 = fresh update, 0 = cache hit (missed packet)
        const nbVStates   = state.neighborVStates  ?? [];
        const nbReceived  = state.neighborReceived ?? nbVStates.map(() => 1);
        const nbInterleaved = nbVStates.flatMap((v, i) => [v, nbReceived[i] ? 1 : 0]);

        const arr = [
            state.timestamp,
            state.state,
            state.vstate,
            state.vartheta,
            ...nbInterleaved
        ];

        if (isEnable) {
            if (isFirstLine) {
                isFirstLine = false;
                await fs.appendFile(filepath, '\n' + JSON.stringify(arr));
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
                objData.data.state     = dataTransposed[1];
                objData.data.vstate    = dataTransposed[2];
                objData.data.vartheta  = dataTransposed[3];
                // Neighbour columns are interleaved: [nb0_vstate, nb0_received, nb1_vstate, ...]
                // Fall back to legacy single-column layout if row length matches old format.
                const nNeighbors = objData.params.neighbors.length;
                const isNewFormat = dataTransposed.length >= 4 + nNeighbors * 2;
                for (let i = 0; i < nNeighbors; i++) {
                    const id = objData.params.neighbors[i];
                    if (isNewFormat) {
                        objData.data[id]           = dataTransposed[4 + i * 2];      // vstate received
                        objData.data[`rx_${id}`]   = dataTransposed[4 + i * 2 + 1]; // 1=fresh, 0=missed
                    } else {
                        // Legacy: single vstate column per neighbour (no received flag)
                        objData.data[id] = dataTransposed[4 + i];
                    }
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
