"""Contatos das empresas (uso interno CS) para o mapa público, CRIPTOGRAFADOS.

Os arquivos ficam no site, mas só podem ser lidos com a senha da CS (segredo CONTATOS_SENHA do repositório),
digitada no botão "Área CS" do mapa. Sem a senha, o conteúdo é ilegível (AES-256-GCM, chave PBKDF2-SHA256).
Nada de dados de contato é impresso no log (o log das Actions é público).

Uso: CONTATOS_SENHA=... python3 tools/contatos_cripto.py <pasta_saida_do_site>
"""
import os, sys, json, secrets, collections
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

SENHA = os.environ.get('CONTATOS_SENHA', '')
SAIDA = sys.argv[1]
if not SENHA:
    print('CONTATOS_SENHA não definida – contatos não gerados'); sys.exit(0)
sys.argv = [sys.argv[0], SAIDA]  # processar.py lê a pasta de saída do argv
sys.path.insert(0, os.path.dirname(__file__))
import contatos

ITER = 250000
sal = secrets.token_bytes(16)
chave = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITER).derive(SENHA.encode())
aes = AESGCM(chave)


def cifrar(obj, caminho):
    n = secrets.token_bytes(12)
    with open(caminho, 'wb') as f: f.write(n + aes.encrypt(n, json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode(), None))


linhas = contatos.main(so_linhas=True)
CAMPOS = {'tp': 'Tipo de pessoa', 'rs': 'Razão social / titular', 'nf': 'Nome fantasia', 'cnpj': 'CNPJ', 'mf': 'Matriz/filial', 'sit': 'Situação na Receita',
          'nat': 'Natureza jurídica', 'porte': 'Porte', 'cnae': 'Atividade principal (CNAE)', 'end': 'Endereço', 'bai': 'Bairro', 'cep': 'CEP', 'mun': 'Município',
          'tel': 'Telefone', 'email': 'E-mail', 'prio': 'Prioridade comercial', 'oport': 'Oportunidades', 'prox': 'Próximo vencimento'}
porm = collections.defaultdict(lambda: {'r': [], 'l': {}, 'o': {}})
for x in linhas:
    reg = {k: x.get(v) for k, v in CAMPOS.items() if x.get(v)}
    feitos = set()
    for t, cod, chave_reg in x['_keys']:
        d = porm[cod]
        if cod not in feitos: d['r'].append(reg); feitos.add(cod)
        d[t].setdefault(chave_reg, []).append(len(d['r']) - 1)
os.makedirs(f'{SAIDA}/c', exist_ok=True)
for cod, d in porm.items():
    cifrar(d, f'{SAIDA}/c/{cod}.bin')
cifrar('ok', f'{SAIDA}/c/verifica.bin')
json.dump({'sal': sal.hex(), 'iter': ITER}, open(f'{SAIDA}/c/chave.json', 'w'))
print('contatos criptografados:', len(porm), 'municípios')
