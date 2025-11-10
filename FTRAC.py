#%% Finite-Time Robust Adaptive Consensus (FTRAC) - LAPLACIAN
import numpy as np
import networkx as nx
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

def darken_color(color, amount=0.6):
    """
    Darkens a given matplotlib color.
    `amount` < 1 darkens the color, > 1 would lighten it.
    """
    try:
        c = mcolors.to_rgb(color)
        return tuple([amount * x for x in c])
    except:
        return color 

## Graph definition: 
np.random.seed(42)  # For reproducibility {40, 41, 42}

NODES = {
    1:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [30]},
    2:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1] },
    3:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2] },
    4:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [3] },
    5:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [4] },
    6:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [5] },
    7:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [6] },
    8:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [7] },
    9:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [8] },
    10: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [9] },
    11: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [10]},
    12: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [11]},
    13: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [12]},
    14: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [13]},
    15: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [14]},
    16: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [15]},
    17: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [16]},
    18: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [17]},
    19: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [18]},
    20: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [19]},
    21: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [20]},
    22: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [21]},
    23: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [22]},
    24: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [23]},
    25: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [24]},
    26: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [25]},
    27: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [26]},
    28: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [27]}, 
    29: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [28]},
    30: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [29]},
}


G = nx.DiGraph()
for node, props in NODES.items():
    G.add_node(node, pos=(props['x0'], props['z0']))
    for neighbor in props['neighbors']:
        G.add_edge(node, neighbor)

print("Graph nodes:", G.nodes)
print("Graph edges:", G.edges)

## Laplacian matrix: 
L = nx.linalg.directed_laplacian_matrix(G)
L = np.array(L)
print("Laplacian Matrix:\n", L) 
use_laplacian = False

#% >>> System parameters: 
## Simulation:
T        = 30.0
dt       = 1.0
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
    "use_laplacian": use_laplacian, 
    "eta":           eta,
    "epsilon_off":   freeze_threshold_off,
    "epsilon_on":    freeze_threshold_on,
    "active":        active,
    "nodes":         NODES,
}

## Disturbance: bounded known input
alpha   = 1.5
beta    = 0.5
kappa   = 1.0
phi     = np.random.uniform(0, 1, (n_agents, n_points)) 
nu = np.random.uniform(-alpha, alpha, (n_agents, n_points)) + beta + kappa * np.sin(2*np.pi*10*(time - phi))  

## Initial conditions:
init_conditions = {
    "x": np.array([NODES[i+1]['x0'] for i in range(n_agents)]),
    "z": np.array([NODES[i+1]['z0'] for i in range(n_agents)]),
    "vtheta": np.zeros(n_agents)  # Initial adaptive gains
}

#% >>> Plotting aux:
def plot_simulation(t, x, z, vartheta, params):
    """
    Plot x, z, vartheta, and u in a 2x2 grid.
    
    Parameters:
    - t: time vector
    - x, z, vartheta, mv: 2D arrays of shape (n_agents, n_points)
    """
    # Trim last time step (if necessary)
    n_agents = params["n_agents"]

    t = t[:-1]
    x = x[:,:-1]
    z = z[:,:-1]
    vartheta = vartheta[:,:-1]

    fig, axs = plt.subplots(2, 1, figsize=(12, 9))
    
    # --- Top-left: x_i ---
    colors = plt.cm.tab10.colors  

    for i in range(n_agents):
        base_color = colors[i % len(colors)]
        ref_color = darken_color(base_color, amount=0.75)  

        axs[0].plot(t, x[i,:], color=base_color, linestyle='-', label=f'$x_{{{i+1}}}$')
        axs[0].plot(t, z[i,:], color=ref_color, linestyle='--', label=f'$z_{{{i+1}}}$ (ref.)')
    
    axs[0].set_title('States $x_i$')
    axs[0].set_xlabel('Time (s)')
    axs[0].set_ylabel('$x(t)$')
    axs[0].legend(ncol=3)
    axs[0].grid(True) 
    
    # --- Bottom-left: vartheta_i ---
    for i in range(n_agents):
        axs[1].plot(t, vartheta[i,:], label=f'$\\vartheta_{i+1}$')
    axs[1].set_title('Adaptive gains $\\vartheta_i$')
    axs[1].set_xlabel('Time (s)')
    axs[1].set_ylabel('$\\vartheta(t)$')
    axs[1].legend(ncol=3)
    axs[1].grid(True)
    
    plt.tight_layout()
    plt.show()

