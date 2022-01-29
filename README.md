# Graphical Debugging
## extension for Visual Studio Code

This extension allows to display graphical representation of variables during debugging.

![Graphical Debugging](resources/extension.png)

#### Instructions

1. Place a breakpoint
2. Start debugging
3. After clicking + in Graphical Watch write the name of a variable

#### Supported types

##### C/C++ (cppvsdbg, cppdbg)

* Containers of values, points and other geometries
  * C-style array
  * STL: `array`, `deque`, `list`, `vector`
  * Boost.Array: `array`
  * Boost.Container: `static_vector`, `vector`
  * Boost.Geometry: `varray`
* 1D values
  * STL: `duration`
  * Boost.Chrono: `duration`   
  * Boost.Units: `quantity`   
* 2D values/geometries
  * STL: `complex`, `pair`
  * Boost.Geometry: `linestring`, `multi_linestring`, `multi_point`, `multi_polygon`, `point`, `point_xy`, `point_xyz`, `polygon`, `ring`, `segment`
  * Boost.Polygon: `point_data`, `polygon_data`, `polygon_with_holes_data`, `segment_data`

##### Javascript (node, chrome, msedge, pwa-node, pwa-chrome, pwa-msedge)

* Containers of values, points and other geometries
  * `Array`

##### Python (python)

* Containers of values, points and other geometries
  * `deque`, `list`
  * llist: `dllist`, `sllist`
* 2D geometries
  * `tuple`
  * Shapely: `GeometryCollection`, `LinearRing`, `LineString`, `MultiLineString`, `MultiPoint`, `MultiPolygon`, `Point`, `Polygon`
  * SymPy: `Point2D`, `Polygon`, `Segment2D`

##### User-defined types

* see `*.json` files in `resources` directory
* the directory containing user files can be defined in settings, by default it is the workspace directory of currently debugged program

#### Known issues

* The extension doesn't work for C++ variables defined with `typedef` with GDB, including classes defining member types, e.g. Boost.Geometry `polygon`. This issue [is known](https://github.com/microsoft/vscode-cpptools/issues/3038) and also affects the use of natvis files. If [this proposal](https://github.com/microsoft/MIEngine/issues/1236) was implemented it could potentially allow to work around this issue.
* Geographic polygons with holes are visualized incorrectly if an interior ring is in the viewport and the whole exterior ring is outside. This is a side effect of a workaround of the lack of support of polygons with holes in Plotly.