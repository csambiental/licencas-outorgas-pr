// Leitura do PDF da licença anexado pelo usuário (baixado no SGA). Tudo no navegador: o arquivo não é enviado a servidor.
window.LeitorLicenca = (function () {
    'use strict';
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    async function carregar() {
        if (window.pdfjsLib) return window.pdfjsLib;
        await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = PDFJS; s.onload = ok; s.onerror = () => erro(new Error('não foi possível carregar o leitor de PDF')); document.head.appendChild(s); });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
        return window.pdfjsLib;
    }
    // texto por linhas (agrupa os trechos pela altura na página)
    async function texto(arq) {
        const lib = await carregar(), pdf = await lib.getDocument({ data: await arq.arrayBuffer() }).promise, linhas = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
            const pg = await pdf.getPage(i), c = await pg.getTextContent(), mapa = new Map();
            for (const it of c.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 2.5); if (!mapa.has(y)) mapa.set(y, []); mapa.get(y).push(it); }
            [...mapa.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => linhas.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map(t => t.str).join(' ').replace(/\s+/g, ' ').trim()));
        }
        return { linhas, paginas: pdf.numPages };
    }
    const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
    const PRAZO = /(anualmente|anual|semestral(mente)?|trimestral(mente)?|bimestral(mente)?|mensal(mente)?|a cada \d+\s*\(?[\wáéíóúãõç ]*\)?\s*(dias|meses|anos)|no prazo de \d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias|em at[ée] \d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias|\d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias antes|at[ée] \d{2}\/\d{2}\/\d{4}|antes do vencimento|por ocasi[ãa]o da renova[çc][ãa]o|na renova[çc][ãa]o|durante (toda )?a vig[êe]ncia)/i;
    function analisar(linhas) {
        const t = linhas.join('\n'), achar = (rx, g = 1) => { const m = t.match(rx); return m ? m[g].trim() : ''; };
        const r = {
            modalidade: (linhas.find(l => /^(LICEN[ÇC]A|DECLARA[ÇC][ÃA]O|AUTORIZA[ÇC][ÃA]O|DISPENSA)\b/i.test(l) && l.length < 140) || '').replace(/\s+N[º°o]\.?.*$/i, ''),
            numero: achar(/(?:Licen[çc]a|Declara[çc][ãa]o|Autoriza[çc][ãa]o|Documento)[^\n]{0,40}?N[º°o]\.?\s*:?\s*([\d.\/-]{3,})/i),
            protocolo: achar(/Protocolo[^\n\d]{0,20}(\d{1,2}\.?\d{3}\.?\d{3}-?\d)/i),
            validade: achar(/(?:Validade|V[áa]lid[ao] at[ée]|Vencimento|Prazo de validade)[^\n]{0,60}?(\d{2}\/\d{2}\/\d{4})/i),
            emissao: achar(/(?:Data de emiss[ãa]o|Emiss[ãa]o|Emitid[ao] em|Expedi[çc][ãa]o)[^\n]{0,40}?(\d{2}\/\d{2}\/\d{4})/i),
            atividade: achar(/Atividade[^\n:]{0,25}:\s*([^\n]{5,160})/i)
        };
        // condicionantes: do título até observações/assinatura
        const ini = linhas.findIndex(l => /^\s*(CONDICIONANTES|CONDI[ÇC][ÕO]ES (E RESTRI[ÇC][ÕO]ES|ESPEC[ÍI]FICAS|GERAIS)|RESTRI[ÇC][ÕO]ES E CONDI[ÇC][ÕO]ES|DAS CONDICIONANTES)\b/i.test(l));
        const itens = [];
        if (ini >= 0) {
            const fim = linhas.findIndex((l, i) => i > ini && /^\s*(OBSERVA[ÇC][ÕO]ES|Documento assinado|ASSINATURA|Esta (licen[çc]a|declara[çc][ãa]o) (n[ãa]o|tem|perde)|Curitiba,|Londrina,|Autentica[çc][ãa]o)/i.test(l));
            let atual = null;
            for (const l of linhas.slice(ini + 1, fim > 0 ? fim : undefined)) {
                const m = l.match(/^\s*((\d{1,2})[\.\)\-–]|([IVXL]{1,5})\s*[\.\)\-–]|([a-z])\))\s*(.*)$/);
                if (m && m[5]) { atual = { n: m[2] || m[3] || m[4], texto: m[5] }; itens.push(atual); }
                else if (atual && l.length > 2 && !/^P[áa]gina \d+/i.test(l)) atual.texto += ' ' + l;
            }
            itens.forEach(x => { x.texto = x.texto.replace(/\s+/g, ' ').trim().slice(0, 900); const p = x.texto.match(PRAZO); x.prazo = p ? p[0] : ''; });
        }
        r.condicionantes = itens;
        r.temTexto = t.replace(/\s/g, '').length > 200;
        return r;
    }
    async function ler(arq) {
        const { linhas, paginas } = await texto(arq);
        return Object.assign(analisar(linhas), { arquivo: arq.name, paginas });
    }
    return { ler, analisar };
})();
