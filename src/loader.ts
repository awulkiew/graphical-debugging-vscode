import * as debug from './debugger';
import * as cpp from './cpp.json';
import * as draw from './drawable'
import { InlineValueEvaluatableExpression } from 'vscode';

function parseTParams(type: string, beg: string = '<', end: string = '>', sep: string = ',') : string[] {
    let result: string[] = [];
    let param_list_index: number = 0;
    let index: number = 0;
    let param_first: number = -1;
    let param_last: number = -1;
    for (let c of type)
    {
        if (c === beg)
        {
            ++param_list_index;
        }
        else if (c === end)
        {
            if (param_last === -1 && param_list_index === 1)
                param_last = index;

            --param_list_index;
        }
        else if (c === sep)
        {
            if (param_last === -1 && param_list_index === 1)
                param_last = index;
        }
        else
        {
            if (param_first === -1 && param_list_index === 1)
                param_first = index;
        }

        if (param_first !== -1 && param_last !== -1)
        {
            while (param_first < param_last && type[param_first] === ' ')
                ++param_first;
            while (param_first < param_last && type[param_last - 1] === ' ')
                --param_last;
            result.push(type.substr(param_first, param_last - param_first));
            param_first = -1;
            param_last = -1;
        }

        ++index;
    }
    return result;
}

// function parseSubscripts(type: string, beg: string = '[', end: string = ']') : string[] {
//     let result: string[] = [];
//     // TODO:    
//     return result;
// }


export class Variable {
    constructor(
        public name: string,
        public type: string
    ) {}

    tparam(i: number): string {
        if (this._tparams === undefined)
            this._tparams = parseTParams(this.type);
        return i < this._tparams.length ? this._tparams[i] : '';
    }
    // TODO: support 2d arrays [1][2]
    // parseSubscripts
    nparam(i: number): string {
        if (this._nparams === undefined)
            this._nparams = parseTParams(this.type, '[', ']');
        return i < this._nparams.length ? this._nparams[i] : '';
    }

    private _tparams: string[] | undefined;
    private _nparams: string[] | undefined;
}


interface ExpressionPart {
    toString(variable: Variable): string;
}
class ExpressionString implements ExpressionPart {
    constructor(private _str: string) {}
    toString(variable: Variable): string { return this._str; }
}
class ExpressionThis implements ExpressionPart {
    toString(variable: Variable): string { return '(' + variable.name + ')'; }
}
class ExpressionNParam implements ExpressionPart {
    constructor(protected _i: number) {}
    toString(variable: Variable): string { return variable.nparam(this._i); }
}
class ExpressionTParam extends ExpressionNParam {
    toString(variable: Variable): string { return variable.tparam(this._i); }
}
export class Expression
{
    constructor(expression: string) {
        const regexp = new RegExp('\\$[A-Za-z_]\\w*', 'g');
        let matches = expression.matchAll(regexp);
        let index = 0;
        for (const match of matches) {
            if (match.index !== undefined) {
                if (match.index > index) {
                    this._parts.push(new ExpressionString(expression.substr(index, match.index - index)));
                    index = match.index;
                }
                
                if (match[0] === '$this') {
                    this._parts.push(new ExpressionThis());
                    index = match.index + 5;
                }
                else if (match[0].startsWith('$T')) {
                    this._parts.push(new ExpressionTParam(parseInt(match[0].substr(2))));
                    index = match.index + match[0].length;
                }
                else if (match[0].startsWith('$N')) {
                    this._parts.push(new ExpressionNParam(parseInt(match[0].substr(2))));
                    index = match.index + match[0].length;
                }
            }
        }
        if (index < expression.length) {
            this._parts.push(new ExpressionString(expression.substr(index)));
        }
    }

    toString(variable: Variable): string {
        let result: string = '';
        for (let part of this._parts) {
            result += part.toString(variable);            
        }
        return result;
    }

    private _parts : ExpressionPart[] = [];
}


class EvaluatedExpression {
    constructor(
        public expression: Expression,
        public name: string,
        public evaluated: any
    ) {}

    get type(): string { return this.evaluated.type; }
    get variable(): Variable { return new Variable(this.name, this.evaluated.type); }
}

async function evaluateExpression(dbg: debug.Debugger, variable: Variable, expression: string): Promise<EvaluatedExpression | undefined> {
	const expr = new Expression(expression);
	const str = expr.toString(variable);
	const e = await dbg.evaluate(str);
    return e !== undefined && e.type !== undefined ? new EvaluatedExpression(expr, str, e) : undefined;
}

// Various Containers

