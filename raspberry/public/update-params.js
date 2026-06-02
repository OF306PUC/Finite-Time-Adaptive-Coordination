// browser-ui: on page load
// -> browser-client: get params from server-hub/getParams route
// -> browser-ui: render params form
async function getParams() {
  try {
    const response = await fetch('/getParams');
    const data = await response.json();
    const params = data;
    renderParams(params);
  } catch (error) {
    console.error('Error fetching /getParams:', error);
  }
}
getParams();

// browser-ui: definition of render input auxiliar function
function renderInput(key, value, parent, fieldset) {

  // If value is an object and not an array, then call renderInput again recursively
  if (typeof value === 'object' && !Array.isArray(value)) {
    
    // Create the sub-fieldset with its legend and append it to the parent fieldset
    const subFieldset = document.createElement('fieldset');
    subFieldset.dataset.key = key;
    const legend = document.createElement('legend');
    legend.textContent = `${key}: `;
    subFieldset.appendChild(legend);
    fieldset.appendChild(subFieldset);
    
    // Iterate over the object and render the input
    for (const subKey in value) {
      renderInput(subKey, value[subKey], key, subFieldset);
    }
 
  // If the value is a primitive or an array, then render the input
  } else {

    // Define the label
    const label = document.createElement('label');
    label.textContent = `${key}: `;

    // Define the input
    const input = document.createElement('input');
    input.type = typeof value === 'boolean' ? 'checkbox' : 'text';
    input.value = JSON.stringify(value);
    input.checked = typeof value === 'boolean' ? value : undefined;
    input.dataset.parent = parent;
    input.dataset.key = key;

    // Append the elments to the parent fieldset
    fieldset.appendChild(label);
    fieldset.appendChild(input);
    fieldset.appendChild(document.createElement('br'));

  }
}

// browser-ui: definition of render params form auxiliar function
function renderParams(params) {

  // Get the form and clear its content
  const form = document.getElementById('paramsForm');
  form.innerHTML = '';

  // Create the root fieldset with its legend
  const fieldset = document.createElement('fieldset');
  fieldset.dataset.key = 'params';
  const legend = document.createElement('legend');
  legend.textContent = 'params: ';
  fieldset.appendChild(legend);
  form.appendChild(fieldset);

  // Iterate over the params object and render the fields
  for (const key in params) {
    renderInput(key, params[key], 'params', fieldset);
  }
}

// browser-ui: definition of process element auxiliar function
function processElement(element, obj) {

  // If the element is a fieldset, then call processElement again recursively
  if (element.tagName === 'FIELDSET') {
    const key = element.dataset.key;
    obj[key] = {};
    const elements = element.querySelectorAll(':scope > *');
    for (const element of elements) {
      processElement(element, obj[key]);
    }

  // If the element is a an input, then append it to the params object
  } else if (element.tagName === 'INPUT') {
    const key = element.dataset.key;
    obj[key] = JSON.parse(element.type === 'checkbox' ? element.checked : element.value);
  }
}

// browser-ui: on updateParams button
// -> browser-client: post params to server-hub/updateParams route (server-hub)
async function updateParams() {

  // Get the form and the root fieldset
  const form = document.getElementById('paramsForm');
  const fieldset = form.querySelector('fieldset');

  // Create the updated params object from the user form
  let updatedParams = {};
  const elements = fieldset.querySelectorAll(':scope > *');
  for (const element of elements) {
    processElement(element, updatedParams);
  }

  // Post the updated params to the hub-server
  try {
    const response = await fetch('/updateParams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedParams)
    });
    const data = await response.json();
    alert(data.message);
  } catch (error) {
    console.error('Error fetching /updateParams:', error);
  }
}
