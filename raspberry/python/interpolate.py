#%% Simulate the local model to generate data for interpolation
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

SCALE_FACTOR = 1e6

neighbors = {
    0: [2, 3, 21],       
    1: [1, 4],           
    2: [1, 5],           
    3: [2, 5, 6],  
    4: [3, 4, 7],        
    5: [4, 7, 8],        
    6: [5, 6, 9],        
    7: [6, 10],          
    8: [7, 10],          
    9: [8, 9, 30],       
    10: [12, 13, 21],     
    11: [11, 14],         
    12: [11, 15],         
    13: [12, 15, 16],     
    14: [13, 14, 17],     
    15: [14, 17, 18],     
    16: [15, 16, 19],     
    17: [16, 20],         
    18: [17, 20],         
    19: [18, 19, 30],     
    20: [1, 11, 22, 23], 
    21: [21, 24],         
    22: [21, 25],         
    23: [22, 25, 26],     
    24: [23, 24, 27],     
    25: [24, 27, 28],     
    26: [25, 26, 29],     
    27: [26, 30],         
    28: [27, 30],         
    29: [10, 20, 28, 29],
}

# Load graph-agent data from csv: {x0, z0, id, neighbors, enabled}
NODES = {}
_nodes = pd.read_csv("../data/initial_conditions.csv")

num_nodes = 30
for i in range(num_nodes):
    node_id = int(_nodes.iloc[i]['id'])
    x0 = float(_nodes.iloc[i]['state']) / SCALE_FACTOR
    z0 = float(_nodes.iloc[i]['vstate']) / SCALE_FACTOR
    enabled = int(_nodes.iloc[i]['enabled'])
    NODES[node_id] = {
        'x0': x0,
        'z0': z0,
        'neighbors': neighbors[i],
        'enabled': enabled
    }


# Use local model to generate the first 10 seconds of data: 
# >> consider using the same integration time step
# >> consider using the same Ts for data Tx/Rx and logging

#% >>> System parameters: 
## Simulation:
T        = 6.0
dt       = 0.001
time     = np.arange(0, T, dt)
n_points = len(time)
n_agents = len(NODES)

## Adaptive gain: 
omega                 = 1.0     # Timer oscillator frequency (rad/s) --> slope 1s/1s
eta                   = 0.5     # adaptation gain
freeze_threshold_off  = 0.010   # error-threshold to freeze gain evolution ("ε" in paper)
freeze_threshold_on   = 0.050   # error-threshold to re-activate gain evolution ("ε̄" in paper)
active                = np.zeros(n_agents)  # Initially, all agents are inactive

params = {
    "dt":            dt,
    "omega":         omega,
    "n_points":      n_points,
    "n_agents":      n_agents,
    "eta":           eta,
    "epsilon_off":   freeze_threshold_off,
    "epsilon_on":    freeze_threshold_on,
    "active":        active,
    "nodes":         NODES,
}

## Disturbance: bounded known input
alpha   = 0.0
beta    = 0.0
kappa   = 0.0
phi     = np.random.uniform(0, 1, (n_agents, n_points)) 
nu = np.random.uniform(-alpha, alpha, (n_agents, n_points)) + beta + kappa * np.sin(2*np.pi*10*(time - phi))  

## Initial conditions:
init_conditions = {
    "x": np.array([NODES[i+1]['x0'] for i in range(n_agents)]),
    "z": np.array([NODES[i+1]['z0'] for i in range(n_agents)]),
    "vtheta": np.zeros(n_agents)  # Initial adaptive gains
}

