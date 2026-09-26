export interface SidebarExpandSettings {
    expansionAmount: number;
    transitionDuration: number;
}

export function normalizeSettings(value: unknown): SidebarExpandSettings {
    const saved = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
    const bounded = (input: unknown, fallback: number, min: number, max: number): number =>
        typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback;
    return {
        expansionAmount: bounded(saved.expansionAmount, 18, 4, 50),
        transitionDuration: bounded(saved.transitionDuration, 300, 0, 2000)
    };
}

/** Keep total height fixed and never shrink a sibling below its available minimum. */
export function targetHeights(heights: number[], active: number, percent: number): number[] {
    const result = [...heights];
    if (active < 0 || active >= heights.length || heights.length < 2) return result;
    const requested = heights.reduce((sum, height) => sum + height, 0) * percent / 100;
    const above = heights.map((_, i) => i).filter(i => i < active);
    const below = heights.map((_, i) => i).filter(i => i > active);
    const take = (indices: number[], amount: number): number => {
        let remaining = amount;
        let available = indices.filter(i => result[i] > 40);
        while (remaining > 0.001 && available.length > 0) {
            const share = remaining / available.length;
            for (const i of available) {
                const shrink = Math.min(share, result[i] - 40);
                result[i] -= shrink;
                remaining -= shrink;
            }
            available = available.filter(i => result[i] > 40.001);
        }
        return amount - remaining;
    };
    let taken = take(above, below.length ? requested / 2 : requested);
    taken += take(below, above.length ? requested / 2 : requested);
    taken += take([...above, ...below], requested - taken);
    result[active] += taken;
    return result;
}