def plot_states(t, x, z, n_agents, ref_state_num=1):
    """
    Plot x and z states for all agents.
    
    Parameters:
    - t: time vector
    - x, z: 2D arrays of shape (n_agents, n_points)
    - n_agents: number of agents
    - save_path: path to save figure (optional)
    """
    # Trim last time step (if necessary)
    t = t[:-1]
    x = x[:,:-1]
    z = z[:,:-1]

    fig, axs = plt.subplots(2, 1, figsize=(12, 9))
    for i in range(n_agents):
        axs[0].plot(t, x[i,:], linestyle='-', label=f'$x_{{{i+1}}}$')
    axs[0].plot(t, z[ref_state_num-1,:], '--k', label=f'$z_{{{ref_state_num}}}$ (ref.)')
    axs[0].set_title('States $x_i$')
    axs[0].set_xlabel('Time (s)')
    axs[0].set_ylabel('$x(t)$')
    axs[0].legend(ncol=3)
    axs[0].grid(True)

    for i in range(n_agents):
        axs[1].plot(t, z[i,:], linestyle='-', label=f'$z_{{{i+1}}}$ (ref.)')

    axs[1].set_title('Reference states $z_i$')
    axs[1].set_xlabel('Time (s)')
    axs[1].set_ylabel('$z(t)$')
    axs[1].legend(ncol=3)
    axs[1].grid(True)

    plt.tight_layout()
    plt.show()

def plot_lyapunov(t, x, z, params):
    epsilon = (params["epsilon_off"], params["epsilon_on"])
    sigma = x - z
    V = np.abs(sigma)

    fig, ax = plt.subplots(figsize=(9, 5))

    for i in range(n_agents):
        ax.plot(t, V[i,:], label=f'$V(\\sigma_{{{i+1}}})$')
    ax.axhline(epsilon[0], color='k', linestyle='--', label='$\\epsilon$')
    ax.axhline(epsilon[1], color='r', linestyle='--', label='$\\bar{\\epsilon}$')
    ax.set_ylim([0, (epsilon[1] * 2.0)])
    ax.set_title('Lyapunov Function $V(x)$')
    ax.set_xlabel('Time (s)')
    ax.set_ylabel(f'$V(x)$')
    ax.legend(ncol=3)
    ax.grid(True)

    plt.tight_layout()
    plt.show()

def plot_hysteresis_and_sign_function(x, z, dvtheta, params, agent=1):
    epsilon = (params["epsilon_off"], params["epsilon_on"])
    eta = params["eta"]

    sigma = x - z
    sigma = sigma[agent-1, :]
    grad = np.sign(sigma)
    dvtheta_t = dvtheta[agent-1, :]

    fig, axs = plt.subplots(1, 2, figsize=(14, 6))
    # --- histogram of grad values ---
    bins = [-1.5, -0.5, 0.5, 1.5]   # bins centered at -1, 0, +1
    counts, _, _ = axs[0].hist(grad, bins=bins, rwidth=0.6,
                               color='tab:orange', edgecolor='k')

    axs[0].set_xticks([-1, 0, 1])
    axs[0].set_title(f'Histogram of sign values for Agent {agent}', fontsize=14)
    axs[0].set_xlabel('Sign value', fontsize=12)
    axs[0].set_ylabel('Count', fontsize=12)
    axs[0].grid(axis='y', linestyle='--', alpha=0.7)

    # annotate counts above bars
    for x_pos, c in zip([-1, 0, 1], counts):
        axs[0].text(x_pos, c + 0.5, str(int(c)), ha='center', fontsize=12)

    # --- Apply hysteresis logic ---
    active = 0
    dvtheta = np.zeros_like(sigma)
    for k in range(len(sigma) - 1):
        if active == 0:
            if np.abs(sigma[k]) > epsilon[1]:
                active = 1
                dvtheta[k] = 1 * eta
            else: 
                dvtheta[k] = 0
        else:
            if np.abs(sigma[k]) <= epsilon[0]:
                active = 0
                dvtheta[k] = 0
            else:
                dvtheta[k] = 1 * eta
    
    # Main hysteresis curve
    axs[1].step(np.abs(sigma), dvtheta_t, where='post', lw=2,
            label=rf'$\dot{{\vartheta}}_{{{agent}}}(|\sigma_{{{agent}}}|)$ simulated',
            color='tab:blue')
    axs[1].step(np.abs(sigma), dvtheta, where='post', lw=2,
            label=rf'$\dot{{\vartheta}}_{{{agent}}}(|\sigma_{{{agent}}}|)$ ideal',
            color='tab:orange', linestyle='--')
    axs[1].set_xlim(0, (2) * params["epsilon_on"])
    # Reference lines
    axs[1].axhline(0, color='k', linestyle='--', linewidth=1)
    axs[1].axvline(0, color='k', linestyle='--', linewidth=1)

    # Hysteresis thresholds
    axs[1].axvline(params["epsilon_off"], color='r', linestyle='--', 
               label=r'$\pm \epsilon_{\mathrm{off}}$')
    axs[1].axvline(-params["epsilon_off"], color='r', linestyle='--')
    axs[1].axvline(params["epsilon_on"], color='g', linestyle='--', 
               label=r'$\pm \epsilon_{\mathrm{on}}$')
    axs[1].axvline(-params["epsilon_on"], color='g', linestyle='--')

    # Labels and styling
    axs[1].set_title(f'Hysteresis behavior for Agent {agent}', fontsize=14)
    axs[1].set_xlabel(r'$|\sigma(t)|$', fontsize=12)
    axs[1].set_ylabel(r'$\dot{\vartheta}(t)$', fontsize=12)
    axs[1].legend()
    axs[1].grid(True, linestyle='--', alpha=0.7)

    plt.tight_layout()
    plt.show()