def plot_states(t, x, z, vartheta, params, ref_state_num=1):
    """
    Plot x, z, and vartheta states for all agents with distinct markers and colors.
    """
    n_agents = params["n_agents"]

    # Trim last time step (if necessary)
    t = t[:-1]
    x = x[:, :-1]
    z = z[:, :-1]
    vartheta = vartheta[:, :-1]

    # Define markers and color cycle
    markers = ['o', 'x', '*', 's', 'd', '^', 'v', '<', '>', 'p', 'h']
    cmap = plt.colormaps['tab10']
    colors = [cmap(i % 10) for i in range(n_agents)]

    fig, axs = plt.subplots(3, 1, figsize=(12, 9), sharex=True)

    # --- Top subplot: states x_i ---
    for i in range(n_agents):
        axs[0].plot(
            t, x[i, :],
            label=f'$x_{{{i+1}}}$',
            linewidth=1.25,
            color=colors[i],
            marker=markers[i % len(markers)],
            markersize=4,
            alpha=0.9
        )
    axs[0].plot(
        t, z[ref_state_num-1, :],
        '--', color='black', linewidth=2.0,
        label=f'$z_{{{ref_state_num}}}$ (ref.)'
    )
    axs[0].set_title('States $x_i$')
    axs[0].set_ylabel('$x(t)$')
    axs[0].grid(True, linestyle='--', alpha=0.6)
    axs[0].legend(ncol=3, fontsize=9)

    # --- Middle subplot: reference states z_i ---
    for i in range(n_agents):
        axs[1].plot(
            t, z[i, :],
            label=f'$z_{{{i+1}}}$',
            linewidth=1.25,
            color=colors[i],
            marker=markers[i % len(markers)],
            markersize=4,
            alpha=0.9
        )
    axs[1].set_title('Reference states $z_i$')
    axs[1].set_ylabel('$z(t)$')
    axs[1].grid(True, linestyle='--', alpha=0.6)
    axs[1].legend(ncol=3, fontsize=9)

    # --- Bottom subplot: adaptive gains vartheta_i ---
    for i in range(n_agents):
        axs[2].plot(
            t, vartheta[i, :],
            label=f'$\\vartheta_{{{i+1}}}$',
            linewidth=1.25,
            color=colors[i],
            marker=markers[i % len(markers)],
            markersize=4,
            alpha=0.9
        )
    axs[2].set_title('Adaptive gains $\\vartheta_i$')
    axs[2].set_xlabel('Time (s)')
    axs[2].set_ylabel('$\\vartheta(t)$')
    axs[2].grid(True, linestyle='--', alpha=0.6)

    plt.tight_layout()
    plt.show()

def vi(i, z, neighbors): 
    diffs = z[i] - z[neighbors]
    return -np.sum(np.sign(diffs) * np.sqrt(np.abs(diffs)))

def dyn2sample(t, y, g, nu, n_agents, dvth, params, sample_points): 
    dydt = np.zeros_like(y)

    x = y[:n_agents]
    z = y[n_agents:2*n_agents]
    vtheta = y[2*n_agents:3*n_agents]

    sigma = x - z
    grad = np.sign(sigma)

    dvtheta = np.zeros(n_agents)
    for i in range(n_agents):
        if params["nodes"][i+1]['enabled'] == 1:
            if params["active"][i] == 0: 
                if np.abs(sigma[i]) > params["epsilon_on"]:
                    params["active"][i] = 1
                    dvtheta[i] = params["eta"] * 1.0
                else: 
                    dvtheta[i] = 0.0

            else:
                if np.abs(sigma[i]) <= params["epsilon_off"]:
                    params["active"][i] = 0
                    dvtheta[i] = 0.0
                else:
                    dvtheta[i] = params["eta"] * 1.0

    u = g - vtheta * grad
    dxdt = u + nu
    dzdt = g    # consensus law
    dvthdt = dvtheta

    k = int(t / params["dt"])
    if k < sample_points:
        dvth[:,k] = dvthdt

    dydt[:n_agents] = dxdt
    dydt[n_agents:2*n_agents] = dzdt
    dydt[2*n_agents:3*n_agents] = dvthdt
    return dydt


def simulate_sampled_dynamics_euler(params, init_conditions, sample_time=0.2):
    n_points = params["n_points"]
    n_agents = params["n_agents"]
    dt = params["dt"]

    # Full trajectories
    x = np.zeros((n_agents, n_points))
    z = np.zeros((n_agents, n_points))
    vtheta = np.zeros((n_agents, n_points))

    # Initial condition vector
    y = np.concatenate(
        [init_conditions["x"], init_conditions["z"], init_conditions["vtheta"]]
    )

    v = np.zeros(n_agents)

    # Sampling setup
    sample_interval = int(sample_time / dt)   # how many steps between samples
    sample_points = n_points // sample_interval
    xs = np.zeros((n_agents, sample_points))
    zs = np.zeros((n_agents, sample_points))
    vthetas = np.zeros((n_agents, sample_points))
    dvthetas = np.zeros((n_agents, sample_points))
    
    t = 0.0
    for k in range(n_points):

        # Store full trajectory
        x[:, k] = y[:n_agents]
        z[:, k] = y[n_agents:2*n_agents]
        vtheta[:, k] = y[2*n_agents:3*n_agents]

        if k % sample_interval == 0:
            print(f"Simulating time: {t:.2f}s / {T:.2f}s", end='\r')

            for i in range(n_agents):

                if params["nodes"][i+1]['enabled'] == 1:
                    neighbors = params["nodes"][i+1]['neighbors']
                    neighbors_index = []
                    for n in neighbors:
                        if params["nodes"][n]['enabled'] == 1:
                            neighbors_index.append(n-1)
                    v[i] = vi(i, z[:, k], neighbors_index)

            sample_idx = k // sample_interval
            if sample_idx < sample_points:
                xs[:, sample_idx] = x[:, k]
                zs[:, sample_idx] = z[:, k]
                vthetas[:, sample_idx] = vtheta[:, k]

        # Euler integration step
        dydt = dyn2sample(t, y, v, nu[:, k], n_agents, dvthetas, params, sample_points)
        y = y + dt * dydt
        t += dt

    return xs, zs, vthetas, dvthetas, sample_points

