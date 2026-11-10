"""Lista comercial INTERNA da CS: empresas (pessoa jurídica) do Paraná com licença ambiental (IAT) e/ou outorga de água (SIGARH),
com razão social, CNPJ, endereço e contatos do cadastro aberto da Receita Federal.

USO EXCLUSIVO INTERNO – repositório privado. Não publicar.
- Só pessoa jurídica: CPF nunca é usado nem gravado.
- Empresário individual e MEI: só razão social, CNPJ e município (sem endereço, telefone e e-mail, que costumam ser pessoais).
- Outorgas não trazem CNPJ: são ligadas à empresa pela razão social no mesmo município (marcado como "por nome").

Saída: lista/contatos_PR.xlsx (todas) e lista/municipios/<municipio>.csv
"""
import os, re, io, csv, sys, json, zipfile, collections, datetime, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from processar import http, baixar, log, data, br, proto_fmt, doc_fmt, sem_acento, chave_nome, GRUPO, RX_AGUA, RX_CAPTA, LIC, OUT, HOJE

SAIDA = sys.argv[1] if len(sys.argv) > 1 else 'lista'
TMP = '/tmp/rfb'; os.makedirs(TMP, exist_ok=True)
BASES = ['https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/', 'https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/']
SIT = {'01': 'Nula', '02': 'Ativa', '03': 'Suspensa', '04': 'Inapta', '08': 'Baixada'}
PORTE = {'00': 'Não informado', '01': 'Microempresa', '03': 'Empresa de pequeno porte', '05': 'Demais'}


def cnpj_norm(v):
    """Só CNPJ (14 posições, numérico ou alfanumérico). CPF (até 11 dígitos) volta vazio."""
    if v is None: return ''
    if isinstance(v, (int, float)):
        n = int(v); s = str(n)
        return s.zfill(14) if len(s) > 11 else ''
    s = re.sub(r'[^0-9A-Za-z]', '', str(v)).upper()
    if s.endswith('0') and re.fullmatch(r'\d+\.0', str(v).strip()): s = str(int(float(v)))
    return s.zfill(14) if len(s) > 11 else ''


def fmt_cnpj(c): return f'{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}' if len(c) == 14 else c


TOKEN = os.environ.get('RFB_TOKEN', 'gn672Ad4CF8N6TK')   # compartilhamento público da Receita (arquivos.receitafederal.gov.br)
DAV = 'https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ'
AUTH = {'Authorization': 'Basic ' + __import__('base64').b64encode(f'{TOKEN}:'.encode()).decode()}


def _req(url, metodo='GET', extra=None):
    h = {'User-Agent': 'Mozilla/5.0', **AUTH, **(extra or {})}
    return urllib.request.Request(url, method=metodo, headers=h)


