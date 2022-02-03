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
    const n = lon >= 360 || lon < 0 ? lon % 360 : lon;
    return n < 0 ? n + 360 : n;
}

export class LonInterval {
    constructor(public min: number,
                public max: number)
    {}

    // This function requires longitueds to be signed-normalized
    private static uLonDist(l1: number, l2: number): number {
        const d = l2 - l1; // (-360, 360)
        return d < 0 ? d + 360 : d; // [0, 360)
    }

    // This is ok for multipoints, not for segments, but it's good enough
    // With segments there is also a special case: 180 deg distance between points
    //   in this case segment can go either way.
    // The result is interval smaller than 360
    static fromPoints(xs: number[] | undefined): LonInterval {
        if (xs === undefined || xs.length < 1)
            return new LonInterval(0, 0);
        let min = sLon(xs[0]); // (-180, 180]
        let max = min;
        let ud = 0;
        for (let i = 1; i < xs.length; ++i) {
            const lon = sLon(xs[i]);
            const udmin = LonInterval.uLonDist(min, lon);
            // if the point is outside
            if (udmin > ud) {
                const udmax = LonInterval.uLonDist(lon, max);
                if (udmin < udmax) {
                    max = lon;
                    ud = udmin;
                } else {
                    min = lon;
                    ud = udmax;
                }
            }
        }
        if (max < min)
            max = max + 360;
        return new LonInterval(min, max); // (-180, 180] , (-180, 540]
    }

    // Not fully correct but good enough
    static fromIntervals(intervals: LonInterval[] | undefined): LonInterval {
        if (intervals === undefined || intervals.length < 1)
            return new LonInterval(0, 0);
        let min = intervals[0].min;
        let max = intervals[0].max;
        let ud = max - min;
        for (let i = 1; i < intervals.length; ++i) {
            let min2 = intervals[i].min;
            let max2 = intervals[i].max;
            let ud2 = max2 - min2;
            if (ud2 > ud) { // if the next interval is greater swap intervals
                [min, min2] = [min2, min];
                [max, max2] = [max2, max];
                [ud, ud2] = [ud2, ud];
            }
            // TODO: This will not work for 360 degrees because it is normalized to 0
            const udmin = uLon(max2 - min);
            const udmax = uLon(max - min2);
            // if the interval is outside
            if (udmin > ud && udmax > ud) {
                if (udmin < udmax) {
                    max = max2;
                    ud = udmin;
                }
                else {
                    min = min2;
                    ud = udmax;
                }
            }
            else if (udmin > ud) {
                max = max2;
                ud = udmin;
            }
            else if (udmax > ud) {
                min = min2;
                ud = udmax;
            }
            if (ud >= 360)
                break;
        }
        min = sLon(min);
        max = sLon(max);
        if (max < min)
            max += 360;
        return new LonInterval(min, max);
    }
}
