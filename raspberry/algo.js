const M_PI = Math.PI;

class Algorithm {

    setParams(params) {

        // Controller parameters:
        this.scale_factor = 1e6;
        this.inv_scale_factor = 1e-6;
        this.active = 0;
        this.epsilonON = 0.050;
        this.epsilonOFF = 0.010;

        this.dt = Number(params.dt) * 1e-3; // Convert ms to seconds
        this.state0 = Number(params.state) * this.inv_scale_factor;
        this.vstate0 = Number(params.vstate) * this.inv_scale_factor;
        this.vartheta0 = Number(params.vartheta) * this.inv_scale_factor;
        this.eta = Number(params.eta) * this.inv_scale_factor;

        this.alpha = Number(params.alpha) * this.inv_scale_factor;
        this.delta = Number(params.delta) * this.inv_scale_factor;
        this.discrete_time = params.discrete_time;
        this.consensual_avg_law = params.consensual_avg_law;

        // --- DISTURBANCE PARAMETERS (Matching the Nordic structure) ---
        this.dist_on = params.disturbance.disturbance_on;
        // Random Component
        this.dist_offset = Number(params.disturbance.offset) * this.inv_scale_factor;
        this.dist_amplitude = Number(params.disturbance.amplitude) * this.inv_scale_factor;
        // Constant Bias Component
        this.dist_beta = Number(params.disturbance.beta) * this.inv_scale_factor;
        // Sinusoidal Component
        this.dist_A = Number(params.disturbance.Amp) * this.inv_scale_factor;      // Amplitude A
        this.dist_frequency = Number(params.disturbance.frequency);                // Frequency f (Hz)
        this.dist_phase_shift = Number(params.disturbance.phase) * this.inv_scale_factor;

        this.samples = Number(params.disturbance.samples);
    }

    resetInitialConditions() {
        this.state = this.state0;
        this.vstate = this.vstate0;
        this.vartheta = this.vartheta0;
        this.cnt = 0;
        this.sigma = 0;
        this.grad = 0;
        this.gi = 0;
    }

    // ---- helpers ----

    static _toNumberOrNull(x) {
        const v = Number(x);
        return Number.isFinite(v) ? v : null;
    }

    _sanitizeInternal() {
        if (!Number.isFinite(this.state))   this.state = 0;
        if (!Number.isFinite(this.vstate))  this.vstate = 0;
        if (!Number.isFinite(this.vartheta)) this.vartheta = 0;
    }

    _safeNeighborArrays(neighborVStates, neighborEnabled) {
        const vs = Array.isArray(neighborVStates) ? neighborVStates : [];
        const en = Array.isArray(neighborEnabled) ? neighborEnabled : [];
        return { vs, en };
    }

    /**
     * Javier's coordination control law: g_i(z_i, v_i)
     */
    v_i(neighborVStates, neighborEnabled) {
        let vi = 0;
        const { vs, en } = this._safeNeighborArrays(neighborVStates, neighborEnabled);

        for (let j = 0; j < vs.length; j++) {
            if (!en[j]) continue;

            const vjRaw = vs[j];
            const vj = Algorithm._toNumberOrNull(vjRaw);
            if (vj === null) continue; // skip invalid neighbor

            const vj_scaled = vj * this.inv_scale_factor;
            const diff = this.vstate - vj_scaled;

            if (!Number.isFinite(diff)) continue;

            const mag = Math.sqrt(Math.abs(diff));
            const sgn = Math.sign(diff);
            vi += -sgn * mag;
        }
        return { vi };
    }

