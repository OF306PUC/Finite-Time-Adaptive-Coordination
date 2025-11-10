const { SerialPort, ReadlineParser } = require('serialport')

// Define configuration parameters
const SERIAL_PATH = '/dev/ttyACM0'
const SERIAL_BAUD = 115200
const SERIAL_DELAY = 500; // ms

// Define the port and the parser
const port = new SerialPort({path: SERIAL_PATH, baudRate: SERIAL_BAUD})
const parser = port.pipe(new ReadlineParser())

// Auxiliar function to write data with the asyc/await style
function serialWrite(msg) {
  return new Promise((resolve, reject) => {
    // Log the data being sent for debugging
    console.log(`[SERIAL TX]: ${msg.trim()}`);
    port.write(msg, (err) => {
      if (err) {
        reject(`Error sending data: ${err}`);  // Reject if there's an error
      } else {
        resolve(); // Resolve on success
      }
    });
  });
}

// Auxiliar function to explicitly wait for the transmission buffer to clear
function serialDrain() {
    return new Promise((resolve, reject) => {
        port.drain((err) => {
            if (err) {
                reject(`Error draining port: ${err}`);
            } else {
                resolve();
            }
        });
    });
}

// Auxiliar function for an async/await delay (500ms)
function serialDelay() {
  return new Promise(resolve => setTimeout(resolve, SERIAL_DELAY));
}

// Export the necessary objects and functions
module.exports = { parser, serialWrite, serialDelay, serialDrain };
