import os
import json 
import numpy as np
import matplotlib.pyplot as plt

class PostSimulation: 
    def __init__(self, simulation_dir, num_agents, Ts=0.25, dt=1e-3):
        self.simulation_dir = simulation_dir
        self.num_agents = num_agents
        self.conversion_factor = 1e6
        self.Ts = Ts
        self.dt = dt
        self.time_factor = 1 / 1000#self.dt / (self.Ts * 1000.0)
        self.epsilon_on = 0.02
        self.epsilon_off = 0.01

        self.data = {}  

    def load_data(self):
        for i in range(1, self.num_agents + 1):
            filename = f"{self.simulation_dir}/{i}.json"

            if not os.path.exists(filename):
                print(f"[Warning] File not found: {filename}")
                continue

            with open(filename, 'r') as f:
                raw_content = json.load(f)

            # Handle string-wrapped JSON (double encoded)
            if isinstance(raw_content, str):
                try:
                    content = json.loads(raw_content)
                except json.JSONDecodeError:
                    print(f"[Error] Failed to decode JSON string in {filename}")
                    continue
            else:
                content = raw_content
            data_dict = content.get('data', {})

            # Parse the lists as floats (or ints if appropriate)
            timestamp = [int(x) for x in data_dict.get('timestamp', [])]
            state = [int(x) for x in data_dict.get('state', [])]
            vstate = [int(x) for x in data_dict.get('vstate', [])]
            vartheta = [int(x) for x in data_dict.get('vartheta', [])]

            # Sanity check: ensure all lists are the same length
            min_len = min(len(timestamp), len(state), len(vstate), len(vartheta))
            if min_len == 0:
                print(f"[Warning] Empty data in file: {filename}")
                continue

            # Truncate all to same length if needed
            timestamp = timestamp[:min_len]
            state     = state[:min_len]
            vstate    = vstate[:min_len]
            vartheta  = vartheta[:min_len]

            # Stack into [timestamp, state, vstate, vartheta]
            node_data = np.stack([timestamp, state, vstate, vartheta], axis=1)

            self.data[i] = node_data

    def hysteresis_analysis(self, agent=1):
        """
        Hysteresis and convergence analysis for a specific agent.
        Args:
            agent (int): The agent number to analyze.
        Returns:
            None: Displays plots for hysteresis behavior and sign value histogram.
        """
        node_data = self.data[agent]
        x = node_data[:, 1] / self.conversion_factor
        z = node_data[:, 2] / self.conversion_factor
        sigma = x - z
        grad_vals = np.sign(sigma)

        # --- Apply hysteresis logic ---
        active = 0
        dvtheta = np.zeros_like(sigma)
        for k in range(len(sigma) - 1):
            if active == 0:
                if np.abs(sigma[k]) > self.epsilon_on:
                    active = 1
                    dvtheta[k] = 1
                else: 
                    dvtheta[k] = 0
            else:
                if np.abs(sigma[k]) <= self.epsilon_off:
                    active = 0
                    dvtheta[k] = 0
                else:
                    dvtheta[k] = 1

        # --- Create figure ---
        fig, axs = plt.subplots(2, 1, figsize=(10, 8), sharex=False)

        # --- Top plot: histogram of sign values ---
        bins = [-1.5, -0.5, 0.5, 1.5]   # bins centered at -1, 0, +1
        counts, _, _ = axs[0].hist(
            grad_vals, bins=bins, rwidth=0.6,
            color='tab:orange', edgecolor='k', linewidth=1.2
        )
        axs[0].set_xticks([-1, 0, 1])
        axs[0].set_title(f'Histogram of sign values for Agent {agent}', fontsize=14)
        axs[0].set_xlabel('Sign value', fontsize=12)
        axs[0].set_ylabel('Count', fontsize=12)
        axs[0].grid(axis='y', linestyle='--', alpha=0.7)

        # annotate counts above bars
        for x_pos, c in zip([-1, 0, 1], counts):
            axs[0].text(x_pos, c + 0.5, str(int(c)), ha='center', fontsize=12)

        # --- Bottom plot: hysteresis step behavior ---
        axs[1].step(np.abs(sigma), dvtheta, where='post', lw=2,
            label=rf'$\dot{{\vartheta}}_{{{agent}}}$ vs $|\sigma_{{{agent}}}|$',
            color='tab:blue')
        
        axs[1].set_xlim(0, 2 * self.epsilon_on)
        axs[1].set_ylim(-0.2, 1.2)

        # Reference lines
        axs[1].axhline(0, color='k', linestyle='--', linewidth=1)
        axs[1].axvline(self.epsilon_off, color='r', linestyle='--', 
                label=r'$\epsilon_{\mathrm{off}}$')
        axs[1].axvline(self.epsilon_on, color='g', linestyle='--', 
                label=r'$\epsilon_{\mathrm{on}}$')

        # Labels and styling
        axs[1].set_title(f'Hysteresis behavior for Agent {agent}', fontsize=14)
        axs[1].set_xlabel(r'$|\sigma(t)|$', fontsize=12)
        axs[1].set_ylabel(r'$\dot{\vartheta}(t)$', fontsize=12)
        axs[1].legend()
        axs[1].grid(True, linestyle='--', alpha=0.7)

        plt.tight_layout()
        plt.show()

    def plot_errors(self):

        fig, ax = plt.subplots(figsize=(10, 5))
        for idx, node_id in enumerate(sorted(self.data.keys())):
            node_data = self.data[node_id]

            t = node_data[:, 0] * self.time_factor
            x = node_data[:, 1] / self.conversion_factor
            z = node_data[:, 2] / self.conversion_factor
            sigma = x - z

            ax.plot(t, sigma, label=f'$\\sigma_{{{node_id}}}$')

        ax.axhline(self.epsilon_off, color='k', linestyle='--', label='$\\pm \\epsilon = 0.01$')
        ax.axhline(-self.epsilon_off, color='k', linestyle='--')
        ax.axhline(self.epsilon_on, color='r', linestyle='--', label='$\\pm \\bar{\\epsilon} = 0.02$')
        ax.axhline(-self.epsilon_on, color='r', linestyle='--')
        ax.set_ylim([-(self.epsilon_on * 1.5), (self.epsilon_on * 1.5)])
        ax.set_title('Error term $\\sigma_i$')
        ax.set_xlabel('Time (s)')
        ax.set_ylabel('$\\sigma(t)$')
        ax.legend(ncol=3)
        ax.grid(True)

        plt.tight_layout()
        plt.show()

    def plot_timestamps_and_samples(self, num_points):
        if not self.data:
            return

        # Create a 3-row figure: timestamps, state evolution, and number of samples
        fig, axs = plt.subplots(3, 1, figsize=(14, 9), sharex=False, gridspec_kw={'height_ratios': [1.2, 1.5, 1]})
        markers = ['o', 'x', '*', 's', 'd', '^', 'v', '<', '>', 'p', 'h']

        # ---------------------- (1) TIMESTAMPS ----------------------
        for i, node_id in enumerate(sorted(self.data.keys())):
            node_data = self.data[node_id]
            t = node_data[:num_points, 0] * self.time_factor

            axs[0].plot(
                range(num_points), t,
                label=f'Node {node_id}',
                linewidth=1.4,
                marker=markers[i % len(markers)],
                markersize=5,
                alpha=0.85
            )
        axs[0].set_xlabel('Sample Index')
        axs[0].set_ylabel('Timestamps (s)')
        axs[0].legend(loc='upper left', bbox_to_anchor=(1.01, 1.0), fontsize=9)
        axs[0].grid(True, linestyle='--', alpha=0.6)

        # ---------------------- (2) STATE EVOLUTION ----------------------
        for i, node_id in enumerate(sorted(self.data.keys())):
            node_data = self.data[node_id]
            t = node_data[:num_points, 0] * self.time_factor
            x = node_data[:num_points, 1] / self.conversion_factor

            axs[1].plot(
                t, x,
                label=f'Node {node_id}',
                linewidth=1.4,
                marker=markers[i % len(markers)],
                markersize=5,
                alpha=0.9
            )
        axs[1].set_xlabel('Time (s)')
        axs[1].set_ylabel('$x(t)$')
        axs[1].grid(True, linestyle='--', alpha=0.6)

        # Adjust y-limits dynamically to avoid "flat" appearance
        all_x = np.concatenate([self.data[n][:num_points, 1] / self.conversion_factor for n in self.data])
        y_mean, y_std = np.mean(all_x), np.std(all_x)
        axs[1].set_ylim(y_mean - 2*y_std, y_mean + 2*y_std)

        # ---------------------- (3) NUMBER OF SAMPLES PER AGENT ----------------------
        agent_ids = sorted(self.data.keys())
        num_samples = [self.data[n].shape[0] for n in agent_ids]
        axs[2].set_xlabel('Agent ID')
        axs[2].bar(agent_ids, num_samples, color='skyblue', edgecolor='k', alpha=0.9)
        axs[2].set_ylabel('Number of Samples')
        axs[2].grid(axis='y', linestyle='--', alpha=0.6)

        # ---------------------- FINAL FORMATTING ----------------------
        #plt.tight_layout()
        plt.show()

    def numerical_results(self):
        """
        Computes and stores numerical metrics for each agent.
        Returns:
            dict: A dictionary with agent IDs as keys and their metrics as values.
                results = {
                    agent_id: {
                        'convergence_time_epsilon_off': float,
                        'convergence_time_epsilon_on': float,
                        'max_adaptive_gain': float,
                        'max_bounding_error': float,
                        'min_bounding_error': float, 
                        'steady_state_error': float,
                        'rmse_error_above_epsilon_off': float
                    },
                    ...
                }
        """
        results = {}
        for idx, node_id in enumerate(sorted(self.data.keys())):
            node_data = self.data[node_id]

            t = node_data[:, 0] * self.time_factor
            x = node_data[:, 1] / self.conversion_factor
            z = node_data[:, 2] / self.conversion_factor
            vartheta = node_data[:, 3] / self.conversion_factor
            sigma = x - z

            # Convergence times
            above_epsilon_on_idx = np.where(np.abs(sigma) <= self.epsilon_on)[0][0]
            convergence_time_epsilon_on = t[above_epsilon_on_idx]

            below_epsilon_off_idx= np.where(np.abs(sigma) <= self.epsilon_off)[0][0]
            convergence_time_epsilon_off = t[below_epsilon_off_idx]

            max_adaptive_gain = np.max(vartheta)
            max_bounding_error = np.max(sigma[below_epsilon_off_idx:])
            min_bounding_error = np.min(sigma[below_epsilon_off_idx:])
            steady_state_error = np.mean(sigma[below_epsilon_off_idx:])

            # RMSE above epsilon_off
            above_epsilon_off_idxs = np.where(np.abs(sigma[below_epsilon_off_idx:]) > self.epsilon_off)[0]
            if len(above_epsilon_off_idxs) > 0:
                rmse_error_above_epsilon_off = np.sqrt(np.mean(sigma[below_epsilon_off_idx:][above_epsilon_off_idxs]**2))
            else:
                rmse_error_above_epsilon_off = 0.0

            results[node_id] = {
                'convergence_time_epsilon_off': convergence_time_epsilon_off,
                'convergence_time_epsilon_on': convergence_time_epsilon_on,
                'max_adaptive_gain': max_adaptive_gain,
                'max_bounding_error': max_bounding_error,
                'min_bounding_error': min_bounding_error,
                'steady_state_error': steady_state_error,
                'rmse_error_above_epsilon_off': rmse_error_above_epsilon_off
            }

        with open(f"{self.simulation_dir}/numerical_results.json", 'w') as f:
            json.dump(results, f, indent=4)
        print(f"Numerical results saved to {self.simulation_dir}/numerical_results.json")


if __name__ == "__main__":
    sim_name = "30node-clusters"
    num_agents = 30
    post_sim = PostSimulation(simulation_dir=f"../data/{sim_name}", num_agents=num_agents)
    post_sim.load_data()
    post_sim.plot_timestamps_and_samples(num_points=20)
    #post_sim.hysteresis_analysis(agent=1)
    #post_sim.plot_errors()
    #post_sim.numerical_results()