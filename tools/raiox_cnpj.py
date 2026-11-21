"""Raio X do empreendimento a partir do CNPJ, sem expor o CNPJ: o pedido traz só o SHA-256 dos 14 dígitos.
Procura o CNPJ na base de licenças do IAT, roda tools/raiox.mjs para a razão social encontrada e gera PDF.
Os resultados são cifrados com a chave pública tools/chave_publica_relatorios.pem antes de sair do workflow.
Uso: HASHES="h1;h2" python3 tools/raiox_cnpj.py PASTA"""
import os, sys, re, json, hashlib, subprocess, collections
sys.path.insert(0, os.path.dirname(__file__))
from processar import baixar, LIC
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
H = [h.strip().lower() for h in os.environ.get('HASHES', '').split(';') if h.strip()]
dig = lambda v: re.sub(r'\D', '', str(v or ''))
lic = baixar(LIC, ['cpf_cnpj', 'nome_razao_social', 'cod_ibge', 'nome_municipio'])
print('licenças lidas', len(lic), flush=True)
achou = collections.defaultdict(list)
for r in lic:
    d = dig(r.get('cpf_cnpj'))
    if len(d) == 14:
        h = hashlib.sha256(d.encode()).hexdigest()
        if h in H: achou[h].append((d, (r.get('nome_razao_social') or '').strip(), str(r.get('cod_ibge') or '')[:7], r.get('nome_municipio') or ''))
resumo = []
for i, h in enumerate(H, 1):
    regs = achou.get(h, [])
    if not regs: resumo.append({'n': i, 'encontrado': False}); print(i, 'não encontrado', flush=True); continue
    cnpj = regs[0][0]; nome = collections.Counter(x[1] for x in regs).most_common(1)[0][0]
    muns = collections.Counter(x[3] for x in regs)
    pasta = f'{OUT}/emp{i}'
    cmd = ['node', 'tools/raiox.mjs', '--titular', nome, '--cnpj', cnpj, '--finalidade', 'Diagnóstico', '--titulo', 'Raio X do Empreendimento', '--saida', pasta]
    p = subprocess.run(cmd, capture_output=True, text=True)
    print(i, 'raiox exit', p.returncode, p.stderr[-400:].replace(cnpj, '***'), flush=True)
    resumo.append({'n': i, 'encontrado': True, 'nome': nome, 'cnpj': cnpj, 'licencas_cnpj': len(regs), 'municipios': dict(muns), 'ok': p.returncode == 0})
json.dump(resumo, open(f'{OUT}/resumo.json', 'w'), ensure_ascii=False, indent=1)
# PDF de cada relatorio.html
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for r in resumo:
        f = f"{OUT}/emp{r['n']}/relatorio.html"
        if not os.path.exists(f): continue
        pg = b.new_page(); pg.goto('file://' + os.path.abspath(f), wait_until='load'); pg.wait_for_timeout(4000)
        pg.emulate_media(media='print'); pg.pdf(path=f"{OUT}/emp{r['n']}/relatorio.pdf", format='A4', print_background=True, prefer_css_page_size=True)
        print('pdf', r['n'], os.path.getsize(f"{OUT}/emp{r['n']}/relatorio.pdf"), flush=True)
    b.close()
