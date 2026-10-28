#include <stddef.h>
#include <stdint.h>
#include "Lyra2.h"

static void *context;
static uint8_t input[65536];
static uint8_t output[32];

int engine_init(void) {
    if (!context) context = LYRA2_create();
    return context != NULL;
}
uint8_t *engine_input(void) { return input; }
uint8_t *engine_output(void) { return output; }
int engine_hash(int length, int cost) {
    if (!context || length < 0 || length >= 65536 || (cost != 1 && cost != 4)) return -1;
    return LYRA2(context, output, 32, input, length, cost);
}