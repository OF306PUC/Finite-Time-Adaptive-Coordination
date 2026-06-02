const path = require('path');
const fs = require('fs').promises;

const DATA_PATH = path.join(__dirname, 'data');
let tree = {};

fs.mkdir(DATA_PATH, { recursive: true });

function dataGetTree() {
    return tree;
}

// Writes data to data/<dirPath>/<id>.json — dirPath can contain slashes for nesting.
async function dataWriteFile(data, dirPath, id) {
    const dir = path.join(DATA_PATH, dirPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2), 'utf8');
}

// Recursively builds the tree up to depth 2 (experiment → run → files).
async function buildTree(dirPath, depth) {
    const obj = {};
    let entries;
    try { entries = await fs.readdir(dirPath); }
    catch { return obj; }
    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        let stats;
        try { stats = await fs.stat(entryPath); }
        catch { continue; }
        if (stats.isDirectory() && depth < 2) {
            obj[entry] = await buildTree(entryPath, depth + 1);
        } else if (stats.isFile()) {
            obj[entry] = null;
        }
    }
    return obj;
}

async function dataUpdateTree() {
    tree = await buildTree(DATA_PATH, 0);
}

dataUpdateTree();

module.exports = { dataGetTree, dataUpdateTree, dataWriteFile };
