# Graphical Debugging
## extension for Visual Studio Code

This extension allows to display graphical representation of variables during debugging.

![Graphical Debugging](resources/extension.png)

##### Instructions

1. Place a breakpoint
2. Start debugging
3. After clicking + in Graphical Watch write the name of a variable

##### Supported types

* Containers of values, points and other geometries
  * C-style array
  * STL: `array`, `vector`
  * Boost.Array: `array`
* 2D cartesian geometries
  * Boost.Geometry: `point`, `linestring`
  * STL: `pair`
