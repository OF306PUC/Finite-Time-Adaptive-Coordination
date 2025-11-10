import numpy as np
import matplotlib.pyplot as plt

class Node:
    def __init__(self, idx, x_init, z_init, vartheta_init, eta, gamma=1.0, add_disturbance=False):
        self.idx = idx
        self.x = x_init
        self.z = z_init 
        self.m = 0.0
        self.sigma = 0.0
        self.u = 0.0
        self.vartheta = vartheta_init
        self.gamma = gamma
        self.eta = eta
        self.add_disturbance = add_disturbance
        self.neighbors = []

    def g(self):
        N = len(self.neighbors)
        if N == 0:
            return 0.0
        return sum(neighbor.z - self.z for neighbor in self.neighbors) / N

    def update(self):
        self.sigma = self.x - self.z
        grad = np.sign(self.sigma)

        gi = self.g()

        self.u = gi - self.gamma * self.vartheta * grad

        # Updates
        zNew = self.z + gi
        xNew = self.x + self.u
        if self.add_disturbance:
            xNew += np.random.normal(0, 0.1)

        varthetaNew = self.vartheta + self.eta * np.sum(grad**2)

        # Commit updates
        self.x = xNew
        self.z = zNew
        self.vartheta = varthetaNew

        return self.x, self.z, self.vartheta, self.sigma


# === Simulation ===
N = 9           # Number of agents
steps = 100     # Number of time steps
eta = 1.0       # Learning rate for vartheta 
nodes = []      # List to hold agents (nodes)

NODES = {
    1: {'x0': 1000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [4], 'disturbance': False},
    2: {'x0': 2000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [5], 'disturbance': False},
    3: {'x0': 3000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [8], 'disturbance': False},
    4: {'x0': 4000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [7], 'disturbance': False},
    5: {'x0': 5000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [9], 'disturbance': False},
    6: {'x0': 6000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [2], 'disturbance': False},
    7: {'x0': 7000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [3], 'disturbance': False},
    8: {'x0': 8000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [6], 'disturbance': False},
    9: {'x0': 9000, 'z0': 5000, 'vartheta0': 0, 'neighbors': [1], 'disturbance': False},
}

# Initialize agents with different initial states
for i in range(N):
    x_init = NODES[i+1]['x0']
    z_init = NODES[i+1]['z0']
    vartheta_init = NODES[i+1]['vartheta0']
    add_disturbance = NODES[i+1]['disturbance']
    node = Node(i, x_init, z_init, eta, add_disturbance)
    nodes.append(node)

# Define neighbors (full mesh or ring)
for idx, node in enumerate(nodes):
    neighbors_indices = NODES[i+1]['neighbors']
    node.neighbors = [nodes[n_idx - 1] for n_idx in neighbors_indices if n_idx - 1 < N]

x_states = np.zeros((N, steps))
z_states = np.zeros((N, steps))
vartheta = np.zeros((N, steps))

for k in range(steps):
    for i, node in enumerate(nodes):
        x, z, theta, _ = node.update()
        x_states[i, k] = x
        z_states[i, k] = z
        vartheta[i, k] = theta

# === Plot ===

plt.figure(figsize=(12, 5))
for i in range(N):
    plt.plot(x_states[i], label=f'Node {i+1} x')
plt.title('Node states $x_i$ (solid) and references $z_i$ (dashed)')
plt.xlabel('Time step')
plt.ylabel('State')
plt.legend()
plt.grid()

plt.figure(figsize=(12, 5))
for i in range(N):
    plt.plot(z_states[i], '--', label=f'Node {i+1} z')
plt.title('Node references $z_i$ over time')
plt.xlabel('Time step')
plt.ylabel('Reference')
plt.legend()
plt.grid()

plt.figure(figsize=(12, 5))
for i in range(N):
    plt.plot(vartheta[i], label=f'Node {i+1}')
plt.title('Adaptive gain $\\vartheta_i$ over time')
plt.xlabel('Time step')
plt.ylabel('$\\vartheta$')
plt.legend()
plt.grid()

plt.show()

