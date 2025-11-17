import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

"""
All plotting functions assume that 'params' is a dictionary containing at least:
- 'n_agents': number of agents
- 'epsilon_off': lower hysteresis bound
- 'epsilon_on': upper hysteresis bound
- 'eta': adaptation rate
"""

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

        axs[0].plot(t, x[i,:], color=base_color, linestyle='-')
        if n_agents <= 10:
            axs[0].plot(t, z[i,:], color=ref_color, linestyle='--')
        else: 
            if i == 0:
                axs[0].plot(t, z[i,:], color=ref_color, linestyle='--', label=f'$z_{{{i+1}}}$ (ref.)')
    
    z_avg = np.mean(z[:,0]) * np.ones_like(t)
    axs[0].plot(t, z_avg, '--k', label='$\\overline{z}$')
    axs[0].set_title('States $x_i$')
    axs[0].set_xlabel('Time (s)')
    axs[0].set_ylabel('$x(t)$')
    if n_agents <= 10:
        axs[0].legend(ncol=3)
    axs[0].grid(True) 
    
    # --- Bottom-left: vartheta_i ---
    for i in range(n_agents):
        if n_agents <= 10:
            axs[1].plot(t, vartheta[i,:], label=f'$\\vartheta_{i+1}$')
        else:
            axs[1].plot(t, vartheta[i,:])
    axs[1].set_title('Adaptive gains $\\vartheta_i$')
    axs[1].set_xlabel('Time (s)')
    axs[1].set_ylabel('$\\vartheta(t)$')
    if n_agents <= 10:
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
        if n_agents <= 10:
            axs[0].plot(t, x[i,:], linestyle='-', label=f'$x_{{{i+1}}}$')
        else:
            axs[0].plot(t, x[i,:])
    z_avg = np.mean(z[:,0]) * np.ones_like(t)
    axs[0].plot(t, z_avg, '--k', label='$\\overline{z}$')
    axs[0].plot(t, z[ref_state_num-1,:], color='black', linestyle=':', linewidth=2.25, label=f'$z_{{{ref_state_num}}}$ (ref.)')
    axs[0].set_title('States $x_i$')
    axs[0].set_xlabel('Time (s)')
    axs[0].set_ylabel('$x(t)$')
    axs[0].legend(ncol=3)
    axs[0].grid(True)

    for i in range(n_agents):
        if n_agents <= 10:
            axs[1].plot(t, z[i,:], linestyle='-', label=f'$z_{{{i+1}}}$')
        else:
            axs[1].plot(t, z[i,:])

    axs[1].plot(t, z_avg, '--k', label='$\\overline{z}$')
    axs[1].set_title('Reference states $z_i$')
    axs[1].set_xlabel('Time (s)')
    axs[1].set_ylabel('$z(t)$')
    axs[1].legend(ncol=3)
    axs[1].grid(True)

    plt.tight_layout()
    plt.show()


def plot_lyapunov(t, x, z, params):
    n_agents = params["n_agents"]
    epsilon = (params["epsilon_off"], params["epsilon_on"])
    sigma = x - z
    V = np.abs(sigma)

    fig, ax = plt.subplots(figsize=(9, 5))

    for i in range(n_agents):
        if n_agents <= 10:
            ax.plot(t, V[i,:], label=f'$V(\\sigma_{{{i+1}}})$')
        else:
            ax.plot(t, V[i,:])
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