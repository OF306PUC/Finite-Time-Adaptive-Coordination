import numpy as np
import networkx as nx

# Graph definition: 
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

# NODES = {
#     1:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2,3]},
#     2:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1,4] },
#     3:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1,4] },
#     4:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2,3] },
# }


if __name__ == "__main__":
    G = nx.DiGraph()
    for node, props in NODES.items():
        G.add_node(node, pos=(props['x0'], props['z0']))
        for neighbor in props['neighbors']:
            G.add_edge(node, neighbor)

    print("Graph nodes:", G.nodes)
    print("Graph edges:", G.edges)