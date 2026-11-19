"""Processos minerários (ANM/SIGMINE) e setores de risco geológico (SGB) do Paraná, para o mapa de licenças e outorgas.
Uso: python3 tools/mineracao_risco.py saida
Gera saida/min.geojson e saida/rsk.geojson (entrada do tippecanoe) e saida/mineracao_risco.json (totais do estado).
Titular pessoa física não é publicado (só 'Pessoa física')."""
import json, re, sys, time, urllib.parse, urllib.request
SAIDA = sys.argv[1]
UA = {'User-Agent': 'csambiental-licencas-outorgas'}

def http(url, tent=5):
    for t in range(tent):
        try: return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=240).read())
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

json.dump({'type': 'FeatureCollection', 'features': mins}, open(f'{SAIDA}/min.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'type': 'FeatureCollection', 'features': rsks}, open(f'{SAIDA}/rsk.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
res = {'processos_minerarios': len(mins), 'por_fase': Counter(f['properties']['g'] for f in mins),
       'setores_risco': len(rsks), 'municipios_com_setorizacao': len({f['properties'].get('mu') for f in rsks}), 'atualizado': time.strftime('%d/%m/%Y')}
json.dump(res, open(f'{SAIDA}/mineracao_risco.json', 'w'), ensure_ascii=False, indent=1)
print(res)
