#ifndef CONSENSUS_H
#define CONSENSUS_H

#include <stdlib.h>
#include <stdint.h>
#include <zephyr/kernel.h>
#include "common.h"

#define M_PI 3.14159265358979323846f

/**
 * Custom type to store disturbance parameters sent by user through UART
 */
typedef struct {
    bool disturbance_on; 
    // Uniform disturbance parameters:
    int32_t offset;
    int32_t amplitude;
    // Constant disturbance parameter:
    int32_t beta;
    // Sinusoidal disturbance parameters:
    int32_t A;
    int32_t frequency;
    int32_t phase; 
    uint32_t counter; 
    uint32_t samples; 
} disturbance_params;

/**
 * Custom type to store consensus parameters sent by user through UART
 */
typedef struct {
    bool running; 
    bool enabled; 
    bool first_time_running; 
    bool all_neighbors_observed; 
    bool* available_neighbors; 
    uint8_t node; 
    uint8_t* neighbors; 
    float scale_factor; 
    float inv_scale_factor; 
    uint8_t N; 
    int64_t time0; 
    int32_t Ts; 
    int32_t dt; 
    int32_t state0; 
    int32_t vstate0; 
    int32_t vartheta0;
    int32_t eta; 
    int32_t state; 
    int32_t vstate;
    int32_t vartheta;
    uint8_t active; 
    float epsilonON;
    float epsilonOFF; 
    bool* neighbor_enabled; 
    int32_t* neighbor_vstates;
    disturbance_params disturbance;
} consensus_params;

/**
 * Global consensus parameters instance
 */
extern consensus_params consensus;

float sign(float x);
float max_of_two_non_negative_f(float a, float b);
float disturbance(consensus_params* cp);
float v_i(consensus_params* cp);
void update_consensus(consensus_params* cp);


#endif // CONSENSUS_H