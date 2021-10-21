export class Drawable {
    toPlotly(color: string): any {
        return {};
    }
};

export class Plot extends Drawable {
    constructor(xs: number[] | undefined, ys: number[]) {
        super();
        this._xs = xs;
        this._ys = ys;
    }
    toPlotly(color: string): any {
        if (this._ys.length > 0) {
            return {
                x: this._xs === undefined ? Array.from(Array(this._ys.length).keys()) : this._xs,
                y: this._ys,
                type: "scatter",
                mode: "lines+markers",
                line: { color: color }
            };
        }
        else {
            return {};
        }
    }
    private _xs: number[] | undefined;
    private _ys: number[];
};

export class Geometry extends Drawable {
}

export class Point extends Geometry {
    constructor(public x: number, public y: number) {
        super();
    }
    toPlotly(color: string): any {
        return {
            x: [this.x],
            y: [this.y],
            type: "scatter",
            mode: "markers",
            line: { color: color }
        };
    }
}