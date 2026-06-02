async function getDataTree() {
  try {
    const response = await fetch('/getDataTree');
    const dataTree = await response.json();
    renderDataDirectories(dataTree);
  } catch (error) {
    console.error('Error fetching /getDataTree:', error);
  }
}
getDataTree();

function isFilesOnly(subtree) {
  return Object.values(subtree).every(v => v === null);
}

function renderDataDirectories(dataTree) {
  const dropdown = document.getElementById('dropdown');
  const runDropdown = document.getElementById('run-dropdown');

  dropdown.innerHTML = '<option value="" disabled selected>Select an experiment</option>';
  if (runDropdown) runDropdown.innerHTML = '<option value="" disabled selected>Select a run</option>';

  for (const dir in dataTree) {
    const option = document.createElement('option');
    option.value = dir;
    option.textContent = dir;
    dropdown.appendChild(option);
  }

  dropdown.addEventListener('change', () => {
    const dir = dropdown.value;
    const subtree = dataTree[dir];

    if (isFilesOnly(subtree)) {
      // Single-run: files directly under experiment dir
      if (runDropdown) {
        runDropdown.innerHTML = '<option value="" disabled selected>Select a run</option>';
        runDropdown.style.display = 'none';
      }
      loadAndPlot(`/data/${dir}/`, subtree);
    } else {
      // Multi-run: subtree keys are run directories
      if (runDropdown) {
        runDropdown.style.display = '';
        runDropdown.innerHTML = '<option value="" disabled selected>Select a run</option>';
        for (const run in subtree) {
          const opt = document.createElement('option');
          opt.value = run;
          opt.textContent = run;
          runDropdown.appendChild(opt);
        }
        runDropdown.onchange = () => {
          const run = runDropdown.value;
          loadAndPlot(`/data/${dir}/${run}/`, subtree[run]);
        };
      }
    }
  });
}

async function loadAndPlot(basepath, fileTree) {
  const filenames = Object.keys(fileTree).filter(f => f.endsWith('.json') && f !== 'meta.json' && f !== 'hub_snapshot.json');
  if (filenames.length === 0) { console.warn('No node data files found in', basepath); return; }

  try {
    let stateTraces = [], vstateTraces = [], varthetaTraces = [];
    let eta;

    for (const filename of filenames) {
      const response = await fetch(basepath + filename);
      const node = await response.json();
      stateTraces.push({
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.state,
        mode: 'lines',
        name: `Node ${node.params.node}`
      });
      vstateTraces.push({
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.vstate,
        mode: 'lines',
        name: `Node ${node.params.node}`
      });
      varthetaTraces.push({
        x: node.data.timestamp.map(i => i / 1000),
        y: node.data.vartheta,
        mode: 'lines',
        name: `Node ${node.params.node}`
      });
      eta = node.params.eta / 1000000;
    }

    const modeBarButtons = {
      modeBarButtonsToRemove: [],
      modeBarButtonsToAdd: [{
        name: 'Download Image as .svg',
        icon: Plotly.Icons.camera,
        click: (gd) => Plotly.downloadImage(gd, { format: 'svg' })
      }]
    };

    Plotly.newPlot('statePlot',    stateTraces,    { autosize: true, title: 'Consensus Algorithm.', xaxis: { title: 'Time [s]' }, yaxis: { title: 'State' } },    modeBarButtons);
    Plotly.newPlot('vstatePlot',   vstateTraces,   { autosize: true, title: 'Consensus Algorithm.', xaxis: { title: 'Time [s]' }, yaxis: { title: 'Vstate' } },   modeBarButtons);
    Plotly.newPlot('varthetaPlot', varthetaTraces, { autosize: true, title: `Consensus Algorithm. η = ${eta}`, xaxis: { title: 'Time [s]' }, yaxis: { title: 'Vartheta' } }, modeBarButtons);
  } catch (error) {
    console.error('Error fetching node data:', error);
  }
}

window.onresize = function () {
  Plotly.relayout('statePlot',    { 'xaxis.autorange': true, 'yaxis.autorange': true });
  Plotly.relayout('vstatePlot',   { 'xaxis.autorange': true, 'yaxis.autorange': true });
  Plotly.relayout('varthetaPlot', { 'xaxis.autorange': true, 'yaxis.autorange': true });
};