## Dynamics:
## Consensus law (Javier's design): 
def vi(i, z, neighbors): 
    diffs = z[i] - z[neighbors]
    return -np.sum(np.sign(diffs) * np.sqrt(np.abs(diffs)))

def dynamics(t, y, n_agents, nu, mv, dvth, params): 
    dydt = np.zeros_like(y)

    x = y[:n_agents]
    z = y[n_agents:2*n_agents]
    vtheta = y[2*n_agents:3*n_agents]

    v = np.zeros(n_agents)
    if params["use_laplacian"]:
        v = -L @ z
    else:
        for i in range(n_agents):
            neighbors = params["nodes"][i+1]['neighbors']
            neighbors_index = [n-1 for n in neighbors]  # Convert to 0-based index
            v[i] = vi(i, z, neighbors_index)
    g = v + params["omega"]
    dzdt = g

    sigma = x - z
    grad = np.sign(sigma)

    dvtheta = np.zeros(n_agents)
    for i in range(n_agents):
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
    
    dvthdt = dvtheta
    u = g - vtheta * grad

    k = int(t / params["dt"])
    if k < params["n_points"]:
        dvth[:,k] = dvthdt
        mv[:,k] = u

    dxdt = params["omega"] + u + nu

    dydt[:n_agents] = dxdt
    dydt[n_agents:2*n_agents] = dzdt
    dydt[2*n_agents:3*n_agents] = dvthdt

    return dydt

def dyn2sample(t, y, g, nu, n_agents, dvth, params, sample_points): 
    dydt = np.zeros_like(y)

    x = y[:n_agents]
    z = y[n_agents:2*n_agents]
    vtheta = y[2*n_agents:3*n_agents]

    sigma = x - z
    grad = np.sign(sigma)

    dvtheta = np.zeros(n_agents)
    for i in range(n_agents):
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

def rk4_step(f, t, y, dt, *args):
    """
    One step of fixed-step RK4 integration.

    f : function(t, y, *args) -> dydt
    t : current time
    y : current state vector
    dt: time step
    *args: extra arguments passed to f
    """
    k1 = f(t, y, *args)
    k2 = f(t + dt/2, y + dt/2 * k1, *args)
    k3 = f(t + dt/2, y + dt/2 * k2, *args)
    k4 = f(t + dt,   y + dt   * k3, *args)
    return y + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)

#%% Simulation: RK4 integration
def simulate_dynamics(params, init_conditions):
    # Preallocate variables: states, manipulated variables and derivatives
    n_points = params["n_points"]
    n_agents = params["n_agents"]
    dt = params["dt"]

    x = np.zeros(shape=(n_agents, n_points))
    z = np.zeros(shape=(n_agents, n_points))
    vtheta = np.zeros(shape=(n_agents, n_points))
    dvth = np.zeros(shape=(n_agents, n_points))
    mv = np.zeros(shape=(n_agents, n_points))
    y = np.concatenate(
        [init_conditions["x"], init_conditions["z"], init_conditions["vtheta"]]
    )

    t = 0.0
    for k in range(n_points):

        x[:, k] = y[:n_agents]
        z[:, k] = y[n_agents:2*n_agents]
        vtheta[:, k] = y[2*n_agents:3*n_agents]
        y = rk4_step(dynamics, t, y, dt, n_agents, nu[:, k], mv, dvth, params)

        t += dt
    return x, z, vtheta, mv, dvth

