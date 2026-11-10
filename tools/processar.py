"""Licenças ambientais (IAT – SGA/SIA) e outorgas de água (IAT – SIGARH) de todo o Paraná, por município.

Fontes públicas:
- GeoPR/IAT  – camada "Licenciamento Ambiental - Paraná" (licenças do SGA e SIA com coordenadas);
- SGA/IAT    – consulta pública de licenciamento (atividade específica e licenças sem coordenada);
- GeoPR/IAT  – camada pública de outorgas do SIGARH;
- IBGE (malha municipal via geodata-br).
O CPF/CNPJ NUNCA é baixado nem gravado. Titulares aparecem como constam nas consultas públicas do SGA e do SIGARH.

Saída (pasta site/data, publicada pelo GitHub Pages):
  municipios.geojson        limites simplificados + estatísticas por município
  resumo.json               totais do estado
  m/<cod_ibge>.json         listas de licenças e outorgas do município (painel e planilha)
  pontos_lic.geojson / pontos_out.geojson  (entrada do tippecanoe, apagados depois)
"""
import json, os, re, ssl, sys, math, time, datetime, unicodedata, collections, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

SAIDA = sys.argv[1] if len(sys.argv) > 1 else 'site/data'
os.makedirs(f'{SAIDA}/m', exist_ok=True)
CTX = ssl.create_default_context(); CTX.set_ciphers('DEFAULT@SECLEVEL=0'); CTX.options |= 0x4
HOJE = datetime.date.today()
LIC = 'https://geopr.iat.pr.gov.br/server/rest/services/00_PUBLICACOES/licenciamento_ambiental_pr/FeatureServer/0'
OUT = 'https://geopr.iat.pr.gov.br/server/rest/services/00_PUBLICACOES/outorgas_sigarh/FeatureServer/0'
SGA = 'https://www.sga.pr.gov.br/sga-iap/consultarProcessoLicenciamento.do'
MUN = 'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-41-mun.json'

GRUPO = {'LO': 'Licença de Operação', 'RLO': 'Licença de Operação', 'LOR': 'Licença de Operação', 'LO-A': 'Licença de Operação', 'LO-C': 'Licença de Operação',
         'LAS': 'Licença Simplificada', 'RLAS': 'Licença Simplificada', 'LASR': 'Licença Simplificada',
         'LAC': 'Licença por Adesão e Compromisso', 'RLAC': 'Licença por Adesão e Compromisso',
         'LP': 'Licença Prévia / de Instalação', 'LP-A': 'Licença Prévia / de Instalação', 'LI': 'Licença Prévia / de Instalação', 'LI-A': 'Licença Prévia / de Instalação',
         'LI-C': 'Licença Prévia / de Instalação', 'LPI': 'Licença Prévia / de Instalação', 'RLI': 'Licença Prévia / de Instalação', 'RLI-A': 'Licença Prévia / de Instalação', 'CP': 'Licença Prévia / de Instalação',
         'DLAE': 'Dispensa / inexigibilidade', 'DLAM': 'Dispensa / inexigibilidade', 'DILA': 'Dispensa / inexigibilidade',
         'AA': 'Autorização Ambiental', 'AAP': 'Autorização Ambiental', 'AF': 'Autorização Florestal'}
RX_AGUA = re.compile(r'avicult|suinocult|bovinocult|bubalinocult|ovinocult|caprinocult|equinocult|cunicult|piscicult|aquicult|carcinicult|ranicult|'
                     r'cria[çc][ãa]o de (animais|aves|su[íi]nos|bovinos|frangos|peixes)|confinamento|leite|latic|abate|frigor|alimentos|bebida|f[ée]cula|amido|'
                     r'aguardente|cacha[çc]a|destilaria|usina|curtume|irriga|viveiro|hortali|cogumel|lavagem|lavador|beneficiamento', re.I)
RX_CAPTA = re.compile(r'capta|subterr|po[çc]o|insignific|uso independente', re.I)


def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)


