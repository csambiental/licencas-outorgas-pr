"""Processos minerários (ANM/SIGMINE) e setores de risco geológico (SGB) do Paraná, para o mapa de licenças e outorgas.
Uso: python3 tools/mineracao_risco.py saida
Gera saida/min.geojson e saida/rsk.geojson (entrada do tippecanoe) e saida/mineracao_risco.json (totais do estado).
Titular pessoa física não é publicado (só 'Pessoa física')."""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import ssl_aia
SAIDA = sys.argv[1]
UA = {'User-Agent': 'csambiental-licencas-outorgas'}

def http(url, tent=5):
    for t in range(tent):
        try: return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=240, context=ssl_aia.contexto(url) if 'anm.gov.br' in url else None).read())
        except Exception as e: print('  tentativa', t + 1, str(e)[:160], flush=True); time.sleep(10 * (t + 1))
    raise RuntimeError('falhou ' + url[:160])

def baixar(base, onde, pagina=1000):
    feats, off = [], 0
    while True:
        q = {'where': onde, 'outFields': '*', 'returnGeometry': 'true', 'outSR': '4326', 'resultOffset': off, 'resultRecordCount': pagina, 'f': 'geojson', 'geometryPrecision': 6}
        r = http(base + '/query?' + urllib.parse.urlencode(q)); fs = r.get('features', []); feats += fs
        print(' ', base.split('/')[-3], len(feats), flush=True)
        if len(fs) < pagina: break
        off += len(fs)
    return [f for f in feats if f.get('geometry')]

PJ = re.compile(r'\b(LTDA|S/?A|S\.A|EIRELI|ME|EPP|CIA|COMPANHIA|MUNIC[IÍ]PIO|PREFEITURA|ASSOCIA[CÇ][AÃ]O|COOPERATIVA|MINERA[CÇ][AÃ]O|MINERADORA|PEDREIRA|CER[AÂ]MICA|AREAL|IND[UÚ]STRIA|COM[EÉ]RCIO|CONSTRUTORA|ENGENHARIA|EMPREENDIMENTOS?|INCORPORADORA|AGROPECU[AÁ]RIA|TRANSPORTES?|EXTRA[CÇ][AÃ]O|SANEAMENTO|DEPARTAMENTO|ESTADO)\b', re.I)
grupo = lambda f: 'Pesquisa mineral' if 'PESQUISA' in f else 'Disponibilidade' if 'DISPONIBILIDADE' in f else 'Lavra / extração'
cap = lambda t: (t or '').strip().capitalize()

mins = []
for f in baixar('https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/FeatureServer/0', "UF='PR'"):
    a = f['properties']; tit = (a.get('NOME') or '').strip(); fase = (a.get('FASE') or '').upper()
    p = {'pr': a.get('DSProcesso') or a.get('PROCESSO') or '', 'g': grupo(fase), 'f': cap(fase), 's': cap(a.get('SUBS')), 'u': a.get('USO') or '',
         'a': f"{float(a.get('AREA_HA') or 0):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), 'an': str(a.get('ANO') or ''),
         't': tit if PJ.search(tit) else 'Pessoa física', 'e': (a.get('ULT_EVENTO') or '').strip()}
    mins.append({'type': 'Feature', 'geometry': f['geometry'], 'properties': {k: v for k, v in p.items() if v}})

rsks = []
for f in baixar('https://geoportal.sgb.gov.br/server/rest/services/gestaoterritorial/risco/FeatureServer/0', "uf='PR'"):
    a = f['properties']
    tip = '; '.join(dict.fromkeys(t.strip() for t in [a.get(f'tipolo_e{i}') or a.get(f'tipolo_g{i}') or '' for i in range(1, 6)] if t and t.strip()))
    d = str(a.get('data_setor') or ''); m = re.match(r'(\d{4})-(\d{2})-(\d{2})', d)
    if m: d = f'{m.group(3)}/{m.group(2)}/{m.group(1)}'
    elif re.match(r'^\d{12,}$', d): d = time.strftime('%d/%m/%Y', time.gmtime(int(d) / 1000))
    n = lambda k: f"{int(a[k]):,}".replace(',', '.') if isinstance(a.get(k), (int, float)) and a.get(k) else ''
    p = {'n': (a.get('num_setor') or '').strip(), 'mu': re.sub(r'\s*\(PR\)\s*$', '', a.get('municipio') or ''), 'gr': (a.get('grau_risco') or '').strip(), 'pr': tip,
         'lo': (a.get('local') or '').strip(), 'dt': d, 'ed': n('num_edif'), 'pe': n('num_pess'), 'iv': re.sub(r'\s+', ' ', a.get('sug_interv') or '').strip()[:250]}
    rsks.append({'type': 'Feature', 'geometry': f['geometry'], 'properties': {k: v for k, v in p.items() if v}})

