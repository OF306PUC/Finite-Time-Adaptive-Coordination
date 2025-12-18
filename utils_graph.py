import numpy as np
import networkx as nx

# Graph definition: 
np.random.seed(42)  # For reproducibility {40, 41, 42}

NODES = {
    1:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [29,30,2,3]},
    2:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [30,1,3,4] },
    3:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1,2,4,5] },
    4:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2,3,5,6] },
    5:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [3,4,6,7] },
    6:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [4,5,7,8] },
    7:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [5,6,8,9] },
    8:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [6,7,9,10] },
    9:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [7,8,10,11] },
    10: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [8,9,11,12] },
    11: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [9,10,12,13] },
    12: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [10,11,13,14]},
    13: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [11,12,14,15]},
    14: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [12,13,15,16]},
    15: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [13,14,16,17]},
    16: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [14,15,17,18]},
    17: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [15,16,18,19]},
    18: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [16,17,19,20]},
    19: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [17,18,20,21]},
    20: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [18,19,21,22]},
    21: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [19,20,22,23]},
    22: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [20,21,23,24]},
    23: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [21,22,24,25]},
    24: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [22,23,25,26]},
    25: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [23,24,26,27]},
    26: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [24,25,27,28]},
    27: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [25,26,28,29]},
    28: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [26,27,29,30]}, 
    29: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [27,28,30,1]},
    30: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [28,29,1,2]},
}

# NODES = {
#     1:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2,3]},
#     2:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1,4] },
#     3:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [1,4] },
#     4:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10), 'neighbors': [2,3] },
# }


# NODES = {
#     1:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [2, 3, 21]},
#     2:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [1, 4]},
#     3:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [1, 5]},
#     4:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [2, 5, 6]},
#     5:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [3, 4, 7]},
#     6:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [4, 7, 8]},
#     7:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [5, 6, 9]},
#     8:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [6, 10]},
#     9:  {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [7, 10]},
#     10: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [8, 9, 30]},
#     11: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [12, 13, 21]},
#     12: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [11, 14]},
#     13: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [11, 15]},
#     14: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [12, 15, 16]},
#     15: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [13, 14, 17]},
#     16: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [14, 17, 18]},
#     17: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [15, 16, 19]},
#     18: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [16, 20]},
#     19: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [17, 20]},
#     20: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [18, 19, 30]},
#     21: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [1, 11, 22, 23]},
#     22: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [21, 24]},
#     23: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [21, 25]},
#     24: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [22, 25, 26]},
#     25: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [23, 24, 27]},
#     26: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [24, 27, 28]},
#     27: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [25, 26, 29]},
#     28: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [26, 30]},
#     29: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [27, 30]},
#     30: {'x0': np.random.uniform(0,10), 'z0': np.random.uniform(0,10),
#          'neighbors': [10, 20, 28, 29]},
# }


if __name__ == "__main__":
    G = nx.DiGraph()
    for node, props in NODES.items():
        G.add_node(node, pos=(props['x0'], props['z0']))
        for neighbor in props['neighbors']:
            G.add_edge(node, neighbor)

    print("Graph nodes:", G.nodes)
    print("Graph edges:", G.edges)