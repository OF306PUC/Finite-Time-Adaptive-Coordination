// browser-ui: on page load
// -> browser-client: get dataTree from server-hub/getDataTree route (server-hub)
// -> browser-ui: render directories dropdown
async function getDataTree() {
  try {
    const response = await fetch('/getDataTree');
    const data = await response.json();
    const dataTree = data;
    renderDataDirectories(dataTree);
  } catch (error) {
    console.error('Error fetching /getDataTree:', error);
  }
}
getDataTree();

// browser-ui: definition of render data directories dropdown auxiliar function
function renderDataDirectories(dataTree) {
  const dropdown = document.getElementById('dropdown');
  dropdown.addEventListener('change', (event) => updateDirectory(event, dataTree));
  dropdown.innerHTML = '<option value="" disabled selected>Select a directory</option>';
  for (const dir in dataTree) {
    const option = document.createElement('option');
    option.value = dir;
    option.textContent = dir;
    dropdown.appendChild(option);
  }
}

// browser-ui: on updateDirectory dropdown
// -> browser-client: fetch json files to server-hub/data/dir/id.json route (server-hub)
// -> browser-ui: display a plot
async function updateDirectory(event, dataTree) {
  const dir = event.target.value;  // Get the selected option's value
  const basepath = `/data/${dir}/`;
  const filenames = Object.keys(dataTree[dir]);
  try {
    let stateTraces = [];
    let vstateTraces = [];
    let varthetaTraces = [];

    for (const filename of filenames) {
      const response = await fetch(basepath + filename);
      const node = await response.json();

      const stateTrace = {
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.state,
        mode: 'lines',
        name: `Node ${node.params.node}`,
        xaxis: 'x',
        yaxis: 'y1'
      };

      const vstateTrace = {
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.vstate,
        mode: 'lines',
        name: `Node ${node.params.node}`,
        xaxis: 'x',
        yaxis: 'y2'
      };

      const varthetaTrace = {
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.vartheta,
        mode: 'lines',
        name: `Node ${node.params.node}`,
        xaxis: 'x',
        yaxis: 'y3'
      };

      stateTraces.push(stateTrace);
      vstateTraces.push(vstateTrace);
      varthetaTraces.push(varthetaTrace);
      eta = node.params.eta / 1000000;

      // Optional: Log extra params if you want to see them
      console.log(`Node ${node.params.node}: lambda=${node.params.lambda}, eta=${node.params.eta}`);
    }

    // Combine traces for the subplot
    const traces = [...stateTraces, ...vstateTraces, ...varthetaTraces];

    // Define the layout for the subplot with 3 rows
    const layout = {
      autosize: true,
      height: 900,
      margin: { l: 48, r: 0, t: 0, b: 36 },
      grid: { rows: 3, columns: 1, shared_xaxes: true, roworder: 'top to bottom' },
      xaxis: { title: 'Time [s]' },
      yaxis1: { title: 'State' },   
      yaxis2: { title: 'VState' },  
      yaxis3: { title: 'Vartheta' }, 
      showlegend: true
    };

    // Define mode bar buttons
    const modeBarButtons = {
      modeBarButtonsToRemove: [],
      modeBarButtonsToAdd: [{
        name: 'Download Image as .svg',
        icon: Plotly.Icons.camera,
        click: function (gd) {
          Plotly.downloadImage(gd, { format: 'svg' });
        }
      }]
    };

    // Plot the combined subplots
    Plotly.newPlot('plot', traces, layout, modeBarButtons);

  } catch (error) {
    console.error('Error fetching /data/<dir>/<id>.json:', error);
  }
}

// browser-ui: on window resize
// -> browser-ui: relayout size of plotly graph
window.onresize = function () {
  Plotly.relayout('plot', {
    'xaxis.autorange': true,
    'yaxis1.autorange': true,
    'yaxis2.autorange': true,
    'yaxis3.autorange': true
  });
};
