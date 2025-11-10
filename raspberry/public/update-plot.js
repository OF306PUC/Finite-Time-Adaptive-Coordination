// io-client: connect to the io-server (server-hub)
const socket = io();

// Define some plot configurations
const MAX_PLOT_POINTS = 20;
const COLORS = [
  'red', 'blue', 'green', 'yellow', 'orange',
  'purple', 'brown', 'pink', 'cyan', 'magenta',
  'lime', 'indigo', 'violet', 'black', 'gray',
  'silver', 'gold'
]; // Make sure you have enough colors for all nodes

// Define the plot layouts
const stateLayout = {
  autosize: true,
  title: 'Server States',
  xaxis: { title: 'Time [s]' },
  yaxis: { title: 'State' },
};
const vstateLayout = {
  autosize: true,
  title: 'Server VStates',
  xaxis: { title: 'Time [s]' },
  yaxis: { title: 'VState' },
};
const varthetaLayout = {
  autosize: true,
  title: 'Server Varthetas',
  xaxis: { title: 'Time [s]' },
  yaxis: { title: 'Vartheta' },
};

// browser-ui: on page load -> get backend IDs and render plots
async function getBackendIds() {
  try {
    const response = await fetch('/getBackendIds');
    const BACKEND_IDS = await response.json();
    renderPlot(BACKEND_IDS);
  } catch (error) {
    console.error('Error fetching /getBackendIds:', error);
  }
}
getBackendIds();

// Render plots for each backend ID
function renderPlot(BACKEND_IDS) {
  // Initialize data arrays for each server
  const serverData = BACKEND_IDS.map(() => ({
    time: [],
    state: [],
    vstate: [],
    vartheta: [],
  }));

  // Initialize traces
  const stateTraces = BACKEND_IDS.map((id, i) => ({
    x: serverData[i].time,
    y: serverData[i].state,
    type: 'scatter',
    mode: 'lines',
    name: `Server ${id}`,
    line: { color: COLORS[i] },
  }));
  const vstateTraces = BACKEND_IDS.map((id, i) => ({
    x: serverData[i].time,
    y: serverData[i].vstate,
    type: 'scatter',
    mode: 'lines',
    name: `Server ${id}`,
    line: { color: COLORS[i] },
  }));
  const varthetaTraces = BACKEND_IDS.map((id, i) => ({
    x: serverData[i].time,
    y: serverData[i].vartheta,
    type: 'scatter',
    mode: 'lines',
    name: `Server ${id}`,
    line: { color: COLORS[i] },
  }));

  Plotly.newPlot('statePlot', stateTraces, stateLayout);
  Plotly.newPlot('vstatePlot', vstateTraces, vstateLayout);
  Plotly.newPlot('varthetaPlot', varthetaTraces, varthetaLayout);

  // Listen for updates from each backend server
  BACKEND_IDS.forEach((id, i) => {
    socket.on(`state${id}`, (state) => {
      console.log(`Received from IO-Server-${id}: `, state);

      const timestampSec = state.timestamp / 1000;
      serverData[i].time.push(timestampSec);
      serverData[i].state.push(state.state);
      serverData[i].vstate.push(state.vstate);
      serverData[i].vartheta.push(state.vartheta);

      if (serverData[i].time.length > MAX_PLOT_POINTS) {
        serverData[i].time.shift();
        serverData[i].state.shift();
        serverData[i].vstate.shift();
        serverData[i].vartheta.shift();
      }

      Plotly.update('statePlot', {
        x: [serverData[i].time],
        y: [serverData[i].state],
      }, {}, [i]);

      Plotly.update('vstatePlot', {
        x: [serverData[i].time],
        y: [serverData[i].vstate],
      }, {}, [i]);

      Plotly.update('varthetaPlot', {
        x: [serverData[i].time],
        y: [serverData[i].vartheta],
      }, {}, [i]);
    });
  });
}

// browser-ui: handle window resize
window.onresize = function () {
  Plotly.relayout('statePlot', { 'xaxis.autorange': true, 'yaxis.autorange': true });
  Plotly.relayout('vstatePlot', { 'xaxis.autorange': true, 'yaxis.autorange': true });
  Plotly.relayout('varthetaPlot', { 'xaxis.autorange': true, 'yaxis.autorange': true });
};
