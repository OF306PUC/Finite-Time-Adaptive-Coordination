#%% Finite-Time Robust Adaptive Consensus (FTRAC) - LAPLACIAN
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import networkx as nx

import utils_plot
import coordination_laws as cl
from utils_graph import NODES

#% >>> System parameters: 
## Simulation:
T        = 4.0
dt       = 0.001
time     = np.arange(0, T, dt)
n_points = len(time)
n_agents = len(NODES)

## Laplacian matrix: 
G = nx.DiGraph()
for node, props in NODES.items():
    G.add_node(node, pos=(props['x0'], props['z0']))
    for neighbor in props['neighbors']:
        G.add_edge(node, neighbor)
L = nx.linalg.directed_laplacian_matrix(G)
L = np.array(L)
if n_agents <= 10:
    print("Laplacian Matrix:\n", L) 
use_laplacian = True

## Adaptive gain: 
omega                 = 1.0     # Timer oscillator frequency (rad/s) --> slope 1s/1s
eta                   = 0.5     # adaptation gain
eta_discrete          = 2.0e-6  # discrete adaptation gain
alpha                 = 1e-2    # consensual law gain: W(alpha) = I - alpha*L
freeze_threshold_off  = 1e-2    # error-threshold to freeze gain evolution ("ε" in paper)
freeze_threshold_on   = 0.050   # error-threshold to re-activate gain evolution ("ε̄" in paper)
active                = np.zeros(n_agents)  # Initially, all agents are inactive
disturbance_scale     = 1e-3

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
    # Discrete-time parameters:
    "alpha":         alpha,
    "eta_discrete":  eta_discrete,
    "delta":         freeze_threshold_off,
    "disturbance":   disturbance_scale,
}

## Disturbance: bounded known input
alpha   = 1.0
beta    = 0.1
kappa   = 0.4
phi     = np.random.uniform(0, 1, (n_agents, n_points)) 
nu = np.random.uniform(-alpha, alpha, (n_agents, n_points)) + beta + kappa * np.sin(2*np.pi*1.0*(time - phi))  

## Initial conditions:
init_conditions = {
    "x": np.array([NODES[i+1]['x0'] for i in range(n_agents)]),
    "z": np.array([NODES[i+1]['z0'] for i in range(n_agents)]),
    "vtheta": np.zeros(n_agents)  # Initial adaptive gains
}

## Dynamics:
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
            v[i] = cl.vi(i, z, neighbors_index)
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
utils_plot.plot_simulation(t, x, z, vtheta, params)
utils_plot.plot_states(t, x, z, params, ref_state_num=2)
utils_plot.plot_lyapunov(t, x, z, params)
utils_plot.plot_hysteresis_and_sign_function(x, z, dvth, params, agent=1)

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
                    v[i] = cl.gi(i, z[:, k], neighbors_index)

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
utils_plot.plot_simulation(t, x, z, vtheta, params)
utils_plot.plot_states(t, x, z, params, ref_state_num=2)
utils_plot.plot_lyapunov(t, x, z, params)
utils_plot.plot_hysteresis_and_sign_function(x, z, dvtheta, params, agent=1)

#%% Simulation: Euler integration (for comparison)
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

        # Always compute consensus input
        if k % sample_interval == 0:
            if params["use_laplacian"]:
                v = -L @ z[:, k]
            else:
                for i in range(n_agents):
                    neighbors = params["nodes"][i+1]['neighbors']
                    neighbors_index = [n-1 for n in neighbors]
                    v[i] = cl.vi(i, z[:, k], neighbors_index)

        # Store sampled trajectories only at sample points
        if k % sample_interval == 0:
            sample_idx = k // sample_interval
            if sample_idx < sample_points:
                xs[:, sample_idx] = x[:, k]
                zs[:, sample_idx] = z[:, k]
                vthetas[:, sample_idx] = vtheta[:, k]

        # Euler integration step
        dydt = dyn2sample(t, y, v, nu[:, k], n_agents, dvthetas, params, sample_points)
        y = np.maximum(y + dt * dydt, 0)
        t += dt

    return xs, zs, vthetas, dvthetas, sample_points

x, z, vtheta, dvtheta, sample_points = simulate_sampled_dynamics_euler(params, init_conditions)
t = np.linspace(0, T, sample_points)
utils_plot.plot_simulation(t, x, z, vtheta, params)
utils_plot.plot_states(t, x, z, params, ref_state_num=2)
utils_plot.plot_lyapunov(t, x, z, params)
utils_plot.plot_hysteresis_and_sign_function(x, z, dvtheta, params, agent=1)

#%% Discrete simulation: 
def simulate_discrete_dynamics(params, init_conditions):

    # Synchronous dynamics - fetching
    n_points = params["n_points"]
    n_agents = params["n_agents"]
    alpha = params["alpha"]
    eta = params["eta_discrete"]
    d_scale = params["disturbance"]
    delta = params["delta"]

    # Full trajectories
    x = np.zeros((n_agents, n_points))
    z = np.zeros((n_agents, n_points))
    vartheta = np.zeros((n_agents, n_points))

    # Initial condition vector
    y = np.concatenate(
        [init_conditions["x"], init_conditions["z"], init_conditions["vtheta"]]
    )

    g = np.zeros(n_agents)
    dvtheta = np.zeros(n_agents)

    for k in range(n_points):
        # Store full trajectory
        x[:, k] = y[:n_agents]
        z[:, k] = y[n_agents:2*n_agents]
        vartheta[:, k] = y[2*n_agents:3*n_agents]

        # update each agent
        sigma = x[:, k] - z[:, k]
        grad = np.sign(sigma)

        for i in range(n_agents): 
            neighbors = NODES[i+1]['neighbors']
            neighbors_idx = [n-1 for n in neighbors]
            g[i] = cl.gi(i, z[:, k], neighbors_idx, alpha)

            if np.abs(sigma[i]) > delta:
                dvtheta[i] = 1.0
            else:
                dvtheta[i] = 0.0

        u = g - vartheta[:, k] * grad
        xNew = x[:, k] + u + nu[:, k] * d_scale
        zNew = z[:, k] + g 
        varthetaNew = vartheta[:, k] + eta * dvtheta

        y[0:n_agents] = xNew
        y[n_agents:2*n_agents] = zNew
        y[2*n_agents:3*n_agents] = varthetaNew

    return x, z, vartheta

x, z, vartheta = simulate_discrete_dynamics(params, init_conditions)
t = np.linspace(0, T, n_points)
utils_plot.plot_simulation(t, x, z, vartheta, params)
utils_plot.plot_states(t, x, z, params, ref_state_num=1)
utils_plot.plot_lyapunov(t, x, z, params)

#%% END OF FILE
print(np.sign(0.0))