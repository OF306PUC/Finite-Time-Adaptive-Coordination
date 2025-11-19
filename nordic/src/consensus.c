#include <math.h>
#include "consensus.h"

float disturbance(consensus_params* cp) {
    float nu = 0.0f;
    if (!cp->disturbance.disturbance_on) {
        nu = 0.0f; 
    } else {
        // Scaling factors
        float amp = (float)cp->disturbance.amplitude * cp->inv_scale_factor;
        float off = (float)cp->disturbance.offset * cp->inv_scale_factor;
        float beta = (float)cp->disturbance.beta * cp->inv_scale_factor;
        float A = (float)cp->disturbance.A * cp->inv_scale_factor; 
        float f = (float)cp->disturbance.frequency;                                    
        float phi_shift_s = (float)cp->disturbance.phase * cp->inv_scale_factor;       
        float t = (float)cp->disturbance.counter * (float)cp->dt * cp->inv_scale_factor; // dt must be scaled to seconds
        float m = amp * ((float)rand() / (float)RAND_MAX - off); 
        float sinusoidal = A * sinf(2.0f * M_PI * f * (t - phi_shift_s));
        nu = m + beta + sinusoidal;
    } 
    return nu; 
}

float sign(float x) {
    if (x > 0.0f) {
        return 1.0f;
    } else if (x < 0.0f) {
        return -1.0f;
    } else {
        return 0.0f;
    }
}

float max_of_two_non_negative_f(float a, float b) {
    float max_val = fmaxf(a, b);
    return fmaxf(0.0f, max_val); 
}

/**
 * Javier's coordination control law: g_i(z_i, v_i)
 */
float v_i(consensus_params* cp) {
    float vstate_f = (float)(cp->vstate * cp->inv_scale_factor);
    float vi = 0.0f;
    for (int j = 0; j < cp->N; j++) {
        if (cp->neighbor_enabled[j]) {
            float diff = vstate_f - (float)(cp->neighbor_vstates[j] * cp->inv_scale_factor);
            vi += -1.0f * sign(diff) * sqrtf(fabsf(diff));
        }
    }
    return vi;
}

/**
 * Consensus average control law: g_i(z_i, v_i)
 * - Assumes strongly connected and balanced graph to reach average consensus
 */
float g_i(consensus_params* cp){
    float x_f = (float)(cp->state * cp->inv_scale_factor);
    float vi = 0.0f; 
    for (int j = 0; j < cp->N; j++) {
        if (cp->neighbor_enabled[j]) {
            float diff = x_f - (float)(cp->neighbor_vstates[j] * cp->inv_scale_factor);
            vi += -1.0f * diff;
        }
    }
    return vi;
}

void discrete_step(consensus_params* cp) {
    /**
     * Intended to be run at the same frequency as the fetching of neighbor states
     * No time scaling is applied here. 
     */
    float x = (float)(cp->state * cp->inv_scale_factor);
    float z = (float)(cp->vstate * cp->inv_scale_factor);
    float vartheta = (float)(cp->vartheta * cp->inv_scale_factor);

    float eta = (float)(cp->eta * cp->inv_scale_factor);        // eta = 1e-6f
    float alpha = (float)(cp->alpha * cp->inv_scale_factor);    // alpha = 1e-1f

    float delta = (float)(cp->delta * cp->inv_scale_factor);    // delta = 1e-2f

    float nu = disturbance(cp); // * sclaing_disturbance: max(d_i) = 2e-3; 
    float sigma = x - z;
    float grad = sign(sigma);
    
    float gi = alpha * g_i(cp); // if (average consensus law) else v_i(cp) if (Javier's law)
    float u = gi - vartheta * grad;

    float dvtheta = 0.0f; 
    if ((float)(fabs(sigma)) > cp->delta) {
        dvtheta = 1.0f; 
    } else {
        dvtheta = 0.0f; 
    }

    cp->state = (int32_t)(max_of_two_non_negative_f(x + u + nu, 0.0f) * cp->scale_factor);
    cp->vstate = (int32_t)(max_of_two_non_negative_f(z + gi , 0.0f) * cp->scale_factor);
    cp->vartheta = (int32_t)(max_of_two_non_negative_f(vartheta + eta * dvtheta , 0.0f) * cp->scale_factor);
}

void update_consensus(consensus_params* cp) {
    float dt = (float)(cp->dt) * 1e-3f; // Convert ms to seconds
    float x = (float)(cp->state * cp->inv_scale_factor);
    float z = (float)(cp->vstate * cp->inv_scale_factor);
    float vartheta = (float)(cp->vartheta * cp->inv_scale_factor);
    float eta = (float)(cp->eta * cp->inv_scale_factor);

    float nu = disturbance(cp);
    float sigma = x - z; 
    float grad = sign(sigma); 
    float vi = v_i(cp);
    float gi = vi; 
    float ui = gi - vartheta * grad; 

    float dvtheta = 0.0f; 
    if (cp->active == 0){ 
        if ((float)fabs(sigma) > cp->epsilonON){
            cp->active = 1;
            dvtheta = eta * 1.0f; 
        } else {
            dvtheta = 0.0f; 
        }
    } else {
        if ((float)fabs(sigma) <= cp->epsilonOFF){
            cp->active = 0;
            dvtheta = 0.0f; 
        } else {
            dvtheta = eta * 1.0f; 
        }
    }
    cp->state = (int32_t)(max_of_two_non_negative_f(x + dt * (ui + nu), 0.0f) * cp->scale_factor);
    cp->vstate = (int32_t)(max_of_two_non_negative_f(z + dt * gi, 0.0f) * cp->scale_factor);
    cp->vartheta = (int32_t)(max_of_two_non_negative_f(vartheta + dt * dvtheta, 0.0f) * cp->scale_factor);
    cp->disturbance.counter = (cp->disturbance.counter + 1) % cp->disturbance.samples;
}
