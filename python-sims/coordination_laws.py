#%%
import numpy as np
import networkx as nx
import matplotlib.pyplot as plt
from utils_graph import NODES


"""
Consensual average law: 
- Laplacian is being used 
- alpha parameters is to control the convergence speed: M(alpha) = I - alpha*L
- Graph must be balanced and strongly connected
"""
def gi(node_idx, virtual_states, neighbors_index, link_gain=1e-1):
    N = len(neighbors_index)
    if N == 0:
        return 0.0
    diffs = np.array(virtual_states[node_idx] - virtual_states[neighbors_index])
    return (-link_gain) * np.sum(diffs) 

"""
Javier's coordination law:
- alpha parameter controls convergence speed
"""
def vi(node_idx, virtual_states, neighbors_index, alpha=1.0, link_gain=1e-1, extra_param=1.0): 
    N = len(neighbors_index)
    if N == 0:
        return 0.0
    diffs = np.array(virtual_states[node_idx] - virtual_states[neighbors_index])
    return (-link_gain) * np.sum(np.sign(extra_param * diffs) * (np.abs(extra_param * diffs))**alpha) 


if __name__ == "__main__":

    # ------------------------
    # Build directed graph
    # ------------------------
    n_agents = len(NODES)

    G = nx.DiGraph()
    for node, props in NODES.items():
        G.add_node(node)
        for neighbor in props['neighbors']:
            G.add_edge(node, neighbor)

    # ------------------------
    # Laplacian L = D - A
    # ------------------------
    A = nx.to_numpy_array(G, nodelist=sorted(G.nodes()))
    D = np.diag(A.sum(axis=1))
    L = D - A

    print("A =\n", A)
    print("L =\n", L)

    # ------------------------
    # Range of xi values
    # ------------------------
    xi_values = np.linspace(0, 1, 30)

    # Store trajectories
    eig_traj = [[] for _ in range(n_agents)]

    # ------------------------
    # Compute eigenvalue trajectories
    # ------------------------
    for xi in xi_values:
        M = np.eye(n_agents) - xi * L   # matrix of interest
        eigs = np.linalg.eigvals(M)
        # sort eigenvalues to keep trajectories continuous
        eigs = eigs[np.argsort(eigs.real)]
        for k in range(n_agents):
            eig_traj[k].append(eigs[k])

    # ------------------------
    # Plot trajectories in the complex plane
    # ------------------------
    plt.figure(figsize=(8, 8))

    for k in range(n_agents):
        traj = np.array(eig_traj[k])
        plt.plot(traj.real, traj.imag, '-o', markersize=3, label=f"λ{k}")

    # Unit circle for reference (stability boundary)
    theta = np.linspace(0, 2*np.pi, 300)
    plt.plot(np.cos(theta), np.sin(theta), 'k--', alpha=0.3)

    plt.xlabel("Real part")
    plt.ylabel("Imaginary part")
    plt.title("Eigenvalue Trajectories of  $M(\\xi) = I - \\xi \\mathcal{L}$")
    plt.grid(True)
    plt.axis("equal")
    plt.legend()
    plt.show()
