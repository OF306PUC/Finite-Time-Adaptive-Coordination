import json
import os
import csv
import numpy as np
import pandas as pd

class JSONtoCSVConverter:
    def __init__(self, filename_template, simulation, total_nodes, scale_factor=1e-6, output_dir="csv_output"):
        self.filename_template = filename_template  # e.g., "data/{}/{}.json"
        self.simulation = simulation
        self.total_nodes = total_nodes
        self.scale_factor = scale_factor
        self.output_dir = output_dir

        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)

    def convert(self, shift_time=True, init_conditions_route="initial_conditions.csv"):
        # Load initial conditions once
        if not shift_time:
            init_df = pd.read_csv(init_conditions_route).set_index("id")

        for i in range(1, self.total_nodes + 1):
            filename = self.filename_template.format(self.simulation, i)

            if not os.path.exists(filename):
                print(f"[Warning] File not found: {filename}")
                continue

            # Load JSON (possibly double-encoded)
            with open(filename, "r") as f:
                raw_content = json.load(f)

            content = json.loads(raw_content) if isinstance(raw_content, str) else raw_content

            data_dict = content.get("data", {})

            timestamp = np.array([int(x) for x in data_dict.get("timestamp", [])])
            state     = np.array([int(x) for x in data_dict.get("state", [])])
            vstate    = np.array([int(x) for x in data_dict.get("vstate", [])])
            vartheta  = np.array([int(x) for x in data_dict.get("vartheta", [])])

            min_len = min(len(timestamp), len(state), len(vstate), len(vartheta))
            if min_len == 0:
                print(f"[Warning] Empty data in file: {filename}")
                continue

            # Trim to same size
            timestamp = timestamp[:min_len] * 1e-3
            x         = state[:min_len] * self.scale_factor
            z         = vstate[:min_len] * self.scale_factor
            vartheta  = vartheta[:min_len] * self.scale_factor

            # ----------- HANDLE INITIAL CONDITIONS -----------
            if shift_time:
                # Normal mode (shift timestamps)
                timestamp = timestamp - timestamp[0]

            else:
                # Load initial conditions for this node
                if i not in init_df.index:
                    print(f"[Warning] Node {i} missing in {init_conditions_route}")
                    continue
                
                x0 = init_df.loc[i, "state"] * self.scale_factor
                z0 = init_df.loc[i, "vstate"] * self.scale_factor
                vartheta0 = 0.0

                # Prepend t=0 and initial values
                timestamp = np.insert(timestamp, 0, 0.0)
                x = np.insert(x, 0, x0)
                z = np.insert(z, 0, z0)
                vartheta = np.insert(vartheta, 0, vartheta0)

            # ----------- SAVE CSV -----------
            csv_filename = os.path.join(self.output_dir, f"node_{i}.csv")

            with open(csv_filename, "w", newline="") as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(["timestamp", "state", "vstate", "vartheta"])
                writer.writerows(zip(timestamp, x, z, vartheta))

            print(f"[Info] Converted {filename} -> {csv_filename}")



if __name__ == "__main__":
    num_agents = 30
    sim_name = f"{num_agents}node-clusters"
    output_csv_dir = f"{num_agents}node-clusters-csv"
    num_agents = 30
    converter = JSONtoCSVConverter(filename_template="{}/{}.json",
                                   simulation=sim_name,
                                   total_nodes=num_agents,
                                   output_dir=output_csv_dir)
    converter.convert(shift_time=False)