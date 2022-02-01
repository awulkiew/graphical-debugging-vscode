export function bounded(v: number, min: number, max: number) {
    return Math.min(Math.max(v, min), max);
}

export function average(xs: number[] | undefined): number {
    return xs && xs.length > 0
         ? xs.reduce((prev, curr) => prev + curr) / xs.length
         : 0;
}

// (-180, 180]
export function sLon(lon: number) : number {
    const n = lon >  180 ? ((lon + 180) % 360) - 180 :
              lon < -180 ? ((lon - 180) % 360) + 180 :
              lon;
    return n == -180 ? 180 : n;
}
// [0, 360)
export function uLon(lon: number) : number {
    const n = sLon(lon);
    return n < 0 ? n + 360 : n;
}

export function lonInterval(xs: number[] | undefined): [number, number] {
    if (xs === undefined || xs.length < 1)
        return [0, 0];
    let min = xs[0];
    let max = xs[0];
    // TODO: handle special case - 180 deg distance between points
    //       in this case segment can go either way
    let ud = 0;
    for (let i = 1; i < xs.length; ++i) {
        const udmin = uLon(xs[i] - min);
        // if the point is outside
        if (udmin > ud) {
            const udmax = uLon(max - xs[i]);
            if (udmin < udmax) {
                max = xs[i];
                ud = udmin;
            } else {
                min = xs[i];
                ud = udmax;
            }
        }
        if (ud >= 360)
            break;
    }
    if (ud >= 360) {
        min = -180;
        max = 180;
    } else {
        min = sLon(min);
        max = min + ud;
    }
    return [min, max];
}

// Not fully correct but good enough
export function lonInterval2(intervals: [number, number][] | undefined): [number, number] {
    if (intervals === undefined || intervals.length < 1)
        return [0, 0];
    let min = intervals[0][0];
    let max = intervals[0][1];
    let ud = uLon(max - min);
    for (let i = 1; i < intervals.length; ++i) {
        const udmin = uLon(intervals[i][1] - min);
        const udmax = uLon(max - intervals[i][0]);
        // if the interval is outside
        if (udmin > ud && udmax > ud) {
            if (udmin < udmax)
                max = intervals[i][1];
            else
                min = intervals[i][0];
        }
        else if (udmin > ud)
            max = intervals[i][1];
        else if (udmax > ud)
            min = intervals[i][0];
        if (udmin > ud || udmax > ud)
            ud = uLon(max - min);
    }
    min = sLon(min);
    max = sLon(max);
    if (max < min)
        max += 360;
    return [min, max];
}