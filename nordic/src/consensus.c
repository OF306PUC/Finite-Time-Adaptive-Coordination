#include <math.h>
#include "consensus.h"

#include <zephyr/logging/log.h>
// Register the logger for this module
LOG_MODULE_REGISTER(Module_Consensus, LOG_LEVEL_INF);


static bool available_neighbors[N_MAX_NEIGHBORS] = {false};
static bool neighbor_enabled[N_MAX_NEIGHBORS] = {false};
static uint8_t neighbors[N_MAX_NEIGHBORS] = {0};
static int32_t neighbor_vstates[N_MAX_NEIGHBORS] = {0};

consensus_params consensus; 

void consensus_init(void) {
    consensus.discrete_time          = true;
    consensus.running                = false;                  
    consensus.enabled                = false;                 
    consensus.first_time_running     = true;                    // always true at the begging of the execution              
    consensus.all_neighbors_observed = false;                 
    consensus.available_neighbors    = available_neighbors;    
    consensus.node                   = 0;                     
    consensus.neighbors              = neighbors;              
    consensus.scale_factor           = 1e6f;                    // must be the same as in raspberry/algo.js      
    consensus.inv_scale_factor       = 1e-6f;                   // must be the same as in raspberry/algo.js      
    consensus.N                      = 0;                  
    consensus.time0                  = 0;                
    consensus.Ts                     = 0;                   
    consensus.dt                     = 0;                   
    consensus.state0                 = 0;               
    consensus.vstate0                = 0;              
    consensus.vartheta0              = 0;            
    consensus.alpha                  = 0;                
    consensus.eta                    = 0;                  
    consensus.delta                  = 0;                
    consensus.state                  = 0;                
    consensus.vstate                 = 0;               
    consensus.vartheta               = 0;             
    consensus.active                 = 0;               
    consensus.epsilonON              = 0.01f;                   // must be the same as in raspberry/algo.js         
    consensus.epsilonOFF             = 0.05f;                   // must be the same as in raspberry/algo.js
    consensus.neighbor_enabled       = neighbor_enabled;       
    consensus.neighbor_vstates       = neighbor_vstates;      
    consensus.disturbance            = (disturbance_params){false, 0, 0, 0, 0, 0, 0, 0, 0};  
}


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
    float z_f = (float)(cp->vstate * cp->inv_scale_factor);
    float vi = 0.0f; 
    for (int j = 0; j < cp->N; j++) {
        if (cp->neighbor_enabled[j]) {
            float diff = z_f - (float)(cp->neighbor_vstates[j] * cp->inv_scale_factor);
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
    float dt = (float)(cp->dt) * 1e-3f; // Convert ms to seconds
    float x = (float)(cp->state * cp->inv_scale_factor);
    float z = (float)(cp->vstate * cp->inv_scale_factor);
    float vartheta = (float)(cp->vartheta * cp->inv_scale_factor);

    float eta = (float)(cp->eta * cp->inv_scale_factor);      
    float alpha = (float)(cp->alpha * cp->inv_scale_factor);   

    float delta = (float)(cp->delta * cp->inv_scale_factor);   

    float nu = disturbance(cp) * dt; 
    float sigma = x - z;
    float grad = sign(sigma);
    
    float gi = alpha * g_i(cp); // if (average consensus law) else v_i(cp) if (Javier's law)
    float u = gi - vartheta * grad;

    float dvtheta = (fabsf(sigma) > delta) ? 1.0f : 0.0f;

    cp->state = (int32_t)(max_of_two_non_negative_f(x + u + nu, 0.0f) * cp->scale_factor);
    cp->vstate = (int32_t)(max_of_two_non_negative_f(z + gi, 0.0f) * cp->scale_factor);
    // Fixed-point rounding for (uint32_t)((vartheta + eta * dvtheta) * cp->scale_factor);
    uint32_t eta_dvtheta = (uint32_t)(eta * dvtheta * cp->scale_factor);
    cp->vartheta += eta_dvtheta;
    cp->disturbance.counter = (cp->disturbance.counter + 1) % cp->disturbance.samples;
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