# patrimônio arqueológico (IPHAN/CNSA), terras indígenas (Funai) e territórios quilombolas (Incra) – serviço da ANM
SC = 'https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/sociedade_cultura/MapServer'
def baixar_env(base, xmin=-54.7, ymin=-26.8, xmax=-47.9, ymax=-22.4, pagina=1000):
    env = json.dumps({'xmin': xmin, 'ymin': ymin, 'xmax': xmax, 'ymax': ymax, 'spatialReference': {'wkid': 4326}})
    feats, off = [], 0
    while True:
        q = {'geometry': env, 'geometryType': 'esriGeometryEnvelope', 'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'returnGeometry': 'true',
             'outSR': '4326', 'resultOffset': off, 'resultRecordCount': pagina, 'f': 'geojson', 'geometryPrecision': 6}
        r = http(base + '/query?' + urllib.parse.urlencode(q)); fs = r.get('features', []); feats += fs
        if len(fs) < pagina: break
        off += len(fs)
    return [f for f in feats if f.get('geometry')]
sits = [{'type': 'Feature', 'geometry': f['geometry'], 'properties': {'n': re.sub(r'\s+', ' ', f['properties'].get('NMSitioArqueologico') or '').strip(), 'c': f['properties'].get('CDSitioArqueologico') or ''}}
        for f in baixar_env(SC + '/1') if str(f['properties'].get('CDSitioArqueologico') or '').startswith('PR')]
coms = []
for f in baixar_env(SC + '/2'):
    a = f['properties']; coms.append({'type': 'Feature', 'geometry': f['geometry'], 'properties': {k: v for k, v in {'g': 'Terra indígena', 'n': a.get('NMTerraIndigena') or '', 'si': a.get('DSSituacao') or '', 'a': f"{float(a.get('QTAreaHA') or 0):,.0f}".replace(',', '.')}.items() if v}})
for f in baixar_env(SC + '/3'):
    a = f['properties']; coms.append({'type': 'Feature', 'geometry': f['geometry'], 'properties': {k: v for k, v in {'g': 'Território quilombola', 'n': a.get('NMTerritorioQuilombola') or '', 'pr': a.get('DSProcesso') or '', 'a': f"{float(a.get('QTAreaHA') or 0):,.0f}".replace(',', '.')}.items() if v}})
json.dump({'type': 'FeatureCollection', 'features': sits}, open(f'{SAIDA}/sit.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'type': 'FeatureCollection', 'features': coms}, open(f'{SAIDA}/com.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))

json.dump({'type': 'FeatureCollection', 'features': mins}, open(f'{SAIDA}/min.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'type': 'FeatureCollection', 'features': rsks}, open(f'{SAIDA}/rsk.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
# arquivo por município para o Raio X da área (geometria simplificada)
try:
    from shapely.geometry import shape, mapping
    from shapely.strtree import STRtree
    mg = json.load(open(f'{SAIDA}/municipios.geojson'))['features']
    mgeo = [shape(f['geometry']).buffer(0) for f in mg]; marv = STRtree(mgeo)
    def aneis(g):
        g = g.simplify(0.0003, preserve_topology=True)
        polys = [g] if g.geom_type == 'Polygon' else list(getattr(g, 'geoms', []))
        return [[[round(x, 5), round(y, 5)] for x, y in p.exterior.coords] for p in polys if p.geom_type == 'Polygon'][:20]
    por = {}
    for chave, L in (('min', mins), ('rsk', rsks), ('sit', sits), ('com', coms)):
        for f in L:
            g = shape(f['geometry']); g = g if g.geom_type in ('Point', 'MultiPoint') else g.buffer(0)
            item = dict(f['properties'])
            if g.geom_type == 'Point': item['xy'] = [round(g.x, 5), round(g.y, 5)]
            else: item['an'] = aneis(g); c = g.representative_point(); item['xy'] = [round(c.x, 5), round(c.y, 5)]
            for i in marv.query(g):
                if mgeo[i].intersects(g): por.setdefault(mg[i]['properties']['cod'], {}).setdefault(chave, []).append(item)
    os.makedirs(f'{SAIDA}/mr', exist_ok=True)
    for cod, d in por.items(): json.dump(d, open(f'{SAIDA}/mr/{cod}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('arquivos por município', len(por))
except Exception as e:
    print('arquivo por município falhou', e)

from collections import Counter
res = {'processos_minerarios': len(mins), 'por_fase': Counter(f['properties']['g'] for f in mins),
       'setores_risco': len(rsks), 'municipios_com_setorizacao': len({f['properties'].get('mu') for f in rsks}), 'sitios_arqueologicos': len(sits), 'terras_indigenas_quilombolas': len(coms), 'atualizado': time.strftime('%d/%m/%Y')}
json.dump(res, open(f'{SAIDA}/mineracao_risco.json', 'w'), ensure_ascii=False, indent=1)
print(res)
