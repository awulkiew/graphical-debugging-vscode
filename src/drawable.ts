export class DrawableData {
    constructor(
        public trace: any,
        public shape: any,
        public colorId: number)
    {}
}

export class Drawable {
    toData(colorId: number): DrawableData {
        return new DrawableData(undefined, undefined, colorId);
    }
};

export class Plot extends Drawable {
    constructor(
        public readonly xs: number[] | undefined,
        public readonly ys: number[]) {
        super();
    }
    toData(colorId: number): any {
        let trace: any = undefined;
        if (this.ys.length > 0) {
            trace = {
                x: this.xs === undefined ? Array.from(Array(this.ys.length).keys()) : this.xs,
                y: this.ys,
                type: "scatter",
                mode: "lines+markers",
                hoverinfo: "x+y",
                line: { color: "#888" }
            };
        }
        return new DrawableData(trace, undefined, colorId);
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
    toData(colorId: number): any {
        let trace = {
            x: [this.x],
            y: [this.y],
            type: "scatter",
            mode: "markers",
            hoverinfo: "x+y",
            line: { color: "#888" }
        };
        return new DrawableData(trace, undefined, colorId);
    }
}

export class Ring extends Drawable {
    constructor(
        public readonly xs: number[],
        public readonly ys: number[]) {
        super();
    }
    toData(colorId: number): any {
        let trace: any = undefined;
        let shape: any = undefined;
        const length = Math.min(this.xs.length, this.ys.length);
        if (length > 0) {
            let path: string = 'M' + this.xs[0] + ',' + this.ys[0] + ' ';
            for (let i = 1 ; i < length ; ++i) {
                path += 'L' + this.xs[i] + ',' + this.ys[i] + ' ';
            }
            path += 'Z';
            trace = {
                x: this.xs,
                y: this.ys,
                type: "scatter",
                mode: "markers",
                hoverinfo: "x+y",
                line: { color: "#888" }
            };
            shape = {
                path: path,
                type: "path",
                fillcolor: "#888",
                line: { color: "888" }
            };
        }
        return new DrawableData(trace, shape, colorId);
    }
};