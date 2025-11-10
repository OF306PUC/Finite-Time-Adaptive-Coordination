# 🧠 Consensus Platform

This repository implements a **consensus algorithm** across a heterogeneous IoT network composed of **Raspberry Pi 4** devices and **Nordic nRF52-DK** boards.  
Communication between agents occurs through **Wi-Fi** and **Bluetooth Low Energy (BLE)** links.

---

## ⚙️ System Overview

The project includes several coordinated components:

- **Node:**  
  A physical hardware unit composed of a Raspberry Pi connected via USB to an nRF52-DK board.

- **Edge-device:**  
  A logical process running inside a node.  
  Each node can host up to **three edge-devices**, one per communication type:
  - `ble` → BLE process (advertises and listens)
  - `wifi` → Wi-Fi process (HTTP client/server)
  - `bridge` → bridge process (links BLE and Wi-Fi subnetworks)

- **Router:**  
  Provides the local Wi-Fi LAN for inter-node communication.

- **Hub server:**  
  Runs on a laptop and is responsible for configuring network parameters, broadcasting experiment triggers, and coordinating all edge-devices.

- **User Interface (UI):**  
  A web dashboard available at `http://localhost:3000` on the same laptop as the hub server.  
  It allows configuring algorithms, launching experiments, and visualizing results.

---

## 🚀 Implementation Steps

### 1. Flash the nRF52-DK firmware

1. Build and flash the firmware located in  
   `/consensus/nordic`.  
   Use **Nordic SDK 2.7.0**.
2. Refer to the [Nordic DevAcademy courses](https://academy.nordicsemi.com/) for instructions on installing toolchains and flashing via nRF Connect or `nrfutil`.

---

### 2. Prepare the Raspberry Pi devices

1. Flash each SD card with **Raspbian Bookworm OS** and enable the **SSH server**.  
   Default credentials:
   ```bash
   username: ---
   password: ---
   ```
2. Install required packages:
   ```bash
   sudo apt update
   sudo apt install expect
   ```
3. Install Node Version Manager (NVM) and Node.js:
   ```bash
   nvm install 0.40.1
   nvm use 0.40.1
   nvm install 22.11.0
   ```
4. Connect to the LAN via Wi-Fi:
   ```bash
   sudo raspi-config
   ```
   Then verify and note the IP address:
   ```bash
   ip a
   ```

---

### 3. Deploy the Raspberry Pi code

1. Copy all files from `/consensus/raspberry` to each Raspberry Pi (omit `node_modules` and `package-lock.json`).  
2. Install dependencies:
   ```bash
   cd ~/Desktop/consensus/raspberry
   npm install
   ```
3. Ensure the script `bleadv.sh` is executable:
   ```bash
   chmod +x raspberry/bleadv.sh
   ```

---

### 4. Configure the laptop (hub host)

On your laptop:
- Clone or copy the repository to `~/Desktop/consensus/raspberry`.
- Install Node.js and NVM (no need for `expect`).
- Ensure you are connected to the same router LAN as the Raspberry Pis.

---

### 5. Create the physical nodes

Attach each **nRF52-DK** board to a **Raspberry Pi** using a USB cable.  
Repeat for every node.  
You can SSH into each node using its IP address and credentials.

---

### 6. Run the edge-device processes

For each node:

1. Open **three terminal windows** and navigate to:
   ```bash
   cd ~/Desktop/consensus/raspberry
   ```
2. Launch the edge-device processes:
   ```bash
   node back ble
   node back wifi
   node back bridge
   ```

---

### 7. Configure the network topology

Edit `~/Desktop/consensus/raspberry/net.js` and modify the `NODES` variable to match your desired topology.

Example (9-node cluster):
```js
// Example topology
//       3 --- 9
//        \   /
//          6
//        /   \
// 7 --- 1     8 --- 2
//  \   /       \   /
//    4           5
```

---

### 8. Launch the hub server

1. On your laptop, open a new terminal:
   ```bash
   cd ~/Desktop/consensus/raspberry
   node hub
   ```
2. Open a browser at [http://localhost:3000](http://localhost:3000).

**Tip:** Press the reset button on all nRF52-DK boards before starting new experiments to ensure a clean state.

In the UI:
- Enter a test name, enable the trigger, and click **Update Params**.

---

### 9. Observe and collect results

When the algorithm converges (visible in the UI), stop the test by unchecking the trigger box and clicking **Update Params**.  
Then go to **Data History → [your test name]** to view and analyze your results.

---

## 📊 Example Results

Using the following topology:

```js
// 9-node cluster
//       3 --- 9
//        \   /
//          6
//        /   \
// 7 --- 1     8 --- 2
//  \   /       \   /
//    4           5
```

```js
TOPOLOGY = [
  {id: 1, ip: '192.168.0.136', type: TYPE_BLE,    enabled: true,  neighbors: [4,6,7],   clock: 200},
  {id: 2, ip: '192.168.0.136', type: TYPE_WIFI,   enabled: true,  neighbors: [5,8],     clock: 200},
  {id: 3, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled: true,  neighbors: [6,9],     clock: 200},
  {id: 4, ip: '192.168.0.101', type: TYPE_BLE,    enabled: true,  neighbors: [1,7],     clock: 200},
  {id: 5, ip: '192.168.0.101', type: TYPE_WIFI,   enabled: true,  neighbors: [2,8],     clock: 200},
  {id: 6, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled: false, neighbors: [1,3,8,9], clock: 200},
  {id: 7, ip: '192.168.0.134', type: TYPE_BLE,    enabled: true,  neighbors: [1,4],     clock: 200},
  {id: 8, ip: '192.168.0.134', type: TYPE_WIFI,   enabled: true,  neighbors: [2,5,6],   clock: 200},
  {id: 9, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled: true,  neighbors: [3,6],     clock: 200},
];
```

Initially, node 6 is disconnected from the network.  
At second 30 (or 60), node 6 reconnects, demonstrating the algorithm’s robustness to dynamic topology changes.

---

## 🧩 Folder Structure

```
consensus/
├── nordic/          # nRF52 firmware source (Zephyr-based)
├── raspberry/       # Node.js applications for BLE, Wi-Fi, and bridge agents
├── hub/             # Web server and UI
└── docs/            # Documentation and topology examples
```

---

## 🧠 Credits

Developed as part of the **Time Synchronization and Finite-Time Consensus** project  
at the **Cyber-Physical Systems Laboratory**,  
**Pontificia Universidad Católica de Chile**.