export class Container {
    element(variable: Variable): string | undefined {
        return undefined;
    }
    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {}
}

export class RandomAccessContainer extends Container {}

export class ContiguousContainer extends RandomAccessContainer {}

export class Array extends RandomAccessContainer
{
    constructor(private _start: Expression, private _size: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        return '(' + this._start.toString(variable) + ')[0]';
    }

    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {
        const sizeStr = this._size.toString(variable);
        // TODO: Check if it's possible to parse size at this point
        const sizeExpr = await dbg.evaluate(sizeStr);
        if (sizeExpr === undefined || sizeExpr.type === undefined)
            return;
        const size = parseInt(sizeExpr.result);
        if (! (size > 0)) // also handle NaN
            return;
        // NOTE: This loop could be done asynchroniously with await Promise.all()
        //   but an array can potentially store great number of objects so there
        //   would be great number of promises. And it will not be possible to
        //   end fast in case of error because the program would wait for all.
        for (let i = 0; i < size; ++i) {
            const elStr = '(' + this._start.toString(variable) + ')[' + i.toString() + ']';
            yield elStr;
        }
    }
}

export class DArray extends RandomAccessContainer {
    constructor(private _start: Expression, private _finish: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        return '(' + this._start.toString(variable) + ')[0]';
    }

    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {
        const sizeStr = '(' + this._finish.toString(variable) + ')-(' + this._start.toString(variable) + ')';
        const sizeExpr = await dbg.evaluate(sizeStr);
        if (sizeExpr === undefined || sizeExpr.type === undefined)
            return undefined;
        const size = parseInt(sizeExpr.result);
        if (! (size > 0)) // also handle NaN
            return undefined;
        for (let i = 0; i < size; ++i) {
            const elStr = '(' + this._start.toString(variable) + ')[' + i.toString() + ']';
            yield elStr;
        }
    }
}

// Value

export class Value {
    constructor(private _name: Expression) {
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<number | undefined> {
        const valStr = this._name.toString(variable);
        const valEval = await dbg.evaluate(valStr);
        if (valEval === undefined || valEval.type === undefined)
            return undefined;
        return parseFloat(valEval.result);
    }
}

// Base Loader

export class Loader {
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        return undefined;
    }
}

// Containers of drawables

export class ContainerLoader extends Loader {}

export class Numbers extends ContainerLoader {
    constructor(private _container: Container) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let ys: number[] = [];
        for await (let elStr of this._container.elements(dbg, variable)) {
            const elEval = await dbg.evaluate(elStr);
            if (elEval === undefined || elEval.type === undefined)
                return undefined;
            const el = parseFloat(elEval.result);
            ys.push(el);
        }
        return new draw.Plot(undefined, ys);
    }
}

export class Values extends ContainerLoader {
    constructor(private _container: Container, private _value: Value) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let ys: number[] = [];
        const elStr = this._container.element(variable);
        if (elStr === undefined)
            return undefined;
        const elEval = await dbg.evaluate(elStr);
        if (elEval === undefined || elEval.type === undefined)
            return undefined;
        let v = new Variable(elStr, elEval.type);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const n = await this._value.load(dbg, v);
            if (n !== undefined)
                ys.push(n);
        }
        return new draw.Plot(undefined, ys);
    }
}

export class Points extends ContainerLoader {
    constructor(private _container: Container, private _point: Point) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let xs: number[] = [];
        let ys: number[] = [];
        const elStr = this._container.element(variable);
        if (elStr === undefined)
            return undefined;
        const elEval = await dbg.evaluate(elStr);
        if (elEval === undefined || elEval.type === undefined)
            return undefined;
        let v = new Variable(elStr, elEval.type);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const point = await this._point.load(dbg, v);
            if (point === undefined)
                return undefined;
            const p = point as draw.Point;
            xs.push(p.x)
            ys.push(p.y);
        }
        return new draw.Plot(xs, ys);
    }
}

export class Geometries extends ContainerLoader {
    constructor(private _container: Container, private _geometry: Geometry) {
        super();
    }
    // TODO
}

// Geometric primitives

export class Geometry extends Loader {

}

export class Point extends Geometry {
    constructor(x: Expression, y: Expression) {
        super();
        this._x = x;
        this._y = y;
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const xStr = this._x.toString(variable);
        const xe = await dbg.evaluate(xStr);
        if (xe === undefined || xe.type === undefined)
            return undefined
        const yStr = this._y.toString(variable);
        const ye = await dbg.evaluate(yStr);
        if (ye === undefined || ye.type === undefined)
            return undefined
        const x = parseFloat(xe.result);
        const y = parseFloat(ye.result);
        return new draw.Point(x, y);
    }

