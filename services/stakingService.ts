// services/stakingService.ts
// Professional Capital Management System — Proportional Flat Staking with Unit System
// Based on industry research: Pinnacle, Smart Betting Club, professional syndicates

export interface StakingConfig {
    // Singles by probability band (units)
    singles_83_87: number;
    singles_87_90: number;
    singles_90_plus: number;
    // Limits (units)
    max_single_bet: number;
    max_total_exposure: number;
    // Unit definition: 1 unit = X% of bankroll
    unit_value_percent: number;
}

export const DEFAULT_STAKING_CONFIG: StakingConfig = {
    singles_83_87: 2,       // 2 units (2%) — base confidence
    singles_87_90: 3,       // 3 units (3%) — high confidence
    singles_90_plus: 4,     // 4 units (4%) — max confidence (rare)
    max_single_bet: 5,      // 5 units (5%) max per single bet
    max_total_exposure: 15, // 15 units (15%) max simultaneous
    unit_value_percent: 1,  // 1 unit = 1% of bankroll
};

/**
 * Get stake in units for a single pick by confidence band.
 */
export function getStakeUnits(
    config: StakingConfig,
    _type: 'single',
    pModel?: number
): number {
    const prob = normalizePModel(pModel || 0.83);
    if (prob >= 0.90) return Math.min(config.singles_90_plus, config.max_single_bet);
    if (prob >= 0.87) return Math.min(config.singles_87_90, config.max_single_bet);
    return Math.min(config.singles_83_87, config.max_single_bet);
}

/**
 * Convert units to percentage of bankroll.
 */
export function getStakePercent(units: number, config: StakingConfig): number {
    return Math.min(units * config.unit_value_percent, config.max_single_bet * config.unit_value_percent);
}

/**
 * Calculate monetary stake amount from bankroll and units.
 */
export function getStakeAmount(bankroll: number, units: number, config: StakingConfig): number {
    const percent = getStakePercent(units, config);
    return bankroll * (percent / 100);
}

/**
 * Calculate profit/loss for a resolved bet.
 */
export function calculateProfitLoss(
    result: 'WON' | 'LOST' | 'VOID' | 'PUSH' | string,
    stakeAmount: number,
    odds: number
): number {
    const upperResult = result.toUpperCase();
    if (upperResult === 'WON') return stakeAmount * (odds - 1);
    if (upperResult === 'LOST') return -stakeAmount;
    return 0; // VOID, PUSH
}

/**
 * Calculate profit in units for a resolved bet.
 */
export function calculateUnitProfit(
    result: 'WON' | 'LOST' | 'VOID' | 'PUSH' | string,
    units: number,
    odds: number
): number {
    const upperResult = result.toUpperCase();
    if (upperResult === 'WON') return units * (odds - 1);
    if (upperResult === 'LOST') return -units;
    return 0;
}

/**
 * Get a human-readable staking label (e.g., "2u @1.85").
 */
export function getStakingLabel(units: number, odds?: number | null): string {
    const oddsStr = odds ? ` @${odds.toFixed(2)}` : '';
    return `${units}u${oddsStr}`;
}

/**
 * Normalize p_model to 0-1 scale.
 */
export function normalizePModel(pModel: number): number {
    return pModel > 1 ? pModel / 100 : pModel;
}

/**
 * Calculate max drawdown from a bankroll history.
 * Returns percentage (0-100).
 */
export function calculateMaxDrawdown(bankrollHistory: number[]): number {
    if (bankrollHistory.length === 0) return 0;
    let peak = bankrollHistory[0];
    let maxDd = 0;
    for (const val of bankrollHistory) {
        if (val > peak) peak = val;
        const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
}

/**
 * Validate that a new bet doesn't exceed exposure limits.
 */
export function validateExposure(
    activeUnits: number,
    newBetUnits: number,
    config: StakingConfig
): { allowed: boolean; reason?: string } {
    if (newBetUnits > config.max_single_bet) {
        return {
            allowed: false,
            reason: `Apuesta (${newBetUnits}u) excede límite individual (${config.max_single_bet}u)`
        };
    }
    const totalExposure = activeUnits + newBetUnits;
    if (totalExposure > config.max_total_exposure) {
        return {
            allowed: false,
            reason: `Exposición total (${totalExposure}u) excede límite (${config.max_total_exposure}u)`
        };
    }
    return { allowed: true };
}

/**
 * Get default odds when actual odds are not available.
 * Uses a conservative estimate based on probability.
 */
export function getEffectiveOdds(odds: number | null | undefined, pModel?: number): number {
    if (odds && odds > 1) return odds;
    // Conservative estimate: if we know the probability, use fair odds
    if (pModel) {
        const prob = normalizePModel(pModel);
        if (prob > 0 && prob < 1) return Math.max(1 / prob, 1.20);
    }
    return 1.50; // Safe default
}