x, z, vtheta, mv, dvth = simulate_dynamics(params, init_conditions)
t = np.linspace(0, T, n_points)
plot_simulation(t, x, z, vtheta, params)
plot_states(t, x, z, n_agents, ref_state_num=2)
plot_lyapunov(t, x, z, params)
plot_hysteresis_and_sign_function(x, z, dvth, params, agent=1)

#%% Simulation: sampled dynamics (to mimic microcontroller and network behavior)
def simulate_sampled_dynamics(params, init_conditions, sample_time=0.2):
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

        # Compute consensus input
        if k % sample_interval == 0:
            if params["use_laplacian"]:
                v = -L @ z[:, k]
            else:
                for i in range(n_agents):
                    neighbors = params["nodes"][i+1]['neighbors']
                    neighbors_index = [n-1 for n in neighbors]
                    v[i] = vi(i, z[:, k], neighbors_index)

            # Store sampled trajectories
            sample_idx = k // sample_interval
            if sample_idx < sample_points:
                xs[:, sample_idx] = x[:, k]
                zs[:, sample_idx] = z[:, k]
                vthetas[:, sample_idx] = vtheta[:, k]

        # RK4 integration
        g = v
        y = rk4_step(dyn2sample, t, y, dt, g, nu[:, k], n_agents, dvthetas, params, sample_points)
        t += dt

    return xs, zs, vthetas, dvthetas, sample_points

x, z, vtheta, dvtheta, sample_points = simulate_sampled_dynamics(params, init_conditions)
t = np.linspace(0, T, sample_points)
plot_simulation(t, x, z, vtheta, params)
plot_states(t, x, z, n_agents, ref_state_num=2)
plot_lyapunov(t, x, z, params)
plot_hysteresis_and_sign_function(x, z, dvtheta, params, agent=1)

#%% Simulation: Euler integration (for comparison)
def simulate_sampled_dynamics_euler(params, init_conditions, sample_time=1.0):
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

        # Always compute consensus input
        if params["use_laplacian"]:
            v = -L @ z[:, k]
        else:
            for i in range(n_agents):
                neighbors = params["nodes"][i+1]['neighbors']
                neighbors_index = [n-1 for n in neighbors]
                v[i] = vi(i, z[:, k], neighbors_index)

        # Store sampled trajectories only at sample points
        if k % sample_interval == 0:
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
plot_simulation(t, x, z, vtheta, params)
plot_states(t, x, z, n_agents, ref_state_num=2)
plot_lyapunov(t, x, z, params)
plot_hysteresis_and_sign_function(x, z, dvtheta, params, agent=1)

#%% END OF FILE
## Hysteresis loop: 
def hysteresis_loop():
    sigma = np.linspace(-0.15, 0.15, 300)
    dvtheta = np.zeros_like(sigma)
    active = 0
    for k in range(len(sigma) - 1):
        if active == 0:
            if np.abs(sigma[k]) > freeze_threshold_on:
                active = 1
                dvtheta[k] = 1 * eta
            else: 
                dvtheta[k] = 0
        else:
            if np.abs(sigma[k]) <= freeze_threshold_off:
                active = 0
                dvtheta[k] = 0
            else:
                dvtheta[k] = 1 * eta

    plt.figure(figsize=(7,5))
    plt.step(np.abs(sigma), dvtheta, where='post', lw=2)
    plt.xlim(0, 0.15)
    plt.axhline(0, color='k', linestyle='--', linewidth=1)
    plt.axvline(0, color='k', linestyle='--', linewidth=1)
    plt.axvline(freeze_threshold_off, color='r', linestyle='--', label=r'$\epsilon_{\mathrm{off}}$')  
    plt.axvline(freeze_threshold_on, color='g', linestyle='--', label=r'$\epsilon_{\mathrm{on}}$')
    plt.title('Hysteresis behavior', fontsize=14)
    plt.xlabel(r'$|\sigma(t)|$', fontsize=12)
    plt.ylabel(r'$\dot{\vartheta}(t)$', fontsize=12)
    plt.legend()
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.tight_layout()
    plt.show()

print(np.sign(0.0))  # Just to avoid linting error