import json, sys
from playwright.sync_api import sync_playwright
GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
with sync_playwright() as p:
    b = p.chromium.launch(args=GL); pg = b.new_page(viewport={'width': 1400, 'height': 900})
    erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function("() => typeof map !== 'undefined' && map.getLayer && map.getLayer('min-fill')", timeout=90000)
    res = {}
    for nome, c, z in [('curitiba_risco', [-49.32, -25.27], 11.5), ('norte_mineracao', [-50.08, -23.15], 11), ('grandes_rios_sitios', [-51.5, -24.15], 10.5)]:
        pg.evaluate("([c,z]) => map.jumpTo({center: c, zoom: z})", [c, z])
        pg.wait_for_timeout(1500); pg.wait_for_function("() => map.loaded() && map.areTilesLoaded()", timeout=60000); pg.wait_for_timeout(1500)
        res[nome] = pg.evaluate("() => Object.fromEntries(['min-fill','rsk-fill','sit-pt','com-fill','lic-vig'].map(l => [l, map.queryRenderedFeatures({layers:[l]}).length]))")
        pg.screenshot(path=f'saida_teste/{nome}.png')
    # popup de um processo minerário
    f = pg.evaluate("() => { const x = map.queryRenderedFeatures({layers:['sit-pt','min-fill']})[0]; return x ? x.properties : null; }")
    res['exemplo'] = f; res['erros'] = erros
    json.dump(res, open('saida_teste/resultado.json', 'w'), ensure_ascii=False, indent=1); print(res)
    b.close()
