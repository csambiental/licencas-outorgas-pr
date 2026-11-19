"""Baixa PDFs de licenças do SGA por protocolo e extrai o texto (teste de leitura)."""
import sys, os, subprocess, urllib.request, http.cookiejar, ssl
SGA = 'https://www.sga.pr.gov.br/sga-iap/consultarProcessoLicenciamento.do?action=exibirDadosPublicoLicenca&ucsChamador=carregarInterfaceInicial'
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ctx = ssl.create_default_context(); ctx.set_ciphers('DEFAULT:@SECLEVEL=1')
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [('User-Agent', 'Mozilla/5.0')]
for prot in sys.argv[2:]:
    n = prot.replace('.', '').replace('-', '')
    op.open(f"{SGA}&numProtocolo={n}&indSia=false", timeout=120).read()   # abre a sessão do processo
    url = f"https://www.sga.pr.gov.br/sga-iap/consultarProcessoLicenciamento.do?action=exibirDocumentoLicenca&numProtocolo={n}"
    try:
        r = op.open(url, timeout=120); dados = r.read(); tipo = r.headers.get('Content-Type')
        ext = 'pdf' if dados[:4] == b'%PDF' else 'html'
        arq = f'{OUT}/{prot}.{ext}'; open(arq, 'wb').write(dados)
        print(prot, tipo, len(dados), ext, flush=True)
        if ext == 'pdf':
            subprocess.run(['pdftotext', '-layout', arq, arq[:-4] + '.txt'])
            print(open(arq[:-4] + '.txt', errors='ignore').read()[:3000])
        else: print(dados[:1500].decode('latin-1', 'ignore'))
    except Exception as e: print(prot, 'ERRO', e)
