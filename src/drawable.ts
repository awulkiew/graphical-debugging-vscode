import * as util from './util'

export enum System { None, Cartesian, Geographic, Complex };

export class DirectionMarker {
    constructor(
        public x: number,
        public y: number,
        public angle: number)
    {}
}

export class PlotlyData {
    constructor(
        public traces: any[],
        public system: System,
        public lonInterval: util.LonInterval,
        public colorId: number)
    {}

    public directions: DirectionMarker[] = [];

    static empty(colorId: number) {
        return new PlotlyData([], System.None, new util.LonInterval(0, 0), colorId);
    }
}

function createTrace(xs: number[], ys: number[], system: System): any {
    return system === System.Geographic
        ? {
            lon: xs === undefined ? Array.from(Array(ys.length).keys()) : xs,
            lat: ys
        } : {
            x: xs === undefined ? Array.from(Array(ys.length).keys()) : xs,
            y: ys
        };
}

function direction(xs: number[], ys: number[], reversed: boolean, system: System) : DirectionMarker | undefined {
    const isGeographic = system === System.Geographic;
    const s = !reversed ? util.firstSegment(xs, ys, isGeographic) : util.rFirstSegment(xs, ys, isGeographic);
    if (s === undefined)
        return undefined;
    const a = util.azimuth(s.xs[0], s.ys[0], s.xs[1], s.ys[1], isGeographic);
    if (a === undefined)
        return undefined;
    return new DirectionMarker(s.xs[0], s.ys[0], a);
}

export class Drawable {
    toPlotly(colorId: number): PlotlyData {
        return PlotlyData.empty(colorId);
    }
};

export enum PlotStyle { LinesAndMarkers, Lines, Markers, Bars };

export class Plot extends Drawable {
    constructor(
        public readonly xs: number[],
        public readonly ys: number[],
        public readonly system: System,
        public plotStyle: PlotStyle = PlotStyle.LinesAndMarkers) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = PlotlyData.empty(colorId);
        result.system = this.system;
        if (this.ys.length > 0) {
            let trace = createTrace(this.xs, this.ys, this.system);
            if (this.plotStyle === PlotStyle.Bars)
                trace.type = "bar";
            else {
                if (this.system === System.Geographic)
                    trace.type = "scattergeo";
                else
                    trace.type = "scatter";
                if (this.plotStyle === PlotStyle.Lines)
                    trace.mode = "lines";
                else if (this.plotStyle === PlotStyle.Markers)
                    trace.mode = "markers";
                else
                    trace.mode = "lines+markers";
            }
            result.traces = [trace];
            if (this.plotStyle === PlotStyle.Lines || this.plotStyle === PlotStyle.LinesAndMarkers) {
                const dir = direction(this.xs, this.ys, false, this.system);
                if (dir !== undefined) {
                    result.directions.push(dir);
                }
            }
        }
        if (this.system === System.Geographic)
            result.lonInterval = util.LonInterval.fromPoints(this.xs);
        return result;
    }
};

export class Drawables extends Drawable {
    constructor(public readonly drawables: Drawable[]) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = PlotlyData.empty(colorId);
        let intervals: util.LonInterval[] = [];
        for (let drawable of this.drawables) {
            const data = drawable.toPlotly(colorId);
            if (result.system === System.None)
                result.system = data.system;
            for (const trace of data.traces)
                result.traces.push(trace);
            if (data.system === System.Geographic)
                intervals.push(data.lonInterval);
        }
        result.lonInterval = util.LonInterval.fromIntervals(intervals);
        return result;
    }
};


export class Geometry extends Drawable {
}

export class Point extends Geometry {
    constructor(
        public readonly x: number,
        public readonly y: number,
        public readonly system: System) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        const trace = this.system !== System.Geographic
            ? {
                x: [this.x],
                y: [this.y],
                type: "scatter",
                mode: "markers"
            } : {
                lon: [this.x],
                lat: [this.y],
                type: "scattergeo",
                mode: "markers"
            };
        return new PlotlyData([trace], this.system, new util.LonInterval(this.x, this.x), colorId);
    }
}

export class Ring extends Drawable {
    constructor(
        public readonly xs: number[],
        public readonly ys: number[],
        public readonly reversed: boolean,
        public readonly system: System,
        private readonly _isBox: boolean = false) {
        super();
        // close the ring
        if (ys.length >= 2) {
            // TODO: In geographic this may not detect the same points
            if (xs[0] != xs[xs.length - 1] || ys[0] != ys[ys.length - 1]) {
                this.xs.push(xs[0]);
                this.ys.push(ys[0]);
            }
        }
        if (reversed) {
            this.xs.reverse();
            this.ys.reverse();
        }
    }
    toPlotly(colorId: number): PlotlyData {
        let result = PlotlyData.empty(colorId);
        result.system = this.system;
        result.traces = [
            this.system !== System.Geographic
            ? {
                x: this.xs,
                y: this.ys,
                type: "scatter",
                mode: this._isBox ? "lines" : "lines+markers",
                fill: 'toself'
            } : {
                lon: this.xs,
                lat: this.ys,
                type: "scattergeo",
                mode: this._isBox ? "lines" : "lines+markers",
                fill: 'toself'
            }];
        if (this.system === System.Geographic) {
            result.lonInterval = util.LonInterval.fromPoints(this.xs);
        }
        if (this.ys.length > 0) {
            const dir = direction(this.xs, this.ys, this.reversed, this.system);
            if (dir !== undefined) {
                result.directions.push(dir);
            }
        }
        return result;
    }
};

export class Polygon extends Drawable {
    constructor(
        public readonly exteriorRing: Ring,
        public readonly interiorRings: Ring[] = []) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        // TODO: CW polygons are required for scattergeo
        let result = this.exteriorRing.toPlotly(colorId);
        if (result.system !== System.Geographic) {
            for (let interiorRing of this.interiorRings) {
                const d = interiorRing.toPlotly(colorId);
                result.traces[0].x.push(null);
                result.traces[0].y.push(null);
                result.traces[0].x = result.traces[0].x.concat(d.traces[0].x);
                result.traces[0].y = result.traces[0].y.concat(d.traces[0].y);
                result.directions = result.directions.concat(d.directions);
            }
        } else {
            // geographic has to be treated separately because typical way of dealing with holes does not work
            result.traces[0].mode = 'markers';
            result.traces[0].fill = 'toself';
            result.traces.push({});
            result.traces[1].lon = [].concat(result.traces[0].lon);
            result.traces[1].lat = [].concat(result.traces[0].lat);
            result.traces[1].type = result.traces[0].type;
            result.traces[1].mode = 'lines';
            let closeHoles = false;
            for (let interiorRing of this.interiorRings) {
                const d = interiorRing.toPlotly(colorId);
                result.traces[0].lon.push(result.traces[0].lon[0]);
                result.traces[0].lat.push(result.traces[0].lat[0]);
                result.traces[0].lon = result.traces[0].lon.concat(d.traces[0].lon);
                result.traces[0].lat = result.traces[0].lat.concat(d.traces[0].lat);
                result.traces[1].lon.push(null);
                result.traces[1].lat.push(null);
                result.traces[1].lon = result.traces[1].lon.concat(d.traces[0].lon);
                result.traces[1].lat = result.traces[1].lat.concat(d.traces[0].lat);
                closeHoles = true;
                result.directions = result.directions.concat(d.directions);
            }
            if (closeHoles) {
                result.traces[0].lon.push(result.traces[0].lon[0]);
                result.traces[0].lat.push(result.traces[0].lat[0]);
            }
        }
        return result;
    }
};