x, z, vtheta, dvtheta, sample_points = simulate_sampled_dynamics_euler(params, init_conditions)
t = np.linspace(0, T, sample_points)
plot_states(t, x, z, vtheta, params, ref_state_num=1)

states_file = "../data/30node-clusters/x.csv"
vstates_file = "../data/30node-clusters/z.csv"
vartheta_file = "../data/30node-clusters/vartheta.csv"
np.savetxt(states_file, x.T, delimiter=",", fmt='%f')
np.savetxt(vstates_file, z.T, delimiter=",", fmt='%f')
np.savetxt(vartheta_file, vtheta.T, delimiter=",", fmt='%f')

#%% Do the actual interpolation
NUM_NODE = 21

states_file = "../data/30node-clusters/x.csv"
vstates_file = "../data/30node-clusters/z.csv"
vartheta_file = "../data/30node-clusters/vartheta.csv"

x = pd.read_csv(states_file, header=None).to_numpy()
x_gen1 = x[:,NUM_NODE-1]
z = pd.read_csv(vstates_file, header=None).to_numpy()
z_gen1 = z[:,NUM_NODE-1]
vartheta = pd.read_csv(vartheta_file, header=None).to_numpy()
vartheta_gen1 = vartheta[:,0]

x_samples = x.shape[1]
z_samples = z.shape[1]
vartheta_samples = vartheta.shape[1]

Ts = 0.2
time_gen = np.arange(0, Ts * x_samples, Ts)

# Original time vector (sampled)
node1 = pd.read_csv(f"data/30node-clusters-csv/node_{NUM_NODE}.csv")
timestamp = node1['timestamp'].to_numpy()
time = timestamp[:x_samples] / 1000.0  
x1 = node1['state'].to_numpy()
x1 = x1[:x_samples] / SCALE_FACTOR  
z1 = node1['vstate'].to_numpy()
z1 = z1[:z_samples] / SCALE_FACTOR 
vartheta1 = node1['vartheta'].to_numpy()
vartheta1 = vartheta1[:vartheta_samples] / SCALE_FACTOR

fig, axs = plt.subplots(4, 1, figsize=(12, 9), sharex=True)
# --- Top subplot: states x_i ---
axs[0].plot(time_gen, x_gen1, '-', label='Node 1 Gen x', linewidth=1.4, marker="o", markersize=4, alpha=0.7)
axs[0].plot(time, x1, '-', label='Node 1 Sampled x', linewidth=1.4, marker="x", markersize=4, alpha=0.7)
# --- Middle subplot: reference states z_i ---
axs[1].plot(time_gen, z_gen1, '-', label='Node 1 Gen z', linewidth=1.4, marker="o", markersize=4, alpha=0.7)
axs[1].plot(time, z1, '-', label='Node 1 Sampled z', linewidth=1.4, marker="x", markersize=4, alpha=0.7)
# --- Bottom subplot: adaptive gains vartheta_i ---
axs[2].plot(time_gen, vartheta_gen1, '-', label='Node 1 Gen vartheta', linewidth=1.4, marker="o", markersize=4, alpha=0.7)
axs[2].plot(time, vartheta1, '-', label='Node 1 Sampled vartheta', linewidth=1.4, marker="x", markersize=4, alpha=0.7)
# --- Bottom subplot: time plot ---
axs[3].plot(time_gen, '-', label='Timestamps Gen', linewidth=1.4, marker="o", markersize=4, alpha=0.7)
axs[3].plot(time, '-', label='Timestamps', linewidth=1.4, marker="x", markersize=4, alpha=0.7)
for ax in axs:
    ax.grid(True, linestyle='--', alpha=0.6)
    ax.legend()
plt.tight_layout()
plt.show()