    /**
     * Consensus average control law: g_i(z_i, v_i)
     * - Assumes strongly connected and balanced graph to reach average consensus
     */
    g_i(neighborVStates, neighborEnabled) {
        let gi = 0;
        const { vs, en } = this._safeNeighborArrays(neighborVStates, neighborEnabled);

        for (let j = 0; j < vs.length; j++) {
            if (!en[j]) continue;

            const vjRaw = vs[j];
            const vj = Algorithm._toNumberOrNull(vjRaw);
            if (vj === null) continue; // skip invalid neighbor

            const vj_scaled = vj * this.inv_scale_factor;
            const diff = this.vstate - vj_scaled;

            if (!Number.isFinite(diff)) continue;

            gi += -diff;
        }
        return { gi };
    }

    computeDisturbance() {
        if (!this.dist_on) {
            return 0.0;
        }

        const t = this.cnt * this.dt;
        const m = this.dist_amplitude * (Math.random() - this.dist_offset);
        const sinusoidal = this.dist_A * Math.sin(
            2.0 * M_PI * this.dist_frequency * (t - this.dist_phase_shift)
        );

        const nu = m + this.dist_beta + sinusoidal;
        return nu;
    }

    discrete_step(neighborVStates, neighborEnabled) {
        // Make sure internal values are finite before computing
        this._sanitizeInternal();

        const disturbance = this.computeDisturbance() * this.dt;

        let giVal = 0;
        if (this.consensual_avg_law) {
            ({ gi: giVal } = this.g_i(neighborVStates, neighborEnabled));
        } else {
            ({ vi: giVal } = this.v_i(neighborVStates, neighborEnabled));
        }
        this.gi = this.alpha * giVal;

        this.sigma = this.state - this.vstate;
        this.grad = Math.sign(this.sigma);

        const u = this.gi - this.vartheta * this.grad;

        let dvtheta = 0;
        if (Math.abs(this.sigma) > this.delta) {
            dvtheta = 1.0;
        } else {
            dvtheta = 0.0;
        }

        this.state   = Math.max(this.state   + u + disturbance, 0);
        this.vstate  = Math.max(this.vstate  + this.gi,          0);
        this.vartheta= Math.max(this.vartheta+ this.eta * dvtheta, 0);

        this.cnt = (this.cnt + 1) % this.samples;

        // Final sanitization before output
        this._sanitizeInternal();

        const out_x  = Math.round(this.state   * this.scale_factor);
        const out_z  = Math.round(this.vstate  * this.scale_factor);
        const out_th = Math.round(this.vartheta* this.scale_factor);

        return {
            state:   out_x,
            vstate:  out_z,
            vartheta:out_th
        };
    }

    update(neighborVStates, neighborEnabled) {
        // Continuous-time style / event-triggered variant

        this._sanitizeInternal();

        const disturbance = this.computeDisturbance();

        let viVal = 0;
        ({ vi: viVal } = this.v_i(neighborVStates, neighborEnabled));
        this.gi = viVal;

        this.sigma = this.state - this.vstate;
        this.grad = Math.sign(this.sigma);

        const u = this.gi - this.vartheta * this.grad;

        let dvtheta = 0;
        if (this.active === 0) {
            if (Math.abs(this.sigma) > this.epsilonON) {
                this.active = 1;
                dvtheta = this.eta;
            }
        } else {
            if (Math.abs(this.sigma) <= this.epsilonOFF) {
                this.active = 0;
            } else {
                dvtheta = this.eta;
            }
        }

        this.state   = Math.max(this.state   + this.dt * (u + disturbance), 0);
        this.vstate  = Math.max(this.vstate  + this.dt * this.gi,           0);
        this.vartheta= Math.max(this.vartheta+ this.dt * dvtheta,           0);

        this.cnt = (this.cnt + 1) % this.samples;

        this._sanitizeInternal();

        const out_x  = Math.round(this.state   * this.scale_factor);
        const out_z  = Math.round(this.vstate  * this.scale_factor);
        const out_th = Math.round(this.vartheta* this.scale_factor);

        return {
            state:   out_x,
            vstate:  out_z,
            vartheta:out_th
        };
    }

}

// Exports:
const algo = new Algorithm();
module.exports = {
    algo
};