    private _x: Expression;
    private _y: Expression;
}

export class Linestring extends Geometry {
    constructor(private _containerExpr: EvaluatedExpression, private _points: Points) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        return this._points.load(dbg, contVar);
    }
}

export class Ring extends Geometry {
    constructor(private _containerExpr: EvaluatedExpression, private _points: Points) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        const plot = await this._points.load(dbg, contVar);
        if (plot instanceof draw.Plot && plot.xs)
            return new draw.Ring(plot.xs, plot.ys);
        else
            return undefined;
    }
}

// Return Container or Loader for Variable based on JSON definitions
export async function getLoader(dbg: debug.Debugger, variable: Variable): Promise<Container | Value | Loader | undefined> {
    const language: debug.Language | undefined = dbg.language();
    if (language === debug.Language.Cpp) {
        for (let entry of cpp) {
            if (variable.type.match('^' + entry.type + '$')) {
                if (entry.kind === 'container') {
                    const container: Container | undefined = await getContainer(dbg, variable, entry);
                    // TODO: Return raw container if it is desired.
                    //       Additional parameter is needed for this.
                    if (container) {
                        const loader: ContainerLoader | undefined = await getContainerLoader(dbg, variable, container);
                        if (loader)
                            return loader;
                    }
                }
                else if (entry.kind === 'value') {
                    if (entry.name) {
                        const name = await evaluateExpression(dbg, variable, entry.name);
                        if (name) {
                            return new Value(name.expression);
                        }
                    }
                }
                else if (entry.kind === 'point') {
                    if (entry.coordinates && entry.coordinates.x && entry.coordinates.y) {
                        const x = await evaluateExpression(dbg, variable, entry.coordinates.x);
                        const y = await evaluateExpression(dbg, variable, entry.coordinates.y);
                        if (x && y) {
                            return new Point(x.expression, y.expression);
                        }
                    }
                }
                else if (entry.kind === 'linestring') {
                    if (entry.points) {
                        if (entry.points.container) {
                            if (entry.points.container.name) {
                                const contExpr = await evaluateExpression(dbg, variable, entry.points.container.name);
                                if (contExpr) {
                                    const contVar = contExpr.variable;
                                    // TODO: only search for Container of Points 
                                    const pointsLoad = await getLoader(dbg, contVar);
                                    if (pointsLoad instanceof Points) {
                                        return new Linestring(contExpr, pointsLoad);
                                    }
                                }
                            }
                        }
                    }
                }
                else if (entry.kind === 'ring') {
                    if (entry.points) {
                        if (entry.points.container) {
                            if (entry.points.container.name) {
                                const contExpr = await evaluateExpression(dbg, variable, entry.points.container.name);
                                if (contExpr) {
                                    const contVar = contExpr.variable;
                                    // TODO: only search for Container of Points 
                                    const pointsLoad = await getLoader(dbg, contVar);
                                    if (pointsLoad instanceof Points) {
                                        return new Ring(contExpr, pointsLoad);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return undefined;
}

// Return Container for Variable based on JSON definition
async function getContainer(dbg: debug.Debugger, variable: Variable, entry: any): Promise<Container | undefined> {
    if (entry.array && entry.array.start && entry.array.size) {
        const start = await evaluateExpression(dbg, variable, entry.array.start);
        const size = await evaluateExpression(dbg, variable, entry.array.size);
        if (start && size) {
            return new Array(start.expression, size.expression);
        }
    } else if (entry.darray && entry.darray.start && entry.darray.finish) {
        const start = await evaluateExpression(dbg, variable, entry.darray.start);
        const finish = await evaluateExpression(dbg, variable, entry.darray.finish);
        if (start && finish) {
            return new DArray(start.expression, finish.expression);
        }
    }
    return undefined;
}

// Return ContainerLoader for Variable
async function getContainerLoader(dbg: debug.Debugger, variable: Variable, container: Container): Promise<ContainerLoader | undefined> {
    const elemStr = container.element(variable);
    if (elemStr) {
        const e = await dbg.evaluate(elemStr);
        if (e && e.type) {
            const elemVar = new Variable(elemStr, e.type);
            // TODO: only search for non-containers to avoid recursion
            const elemLoad = await getLoader(dbg, elemVar);
            if (elemLoad instanceof Point) {
                return new Points(container, elemLoad);
            } else if (elemLoad instanceof Geometry) {
                return new Geometries(container, elemLoad);
            } else if (elemLoad instanceof Value) {
                return new Values(container, elemLoad);
            } else {
                return new Numbers(container);
            }
        }
    }
}