def http(url, dados=None, txt=False, tent=5):
    for t in range(tent):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=dados, headers={'User-Agent': 'Mozilla/5.0 (csambiental)'}), timeout=180, context=CTX).read()
            return r.decode('utf-8', 'replace') if txt else json.loads(r)
        except Exception as e:
            if t == tent - 1: raise
            time.sleep(3 * (t + 1))


def sem_acento(t): return unicodedata.normalize('NFD', t or '').encode('ascii', 'ignore').decode().upper()
def chave_nome(t): return re.sub(r'[^A-Z0-9]', '', re.sub(r'\b(LTDA|ME|EPP|EIRELI|S/?A|LIMITADA)\b', '', sem_acento(t)))
def data(ms):
    if not isinstance(ms, (int, float)): return None
    try: return (datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc) - datetime.timedelta(hours=3)).date()
    except Exception: return None
def br(d): return d.strftime('%d/%m/%Y') if d else ''
def proto_fmt(n): s = str(n).rjust(9, '0'); return f'{s[:2]}.{s[2:5]}.{s[5:8]}-{s[8:]}'
def doc_fmt(n):
    try: return f'{int(n):,}'.replace(',', '.')
    except Exception: return str(n or '')


def baixar(url, campos, onde='1=1'):
    """Lê a camada inteira paginando pelo objectid (rápido e estável)."""
    out, ultimo = [], -1
    while True:
        q = {'where': f'({onde}) AND objectid > {ultimo}', 'outFields': ','.join(campos + ['objectid']), 'returnGeometry': 'false', 'f': 'json',
             'orderByFields': 'objectid', 'resultRecordCount': 2000}
        d = http(url + '/query', urllib.parse.urlencode(q).encode())
        if 'error' in d: raise RuntimeError(d['error'])
        lote = [x['attributes'] for x in d.get('features', [])]
        if not lote: break
        out += lote; ultimo = max(x['objectid'] for x in lote)
        if len(out) % 20000 < 2000: log('  ', url.split('/')[-3], len(out))
    return out


def _js_para_json(t):
    i = t.index('['); t = t[i:t.rindex(']') + 1]
    return json.loads(re.sub(r'([{,])\s*([A-Za-z_]\w*)\s*:', r'\1"\2":', t))


def sga_municipio(idc):
    out, pag = [], 1
    while True:
        t = http(f'{SGA}?action=consultarProcessoLicenciamento&estadoMunicipioCombo=PR&municipioCombo={idc}&page={pag}&start={(pag - 1) * 1000}&limit=1000', txt=True, tent=4)
        regs = _js_para_json(t)
        for r in regs: r.pop('cpfCnpj', None)
        out += regs
        if len(regs) < 1000: return out
        pag += 1


def sga_estado(limite_min=45):
    try:
        txt = http(f'{SGA}?action=listaMunicipioPorUFAjax&estadoMunicipioCombo=PR&page=1&start=0&limit=1000', txt=True)
        ids = [int(a) for a, b in re.findall(r'"?idMunicipioCorreios"?\s*:\s*(\d+)\s*,\s*"?nomeMunicipio"?\s*:\s*"([^"]+)"', txt)]
    except Exception as e:
        log('SGA indisponível:', e); return []
    log('SGA: municípios', len(ids))
    fim = time.time() + limite_min * 60; regs = []
    def um(i):
        if time.time() > fim: return []
        try: return sga_municipio(i)
        except Exception as e: log('  SGA falhou', i, str(e)[:80]); return []
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(um, ids): regs += r
    log('SGA: registros', len(regs))
    return regs


class Grade:
    """Índice espacial simples (células de ~1 km) para buscas por raio."""
    def __init__(self, pts, cel=0.01):
        self.cel = cel; self.g = collections.defaultdict(list)
        for i, (x, y) in enumerate(pts): self.g[(int(x / cel), int(y / cel))].append(i)
        self.pts = pts
    def perto(self, x, y, raio_m):
        r = int(raio_m / 1000 / (self.cel * 100)) + 1; cx, cy = int(x / self.cel), int(y / self.cel)
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                for i in self.g.get((cx + dx, cy + dy), ()):
                    px, py = self.pts[i]; d = math.hypot((px - x) * 101700, (py - y) * 110600)
                    if d <= raio_m: yield d, i