def pasta_receita():
    """Último mês publicado no compartilhamento WebDAV da Receita (novo local desde 2025/2026); antigos endereços como reserva."""
    try:
        t = urllib.request.urlopen(_req(DAV + '/', 'PROPFIND', {'Depth': '1'}), timeout=120).read().decode('utf-8', 'replace')
        meses = sorted(set(re.findall(r'/(\d{4}-\d{2})/?</d:href>', t)))
        if meses:
            return f'https://arquivos.receitafederal.gov.br/public.php/dav/files/{TOKEN}/Dados/Cadastros/CNPJ/{meses[-1]}/'
        log('Receita WebDAV sem meses; resposta:', t[:200])
    except Exception as e:
        log('Receita WebDAV indisponível', e)
    for base in BASES:
        try:
            t = urllib.request.urlopen(urllib.request.Request(base, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120).read().decode('utf-8', 'replace')
            meses = sorted(set(re.findall(r'href="(\d{4}-\d{2})/?"', t)))
            if meses: return base + meses[-1] + '/'
        except Exception as e:
            log('Receita: base indisponível', base, e)
    raise RuntimeError('Não encontrei a pasta de dados abertos do CNPJ')


def baixar_zip(url):
    destino = os.path.join(TMP, url.rsplit('/', 1)[-1])
    if not os.path.exists(destino):
        for t in range(5):
            try:
                with urllib.request.urlopen(_req(url), timeout=900) as r, open(destino + '.part', 'wb') as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b: break
                        f.write(b)
                os.rename(destino + '.part', destino); break
            except Exception as e:
                log('  nova tentativa', url.rsplit('/', 1)[-1], e)
                if t == 4: raise
    return destino


def linhas(zpath):
    with zipfile.ZipFile(zpath) as z:
        for nome in z.namelist():
            with z.open(nome) as f:
                for row in csv.reader(io.TextIOWrapper(f, encoding='latin-1', newline=''), delimiter=';', quotechar='"'):
                    yield row


def main(so_linhas=False):
    # ---------------- licenças (com CNPJ, só para esta lista interna) e outorgas
    camp = ['num_protocolo', 'cpf_cnpj', 'nome_razao_social', 'cod_ibge', 'nome_municipio', 'sigla_modalidade', 'desc_modalidade',
            'desc_grupo_atividade', 'desc_atividade', 'num_documento', 'dt_emissao', 'dt_validade', 'ind_sia']
    lic = baixar(LIC, camp)
    log('licenças', len(lic))
    grupos = collections.defaultdict(list)
    for r in lic: grupos[(str(r.get('cod_ibge')), chave_nome(r.get('nome_razao_social')), sem_acento(r.get('desc_atividade')))].append(data(r.get('dt_emissao')))
    por_cnpj = collections.defaultdict(list); nome_lic = {}; mun_pf = {}
    for r in lic:
        c = cnpj_norm(r.get('cpf_cnpj'))
        tem_doc = r.pop('cpf_cnpj', None) not in (None, '')
        if not c:
            if not tem_doc: continue
            # pessoa física: o CPF é descartado; a linha é identificada só por nome + município
            c = 'PF|' + chave_nome(r.get('nome_razao_social')) + '|' + str(r.get('cod_ibge') or '')[:7]
            mun_pf[c] = r.get('nome_municipio') or ''
        em, va = data(r.get('dt_emissao')), data(r.get('dt_validade'))
        mn = max([d for d in grupos[(str(r.get('cod_ibge')), chave_nome(r.get('nome_razao_social')), sem_acento(r.get('desc_atividade')))] if d], default=None)
        if va and va < HOJE: situ = 'Substituída' if mn and em and mn > em else 'Vencida'
        else: situ = 'Vence em até 6 meses' if va and (va - HOJE).days <= 183 else 'Vigente'
        if situ == 'Substituída': continue
        por_cnpj[c].append({'sig': r.get('sigla_modalidade') or '', 'ativ': r.get('desc_atividade') or r.get('desc_grupo_atividade') or '', 'doc': doc_fmt(r.get('num_documento')),
                            'prot': proto_fmt(r['num_protocolo']) if r.get('num_protocolo') else '', 'va': va, 'situ': situ, 'cod': str(r.get('cod_ibge') or '')[:7],
                            'mun': r.get('nome_municipio') or ''})
        nome_lic.setdefault(c, (r.get('nome_razao_social') or '').strip())
    del lic
    log('CNPJs com licença', len(por_cnpj))
    camp_o = ['nm_requerente', 'cod_municipio_emp', 'cod_municipio', 'nm_municipio', 'nm_tipo_interferencia', 'nr_portaria', 'st_portaria', 'nm_tipo_documento', 'dt_vencimento']
    outs = baixar(OUT, camp_o, "st_portaria IN ('DEFERIDA','EM RENOVAÇÃO','EM REGULARIZAÇÃO','IRREGULAR')")
    log('outorgas', len(outs))

    # ---------------- Receita Federal: estabelecimentos do PR
    pasta = pasta_receita(); log('Receita:', pasta)
    muni_rfb = {r[0]: r[1] for r in linhas(baixar_zip(pasta + 'Municipios.zip'))}
    cnae = {r[0]: r[1] for r in linhas(baixar_zip(pasta + 'Cnaes.zip'))}
    alvo = set(por_cnpj)
    est, basicos_pr = {}, set()
    for i in range(10):
        z = baixar_zip(pasta + f'Estabelecimentos{i}.zip')
        for r in linhas(z):
            if len(r) < 28 or r[19] != 'PR': continue
            c = (r[0] + r[1] + r[2]).upper()
            if c in alvo or r[5] == '02':
                basicos_pr.add(r[0])
                est[c] = r
        os.remove(z); log('  Estabelecimentos', i, 'PR guardados', len(est))
    emp = {}
    for i in range(10):
        z = baixar_zip(pasta + f'Empresas{i}.zip')
        for r in linhas(z):
            if r and r[0] in basicos_pr: emp[r[0]] = (r[1], r[2], r[5] if len(r) > 5 else '')
        os.remove(z)
    log('empresas PR', len(emp))
    mei = set()
    z = baixar_zip(pasta + 'Simples.zip')
    for r in linhas(z):
        if r and r[0] in basicos_pr and len(r) > 4 and r[4] == 'S': mei.add(r[0])
    os.remove(z)
    nat = {r[0]: r[1] for r in linhas(baixar_zip(pasta + 'Naturezas.zip'))}

    # outorgas -> empresa pela razão social no mesmo município (só PJ)
    por_nome = collections.defaultdict(list)
    for c, r in est.items():
        e = emp.get(r[0])
        if e and r[5] == '02': por_nome[(chave_nome(e[0]), sem_acento(muni_rfb.get(r[20], '')))].append(c)
    out_cnpj = collections.defaultdict(list)
    RX_PJ = re.compile(r'\b(LTDA|S/?A|S\.A|EIRELI|ME|EPP|CIA|COMPANHIA|MUNICIPIO|PREFEITURA|ASSOCIACAO|COOPERATIVA|COOP|CONDOMINIO|EMPREENDIMENTOS?|INDUSTRIA|COMERCIO|AGROPECUARIA|AGRICOLA|CONSTRUTORA|SANEPAR|COPEL|ESTADO|SECRETARIA|INSTITUTO|UNIVERSIDADE|ENERGIA|USINA|HOLDING|PARTICIPACOES|IGREJA|FUNDACAO|SERVICOS|TRANSPORTES|ALIMENTOS|INCORPORADORA|LOTEAMENTO)\b')
    for o in outs:
        k = (chave_nome(o.get('nm_requerente')), sem_acento(o.get('nm_municipio')))
        cs = por_nome.get(k, [])
        if not cs:
            nome_o = (o.get('nm_requerente') or '').strip()
            if not nome_o: continue
            cod_o = str(o.get('cod_municipio_emp') or o.get('cod_municipio') or '')[:7]
            pref = 'PJ?|' if RX_PJ.search(sem_acento(nome_o)) else 'PF|'
            cs = [pref + chave_nome(nome_o) + '|' + cod_o]
            mun_pf.setdefault(cs[0], o.get('nm_municipio') or ''); nome_lic.setdefault(cs[0], nome_o)
        cs = sorted(cs, key=lambda c: c in est and est[c][3] != '1')     # matriz primeiro
        venc = data(o.get('dt_vencimento')); st = (o.get('st_portaria') or '').capitalize()
        situ = 'Irregular' if st == 'Irregular' else 'Vencida' if venc and venc < HOJE else 'Vence em até 6 meses' if venc and (venc - HOJE).days <= 183 else 'Válida'
        out_cnpj[cs[0]].append({'tipo': o.get('nm_tipo_interferencia') or '', 'num': o.get('nr_portaria') or '', 'situ': situ, 'venc': venc,
                                'cod': str(o.get('cod_municipio_emp') or o.get('cod_municipio') or '')[:7],
                                'capta': bool(RX_CAPTA.search(f"{o.get('nm_tipo_interferencia', '')} {o.get('nm_tipo_documento', '')}"))})
    log('empresas com outorga (por nome)', len(out_cnpj))

    # ---------------- monta a lista
    linhas_saida = []
    for c in set(por_cnpj) | set(out_cnpj):
        pf = c.startswith('PF|'); pj_nao_loc = c.startswith('PJ?|')
        r = None if pf or pj_nao_loc else est.get(c); e = emp.get(c[:8]) if r else None
        L = por_cnpj.get(c, []); O = out_cnpj.get(c, [])
        natureza = nat.get(e[1], e[1]) if e else ''
        pessoal = bool(e and (e[1] == '2135' or c[:8] in mei))
        mun = (muni_rfb.get(r[20], '') if r else '') or (L[0]['mun'] if L else '') or mun_pf.get(c, '')
        tipo = 'Pessoa física (PF)' if pf else 'PJ não localizada na Receita' if pj_nao_loc else ('MEI' if c[:8] in mei else 'Empresário individual' if e and e[1] == '2135' else 'Pessoa jurídica (PJ)')
        lv = [x for x in L if x['situ'] in ('Vigente', 'Vence em até 6 meses')]
        l6 = [x for x in L if x['situ'] == 'Vence em até 6 meses']; lx = [x for x in L if x['situ'] == 'Vencida']
        o6 = [x for x in O if x['situ'] == 'Vence em até 6 meses']; ox = [x for x in O if x['situ'] in ('Vencida', 'Irregular')]
        agua_sem = any(RX_AGUA.search(x['ativ']) for x in lv) and not any(x['capta'] and x['situ'] != 'Irregular' for x in O)
        pts = 3 * bool(lx) + 3 * bool(ox) + 2 * bool(l6) + 2 * bool(o6) + 2 * agua_sem
        oport = '; '.join(t for t, ok in [
            (f'{len(l6)} licença(s) vencem em até 6 meses', l6), (f'{len(lx)} licença(s) vencida(s) sem renovação', lx),
            (f'{len(o6)} outorga(s) vencem em até 6 meses', o6), (f'{len(ox)} outorga(s) vencida(s)/irregular(es)', ox),
            ('atividade com consumo de água sem outorga de captação encontrada', agua_sem)] if ok)
        prox = min([x['va'] for x in lv if x['va']] + [x['venc'] for x in O if x['venc'] and x['situ'] != 'Irregular' and x['venc'] >= HOJE], default=None)
        end = ''
        if r and not pessoal:
            end = ' '.join(p for p in [r[13], r[14]] if p).strip() + (f', {r[15]}' if r[15] else '') + (f' – {r[16]}' if r[16] else '')
        tel = '' if pessoal or not r else ' / '.join(f'({d}) {t}' for d, t in [(r[21], r[22]), (r[23], r[24])] if t)
        linhas_saida.append({
            'Prioridade comercial': 'Alta' if pts >= 3 else 'Média' if pts >= 2 else 'Baixa',
            'Oportunidades': oport or 'Licenças/outorgas em dia',
            'Tipo de pessoa': tipo,
            'Razão social / titular': (e[0] if e else nome_lic.get(c, '')), 'Nome fantasia': (r[4] if r else ''), 'CNPJ': '' if pf or pj_nao_loc else fmt_cnpj(c),
            'Matriz/filial': ('Matriz' if r and r[3] == '1' else 'Filial' if r else ''), 'Situação na Receita': SIT.get(r[5], r[5]) if r else ('' if pf else 'Não encontrada'),
            'Natureza jurídica': natureza + (' (MEI)' if c[:8] in mei else ''), 'Porte': PORTE.get(e[2], '') if e else '',
            'Atividade principal (CNAE)': f"{r[11]} – {cnae.get(r[11], '')}" if r else '',
            'Endereço': end, 'Bairro': '' if pessoal or not r else r[17], 'CEP': '' if pessoal or not r else r[18], 'Município': mun,
            'Telefone': tel, 'E-mail': '' if pessoal or not r else (r[27] or '').lower(),
            'Licenças vigentes': len(lv), 'Licenças vencem em 6 meses': len(l6), 'Licenças vencidas': len(lx),
            'Atividades licenciadas': '; '.join(sorted({x['ativ'] for x in lv}))[:400],
            'Licenças (modalidade nº – validade)': '; '.join(f"{x['sig']} nº {x['doc']} – {br(x['va']) or 's/ validade'} ({x['situ']})" for x in L)[:900],
            'Outorgas (por nome)': '; '.join(f"{x['num']} – {x['tipo']} – {br(x['venc']) or '–'} ({x['situ']})" for x in O)[:900],
            'Próximo vencimento': br(prox),
            '_keys': [('l', x['cod'], x['prot']) for x in L if x['prot']] + [('o', x['cod'], x['num']) for x in O if x['num']], 'Contato pessoal omitido': 'Sim' if pessoal or pf else '',
        })
    ordem = {'Alta': 0, 'Média': 1, 'Baixa': 2}
    linhas_saida.sort(key=lambda x: (x['Município'], ordem[x['Prioridade comercial']], x['Razão social / titular']))
    log('titulares na lista', len(linhas_saida), collections.Counter(x['Tipo de pessoa'] for x in linhas_saida), collections.Counter(x['Prioridade comercial'] for x in linhas_saida))

    if so_linhas: return linhas_saida
    os.makedirs(f'{SAIDA}/municipios', exist_ok=True)
    # ---------------- arquivos
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    cab = [k for k in linhas_saida[0].keys() if not k.startswith('_')]
    wb = Workbook(); ws = wb.active; ws.title = 'Empresas PR'
    ws.append(cab)
    for x in linhas_saida: ws.append([x[k] for k in cab])
    for i, k in enumerate(cab, 1):
        ws.cell(1, i).font = Font(bold=True, color='FFFFFF'); ws.cell(1, i).fill = PatternFill('solid', fgColor='2E7D32')
        ws.cell(1, i).alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[get_column_letter(i)].width = {'Oportunidades': 45, 'Razão social': 40, 'Endereço': 40, 'Atividades licenciadas': 40,
                                                             'Licenças (modalidade nº – validade)': 50, 'Outorgas (por nome)': 45}.get(k, 18)
    ws.freeze_panes = 'C2'; ws.auto_filter.ref = ws.dimensions
    res = wb.create_sheet('Resumo por município')
    res.append(['Município', 'Titulares', 'Pessoa jurídica', 'Pessoa física (PF)', 'Prioridade alta', 'Prioridade média', 'Licenças vencendo (6 meses)', 'Com telefone ou e-mail'])
    agg = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])
    for x in linhas_saida:
        a = agg[x['Município']]; a[0] += 1; a[1] += x['Tipo de pessoa'] != 'Pessoa física (PF)'; a[2] += x['Tipo de pessoa'] == 'Pessoa física (PF)'
        a[3] += x['Prioridade comercial'] == 'Alta'; a[4] += x['Prioridade comercial'] == 'Média'
        a[5] += x['Licenças vencem em 6 meses'] > 0; a[6] += bool(x['Telefone'] or x['E-mail'])
    for m, a in sorted(agg.items(), key=lambda t: -t[1][3]): res.append([m, *a])
    for c in res[1]: c.font = Font(bold=True)
    aviso = wb.create_sheet('Leia antes')
    for t in ['USO EXCLUSIVO INTERNO DA CS CONSULTORIA AMBIENTAL – não compartilhar fora da empresa.',
              f'Gerado em {br(HOJE)} a partir de dados públicos: IAT/GeoPR (licenças e outorgas) e cadastro aberto de CNPJ da Receita Federal.',
              'Pessoa física aparece marcada como PF, só com o nome publicado pelo IAT e o município (sem CPF, endereço ou contato), para dimensionar o público rural.',
              'Para MEI e empresário individual não são trazidos endereço, telefone e e-mail (dados pessoais).',
              'Outorgas não têm CNPJ: foram ligadas à empresa pela razão social no mesmo município (conferir).',
              'Na abordagem: contato profissional ligado à atividade licenciada, informar a origem dos dados e oferecer a opção de não receber mais contatos (LGPD).']:
        aviso.append([t])
    aviso.column_dimensions['A'].width = 140
    wb.move_sheet('Leia antes', offset=-2)
    wb.save(f'{SAIDA}/contatos_PR.xlsx')
    porm = collections.defaultdict(list)
    for x in linhas_saida: porm[x['Município'] or 'Sem município'].append(x)
    for m, xs in porm.items():
        nome = re.sub(r'\W+', '_', sem_acento(m)).strip('_') or 'SEM_MUNICIPIO'
        with open(f'{SAIDA}/municipios/{nome}.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=cab, delimiter=';', extrasaction='ignore'); w.writeheader(); w.writerows(xs)
    json.dump({'gerado': br(HOJE), 'empresas': len(linhas_saida), 'receita': pasta}, open(f'{SAIDA}/resumo.json', 'w'), ensure_ascii=False, indent=1)
    log('ok')


if __name__ == '__main__':
    main()
