export enum System { None, Cartesian, Geographic, Complex };

export class PlotlyData {
    constructor(
        public traces: any[],
        public system: System,
        public colorId: number)
    {}

    static empty(colorId: number) {
        return new PlotlyData([], System.None, colorId);
    }
}

function createTrace(xs: number[] | undefined, ys: number[], system: System): any {
    return system === System.Geographic
        ? {
            lon: xs === undefined ? Array.from(Array(ys.length).keys()) : xs,
            lat: ys
        } : {
            x: xs === undefined ? Array.from(Array(ys.length).keys()) : xs,
            y: ys
        };
}

export class Drawable {
    toPlotly(colorId: number): PlotlyData {
        return PlotlyData.empty(colorId);
    }
};

export enum PlotStyle { LinesAndMarkers, Lines, Markers, Bars };

export class Plot extends Drawable {
    constructor(
        public readonly xs: number[] | undefined,
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
        }
        return result;
    }
};

export class Drawables extends Drawable {
    constructor(public readonly drawables: Drawable[]) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = PlotlyData.empty(colorId);
        for (let drawable of this.drawables) {
            const data = drawable.toPlotly(colorId);
            if (result.system === System.None)
                result.system = data.system;
            for (const trace of data.traces)
                result.traces.push(trace);
        }
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
        let trace = this.system !== System.Geographic
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
        return new PlotlyData([trace], this.system, colorId);
    }
}

export class Ring extends Drawable {
    constructor(
        public readonly xs: number[],
        public readonly ys: number[],
        public readonly system: System) {
        super();
        // naiively close the ring
        if (xs.length > 0 && ys.length > 0) {
            this.xs.push(xs[0]);
            this.ys.push(ys[0]);
        }
    }
    toPlotly(colorId: number): PlotlyData {
        let result = PlotlyData.empty(colorId);
        result.system = this.system;
        const length = Math.min(this.xs.length, this.ys.length);
        if (length > 0) {
            result.traces = [
                this.system !== System.Geographic
                ? {
                    x: this.xs,
                    y: this.ys,
                    type: "scatter",
                    mode: "lines+markers",
                    fill: 'toself'
                } : {
                    lon: this.xs,
                    lat: this.ys,
                    type: "scattergeo",
                    mode: "lines+markers",
                    fill: 'toself'
                }];
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
        for (let interiorRing of this.interiorRings) {
            const d = interiorRing.toPlotly(colorId);
            for (const trace of d.traces)
                result.traces.push(trace);
        }
        return result;
    }
};
