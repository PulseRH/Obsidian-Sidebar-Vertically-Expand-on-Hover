export interface SidebarExpandSettings {
    expansionAmount: number;
    transitionDuration: number;
    notebookNavigatorSupport: boolean;
    fullHeightEnabled: boolean;
    fullHeightHoldKey: 'Alt' | 'Control' | 'Shift' | 'Meta' | 'None';
}

export function normalizeSettings(value: unknown): SidebarExpandSettings {
    const saved = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
    const bounded = (input: unknown, fallback: number, min: number, max: number): number =>
        typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback;
    return {
        expansionAmount: bounded(saved.expansionAmount, 12, 4, 50),
        transitionDuration: bounded(saved.transitionDuration, 300, 0, 2000),
        notebookNavigatorSupport: saved.notebookNavigatorSupport !== false,
        fullHeightEnabled: saved.fullHeightEnabled === true,
        fullHeightHoldKey: saved.fullHeightHoldKey === 'Control' || saved.fullHeightHoldKey === 'Shift' ||
            saved.fullHeightHoldKey === 'Meta' || saved.fullHeightHoldKey === 'None' ? saved.fullHeightHoldKey : 'Alt'
    };
}

/** Keep total height fixed and never shrink a sibling below its available minimum. */
export function targetHeights(heights: number[], active: number, percent: number, minimums = heights.map(height => Math.min(40, height))): number[] {
    const result = [...heights];
    if (active < 0 || active >= heights.length || heights.length < 2) return result;
    const requested = heights.reduce((sum, height) => sum + height, 0) * percent / 100;
    const above = heights.map((_, i) => i).filter(i => i < active);
    const below = heights.map((_, i) => i).filter(i => i > active);
    const take = (indices: number[], amount: number): number => {
        let remaining = amount;
        let available = indices.filter(i => result[i] > minimums[i]);
        while (remaining > 0.001 && available.length > 0) {
            const share = remaining / available.length;
            for (const i of available) {
                const shrink = Math.min(share, result[i] - minimums[i]);
                result[i] -= shrink;
                remaining -= shrink;
            }
            available = available.filter(i => result[i] > minimums[i] + 0.001);
        }
        return amount - remaining;
    };
    let taken = take(above, below.length ? requested / 2 : requested);
    taken += take(below, above.length ? requested / 2 : requested);
    taken += take([...above, ...below], requested - taken);
    result[active] += taken;
    return result;
}

/** Match the local Notebook Navigator proportions while retaining custom pane sizes. */
export function notebookNavigatorHeights(heights: number[], active: number): number[] {
    if (active < 0 || active >= heights.length || heights.length < 2) return [...heights];
    const total = heights.reduce((sum, height) => sum + height, 0);
    const target = total * (heights.length === 2 ? 0.66 : 0.42);
    const requested = Math.max(0, target - heights[active]);
    const minimums = heights.map(height => Math.min(height, Math.max(60, height * 0.2)));
    return targetHeights(heights, active, total > 0 ? requested / total * 100 : 0, minimums);
}
