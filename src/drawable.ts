export class PlotlyData {
    constructor(
        public traces: any[],
        public shapes: any[],
        public colorId: number)
    {}
}

export class Drawable {
    toPlotly(colorId: number): PlotlyData {
        return new PlotlyData([], [], colorId);
    }
};

export enum PlotStyle { LinesAndMarkers, Lines, Markers, Bars };

export class Plot extends Drawable {
    constructor(
        public readonly xs: number[] | undefined,
        public readonly ys: number[],
        public plotStyle: PlotStyle = PlotStyle.LinesAndMarkers) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = new PlotlyData([], [], colorId);
        if (this.ys.length > 0) {
            let trace: any = {
                x: this.xs === undefined ? Array.from(Array(this.ys.length).keys()) : this.xs,
                y: this.ys
            };
            if (this.plotStyle === PlotStyle.Bars)
                trace.type = "bar";
            else {
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
        let result = new PlotlyData([], [], colorId);
        for (let drawable of this.drawables) {
            const data = drawable.toPlotly(colorId);
            for (const trace of data.traces)
                result.traces.push(trace);
            for (const shape of data.shapes)
                result.shapes.push(shape);
        }
        return result;
    }
};


export class Geometry extends Drawable {
}

export class Point extends Geometry {
    constructor(
        public readonly x: number,
        public readonly y: number) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let trace = {
            x: [this.x],
            y: [this.y],
            type: "scatter",
            mode: "markers"
        };
        return new PlotlyData([trace], [], colorId);
    }
}

export class Ring extends Drawable {
    constructor(
        public readonly xs: number[],
        public readonly ys: number[]) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = new PlotlyData([], [], colorId);
        const length = Math.min(this.xs.length, this.ys.length);
        if (length > 0) {
            let path: string = 'M' + this.xs[0] + ',' + this.ys[0] + ' ';
            for (let i = 1 ; i < length ; ++i) {
                path += 'L' + this.xs[i] + ',' + this.ys[i] + ' ';
            }
            path += 'Z';
            result.traces = [{
                x: this.xs,
                y: this.ys,
                type: "scatter",
                mode: "markers"
            }];
            result.shapes = [{
                path: path,
                type: "path"
            }];
        }
        return result;
    }
};

export class Polygon extends Drawable {
    constructor(
        public readonly exteriorRing: Ring,
        public readonly interiorRings: Ring[]) {
        super();
    }
    toPlotly(colorId: number): PlotlyData {
        let result = this.exteriorRing.toPlotly(colorId);
        for (let interiorRing of this.interiorRings) {
            const d = interiorRing.toPlotly(colorId);
            // The result may contain multiple traces and one shape
            for (const trace of d.traces)
                result.traces.push(trace);
            if (result.shapes.length < 1)
                result.shapes = d.shapes;
            else if (d.shapes.length > 0)
                result.shapes[0].path += ' ' + d.shapes[0].path;
        }
        return result;
    }
};
