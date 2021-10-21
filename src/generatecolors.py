import colorsys
import json
import os

def hsvToRgb(h, s, v):
    (r, g, b) = colorsys.hsv_to_rgb(h / 360, s / 100, v / 100)
    return '#'+("%0.2X" % round(r * 255))+("%0.2X" % round(g * 255))+("%0.2X" % round(b * 255))

# svg

def generateFile(version, id, h, s, v):
    c = hsvToRgb(h, s, v)
    p = os.path.join('resources', version, 'color' + str(id) + '.svg')
    f = open(p, "w", newline = '\n')
    f.write('<svg width="16" height="16" fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">\n')
    f.write('<path d="m14 14h-13v-13h13z" fill="' + c + '"/>\n')
    f.write('</svg>\n')
    f.close()

def generateFiles(id, h):
    generateFile('dark', id, h, 80, 100)
    generateFile('light', id, h, 100, 80)

generateFiles(0, 0)
generateFiles(1, 120)
generateFiles(2, 240)
generateFiles(3, 60)
generateFiles(4, 180)
generateFiles(5, 300)
generateFiles(6, 30)
generateFiles(7, 150)
generateFiles(8, 270)
generateFiles(9, 90)
generateFiles(10, 210)
generateFiles(11, 330)

generateFile('dark', '', 0, 0, 80)
generateFile('light', '', 0, 0, 20)

# json

content = {
    "dark": {
        "color": hsvToRgb(0, 0, 80),
        "colors": [
            hsvToRgb(0, 80, 100),
            hsvToRgb(120, 80, 100),
            hsvToRgb(240, 80, 100),
            hsvToRgb(60, 80, 100),
            hsvToRgb(180, 80, 100),
            hsvToRgb(300, 80, 100),
            hsvToRgb(30, 80, 100),
            hsvToRgb(150, 80, 100),
            hsvToRgb(270, 80, 100),
            hsvToRgb(90, 80, 100),
            hsvToRgb(210, 80, 100),
            hsvToRgb(330, 80, 100)
        ]
    },
    "light": {
        "color": hsvToRgb(0, 0, 20),
        "colors": [
            hsvToRgb(0, 100, 80),
            hsvToRgb(120, 100, 80),
            hsvToRgb(240, 100, 80),
            hsvToRgb(60, 100, 80),
            hsvToRgb(180, 100, 80),
            hsvToRgb(300, 100, 80),
            hsvToRgb(30, 100, 80),
            hsvToRgb(150, 100, 80),
            hsvToRgb(270, 100, 80),
            hsvToRgb(90, 100, 80),
            hsvToRgb(210, 100, 80),
            hsvToRgb(330, 100, 80)
        ]
    }
}

f = open(os.path.join("src", "colors.json"), "w", newline = '\n')
f.write(json.dumps(content))
f.close()