def main():
    # ---------------- municípios
    mun = http(MUN)
    MUNS = {}
    for f in mun['features']:
        cod = str(f['properties'].get('id') or f['properties'].get('cod') or f['properties'].get('CD_GEOCMU'))[:7]
        MUNS[cod] = {'nome': f['properties'].get('name') or f['properties'].get('NM_MUNICIP'), 'geom': shape(f['geometry']).buffer(0)}
    log('municípios', len(MUNS))

    # ---------------- outorgas
    camp_o = ['coord_latitude', 'coord_longitude', 'nm_requerente', 'nm_empreendimento', 'cod_municipio_emp', 'cod_municipio', 'nm_municipio', 'nm_tipo_interferencia',
              'nr_portaria', 'st_portaria', 'nm_tipo_documento', 'nm_comite', 'nm_bacia_hidrografica', 'dt_publicacao', 'dt_vencimento', 'nm_tipo_usuario',
              'desc_finalidades', 'nm_corpo_hidrico_popular', 'nm_tipo_corpo_hidrico', 'nm_aquifero', 'nm_tipo_solicitacao'] + [f'vlr_vazao_capt_lanc_{m}' for m in
              ('jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez')]
    try: bruto_o = baixar(OUT, camp_o, "st_portaria IN ('DEFERIDA','EM RENOVAÇÃO','EM REGULARIZAÇÃO','IRREGULAR')")
    except Exception:
        meta = http(OUT + '?f=json'); nomes = {f['name'] for f in meta['fields']}
        bruto_o = baixar(OUT, [c for c in camp_o if c in nomes], "st_portaria IN ('DEFERIDA','EM RENOVAÇÃO','EM REGULARIZAÇÃO','IRREGULAR')")
    log('outorgas', len(bruto_o))
    def grupo_o(t):
        t = (t or '').lower()
        return 'Poço (água subterrânea)' if 'subterr' in t else 'Captação superficial' if 'captação superficial' in t else 'Lançamento de efluentes' if 'lançamento' in t \
            else 'Barragem / soleira' if 'barragem' in t else 'Obras e intervenções em rios'
    outs = []
    for p in bruto_o:
        if (p.get('nm_tipo_solicitacao') or '').startswith('Desativa'): continue
        x, y = p.get('coord_longitude'), p.get('coord_latitude')
        if not (isinstance(x, (int, float)) and isinstance(y, (int, float)) and -55 < x < -47.9 and -27 < y < -22.4): x = y = None
        venc = data(p.get('dt_vencimento')); st = (p.get('st_portaria') or '').capitalize()
        if st != 'Irregular' and venc and venc < HOJE: situ = 'Vencida'
        elif st == 'Irregular': situ = 'Irregular'
        elif venc and (venc - HOJE).days <= 183: situ = 'Vence em até 6 meses'
        else: situ = 'Válida'
        vz = [p.get(k) for k in p if k.startswith('vlr_vazao_capt_lanc_') and isinstance(p.get(k), (int, float))]
        corpo = p.get('nm_corpo_hidrico_popular') or p.get('nm_tipo_corpo_hidrico') or (p.get('nm_aquifero') if 'subterr' in (p.get('nm_tipo_interferencia') or '').lower() else '')
        outs.append({'cod': str(p.get('cod_municipio_emp') or p.get('cod_municipio') or '')[:7], 'x': x, 'y': y,
                     'nome': (p.get('nm_requerente') or '').strip() or 'Titular não informado', 'emp': (p.get('nm_empreendimento') or '').strip(),
                     'tipo': grupo_o(p.get('nm_tipo_interferencia')), 'interf': p.get('nm_tipo_interferencia') or '', 'doc': p.get('nm_tipo_documento') or '',
                     'num': p.get('nr_portaria') or '', 'st': st, 'situ': situ, 'pub': br(data(p.get('dt_publicacao'))), 'venc': br(venc),
                     'fin': (p.get('desc_finalidades') or '').replace(',', ', '), 'setor': p.get('nm_tipo_usuario') or '', 'corpo': corpo or '',
                     'vazao': f'{max(vz):.2f}'.replace('.', ',') if vz else '', 'bacia': p.get('nm_bacia_hidrografica') or p.get('nm_comite') or ''})
    capt = [(o['x'], o['y']) for o in outs if o['x'] is not None and o['situ'] != 'Irregular' and RX_CAPTA.search(f"{o['interf']} {o['doc']}")]
    capt_nome = [chave_nome(o['nome']) for o in outs if o['x'] is not None and o['situ'] != 'Irregular' and RX_CAPTA.search(f"{o['interf']} {o['doc']}")]
    capt_num = [o['num'] for o in outs if o['x'] is not None and o['situ'] != 'Irregular' and RX_CAPTA.search(f"{o['interf']} {o['doc']}")]
    grade = Grade(capt)
    por_nome = {}
    for o in outs:
        if o['x'] is not None: por_nome.setdefault((o['cod'], chave_nome(o['nome'])), (o['x'], o['y']))

    # ---------------- licenças
    camp_l = ['num_protocolo', 'nome_razao_social', 'cod_ibge', 'nome_municipio', 'sigla_modalidade', 'desc_modalidade', 'desc_grupo_atividade',
              'desc_atividade', 'num_documento', 'dt_emissao', 'dt_validade', 'ind_sia', 'x', 'y']  # sem cpf_cnpj
    geo = baixar(LIC, camp_l)
    log('licenças GeoPR', len(geo))
    L = {}
    for r in geo:
        if not r.get('num_protocolo'): continue
        L[int(r['num_protocolo'])] = {'prot': int(r['num_protocolo']), 'cod': str(r.get('cod_ibge') or '')[:7], 'nome': (r.get('nome_razao_social') or '').strip(),
            'sig': (r.get('sigla_modalidade') or '').strip(), 'mod': r.get('desc_modalidade') or '', 'gat': r.get('desc_grupo_atividade') or '',
            'ativ': r.get('desc_atividade') or r.get('desc_grupo_atividade') or '', 'esp': '', 'doc': r.get('num_documento'),
            'em': data(r.get('dt_emissao')), 'va': data(r.get('dt_validade')), 'sia': str(r.get('ind_sia')).lower() == 'true', 'x': r.get('x'), 'y': r.get('y')}
    del geo
    novos = 0
    for r in sga_estado():
        try: p = int(r['numProtocolo'])
        except Exception: continue
        d = L.get(p)
        if not d:
            novos += 1
            d = L[p] = {'prot': p, 'cod': str(r.get('codIbge') or '')[:7], 'nome': (r.get('nomeRazaoSocial') or '').strip(), 'sig': r.get('siglaModalidade') or '', 'mod': '',
                        'gat': '', 'ativ': r.get('descAtividade') or '', 'esp': '', 'doc': r.get('numDocumento'), 'em': data(r.get('dtDecisao')),
                        'va': data(r.get('dtValidade')), 'sia': bool(r.get('indSia')), 'x': None, 'y': None}
        d['esp'] = r.get('descAtividadeEspecifica') or d['esp']
    log('licenças só no SGA', novos, 'total', len(L))
    # vencidas substituídas e pontos genéricos
    grupos = collections.defaultdict(list); tit = collections.defaultdict(set)
    for d in L.values():
        grupos[(d['cod'], chave_nome(d['nome']), sem_acento(d['ativ']))].append(d)
        if isinstance(d['x'], (int, float)) and isinstance(d['y'], (int, float)): tit[(round(d['x'], 4), round(d['y'], 4))].add(chave_nome(d['nome']))
    genericos = {k for k, v in tit.items() if len(v) >= 5}
    mais_nova = {k: max((o['em'] for o in v if o['em']), default=None) for k, v in grupos.items()}

    # ---------------- por município
    porm = collections.defaultdict(lambda: {'lic': [], 'out': []})
    pts_lic, pts_out = [], []
    for d in L.values():
        va, em = d['va'], d['em']
        mn = mais_nova[(d['cod'], chave_nome(d['nome']), sem_acento(d['ativ']))]
        if va and va < HOJE: situ = 'Substituída' if mn and em and mn > em else 'Vencida'
        else: situ = 'Vence em até 6 meses' if va and (va - HOJE).days <= 183 else 'Vigente'
        if situ == 'Substituída': continue          # histórico já renovado: fora do projeto
        x, y = d['x'], d['y']
        ok = isinstance(x, (int, float)) and isinstance(y, (int, float)) and -55 < x < -47.9 and -27 < y < -22.4 and (round(x, 4), round(y, 4)) not in genericos
        aprox = False
        if not ok and situ != 'Vencida' and (d['cod'], chave_nome(d['nome'])) in por_nome:
            x, y = por_nome[(d['cod'], chave_nome(d['nome']))]; ok = aprox = True
        agua = bool(RX_AGUA.search(f"{d['ativ']} {d['esp']}"))
        oc = ''
        if agua and ok and situ != 'Vencida':
            prox = sorted(grade.perto(x, y, 2000))
            mesmo = [(dist, i) for dist, i in prox if capt_nome[i] == chave_nome(d['nome'])]
            if mesmo: oc = f"Sim – nº {capt_num[mesmo[0][1]] or 's/ nº'}, do mesmo titular, a {mesmo[0][0]:.0f} m"
            elif prox and prox[0][0] <= 500: oc = f'Há outorga de captação de outro titular a {prox[0][0]:.0f} m – conferir'
            else: oc = 'Não localizada até 500 m – verificar a fonte de água e a outorga'
        reg = {'p': proto_fmt(d['prot']), 'n': d['nome'], 'a': d['ativ'], 'e': d['esp'], 's': d['sig'], 'g': GRUPO.get(d['sig'], d['mod'] or d['sig'] or 'Outras'),
               'd': doc_fmt(d['doc']), 'em': br(em), 'va': br(va), 'si': situ}
        if d['sia']: reg['sia'] = 1
        if oc: reg['oc'] = oc
        if aprox: reg['lo'] = 1
        if ok: reg['xy'] = [round(x, 5), round(y, 5)]
        porm[d['cod']]['lic'].append(reg)
        if ok:
            pts_lic.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': reg['xy']},
                            'properties': {k: v for k, v in reg.items() if k != 'xy'} | {'c': d['cod']}})
    for o in outs:
        reg = {k: v for k, v in o.items() if k not in ('x', 'y', 'cod') and v}
        if o['x'] is not None: reg['xy'] = [round(o['x'], 5), round(o['y'], 5)]
        porm[o['cod']]['out'].append(reg)
        if o['x'] is not None:
            pts_out.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': reg['xy']},
                            'properties': {k: v for k, v in reg.items() if k != 'xy'} | {'c': o['cod']}})
    log('pontos licenças', len(pts_lic), 'outorgas', len(pts_out))

    # ---------------- estatísticas e arquivos
    feats, tot = [], collections.Counter()
    IDX_N = collections.defaultdict(dict); IDX_W = collections.defaultdict(dict)
    PARADAS = {'LTDA', 'EIRELI', 'DOS', 'DAS', 'DE', 'DO', 'DA', 'EPP', 'CIA', 'FILIAL', 'MATRIZ', 'S/A', 'SA', 'LIMITADA', 'EM', 'PARA', 'COM', 'POR'}
    def idx_num(chave, val):
        chave = chave.lstrip('0')
        if len(chave) >= 4: IDX_N[chave[:3]].setdefault(chave, []).append(val)
    def idx_txt(texto, val):
        for w in set(re.findall(r'[A-Z0-9]{3,}', sem_acento(texto))):
            if w not in PARADAS: IDX_W[w[:3]].setdefault(w, []).append(val)
    for cod, m in sorted(MUNS.items()):
        dm = porm.get(cod, {'lic': [], 'out': []})
        lic, out = dm['lic'], dm['out']
        lic.sort(key=lambda r: ({'Vence em até 6 meses': 0, 'Vigente': 1, 'Vencida': 2}[r['si']], r['n']))
        out.sort(key=lambda r: ({'Vence em até 6 meses': 0, 'Irregular': 1, 'Vencida': 2, 'Válida': 3}[r['situ']], r['nome']))
        st = {'lic_vig': sum(r['si'] != 'Vencida' for r in lic), 'lic_venc6': sum(r['si'] == 'Vence em até 6 meses' for r in lic),
              'lic_vencidas': sum(r['si'] == 'Vencida' for r in lic), 'lic_agua_sem': sum('Não localizada' in r.get('oc', '') for r in lic),
              'out_val': sum(r['situ'] in ('Válida', 'Vence em até 6 meses') for r in out), 'out_venc6': sum(r['situ'] == 'Vence em até 6 meses' for r in out),
              'out_irreg': sum(r['situ'] == 'Irregular' for r in out), 'out_vencidas': sum(r['situ'] == 'Vencida' for r in out),
              'out_poco': sum(r['tipo'].startswith('Poço') and r['situ'] != 'Irregular' for r in out),
              'out_sup': sum(r['tipo'] == 'Captação superficial' and r['situ'] != 'Irregular' for r in out)}
        st['top'] = [a for a, _ in collections.Counter(r['a'] for r in lic if r['si'] != 'Vencida').most_common(6)]
        st['sem_coord'] = sum('xy' not in r for r in lic if r['si'] != 'Vencida'); st['aprox'] = sum(1 for r in lic if r.get('lo'))
        tot.update({k: v for k, v in st.items() if isinstance(v, int)})
        for i, r in enumerate(lic):
            v = [cod, 'l', i]
            idx_num(re.sub(r'\D', '', r['d']), v); idx_num(re.sub(r'\D', '', r['p']), v); idx_txt(r['n'], v)
        for i, r in enumerate(out):
            v = [cod, 'o', i]
            nums = re.findall(r'\d+', r.get('num', ''))
            if nums: idx_num(nums[0], v); idx_num(''.join(nums[:2]), v)
            idx_txt(f"{r['nome']} {r.get('emp', '')}", v)
        json.dump({'cod': cod, 'nome': m['nome'], 'atualizado': br(HOJE), 'est': st, 'lic': lic, 'out': out},
                  open(f'{SAIDA}/m/{cod}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
        g = m['geom'].simplify(0.003, preserve_topology=True)
        b = m['geom'].bounds
        feats.append({'type': 'Feature', 'geometry': mapping(g),
                      'properties': {'cod': cod, 'nome': m['nome'], 'bbox': [round(v, 4) for v in b], **{k: v for k, v in st.items() if isinstance(v, int)}}})
    def arred(o):
        if isinstance(o, float): return round(o, 4)
        if isinstance(o, (list, tuple)): return [arred(v) for v in o]
        if isinstance(o, dict): return {k: arred(v) for k, v in o.items()}
        return o
    for pasta, idx in (('n', IDX_N), ('w', IDX_W)):
        os.makedirs(f'{SAIDA}/busca/{pasta}', exist_ok=True)
        for k, d in idx.items():
            json.dump(d, open(f'{SAIDA}/busca/{pasta}/{k}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    log('índice de busca:', sum(len(d) for d in IDX_N.values()), 'números,', sum(len(d) for d in IDX_W.values()), 'palavras,', len(IDX_N) + len(IDX_W), 'arquivos')
    json.dump(arred({'type': 'FeatureCollection', 'features': feats}), open(f'{SAIDA}/municipios.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'atualizado': br(HOJE), 'municipios': len(feats), **tot}, open(f'{SAIDA}/resumo.json', 'w'), ensure_ascii=False, indent=1)
    json.dump({'type': 'FeatureCollection', 'features': pts_lic}, open(f'{SAIDA}/pontos_lic.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'type': 'FeatureCollection', 'features': pts_out}, open(f'{SAIDA}/pontos_out.geojson', 'w'), ensure_ascii=False, separators=(',', ':'))
    log('totais', dict(tot))


if __name__ == '__main__':
    main()
