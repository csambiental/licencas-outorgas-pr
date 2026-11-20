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
    // o SGA grava o texto em UTF-8 dentro de fontes WinAnsi: "Ã§" = "ç". Desfaz a dupla codificação.
    const CP = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
        0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f, 0x3bc: 0xb5 };
    function corrigir(t) {
        if (!/[ÃÂ]/.test(t)) return t;
        // letras que o PDF perdeu (Á, Í viram "•"); "í" vira "Ã-"
        t = t.replace(/Ã[\s\u00a0](?=[a-zà-ú])/g, '\u0004').replace(/Ã-/g, '\u0003').replace(/(^|[^A-Za-zÀ-ÿ])Ã\u2022/g, '$1\u0001').replace(/Ã\u2022/g, '\u0002');
        const b = [];
        for (const ch of t) { const c = ch.codePointAt(0); if (c < 0x80) b.push(c); else if (CP[c]) b.push(CP[c]); else if (c < 0x100) b.push(c); else b.push(...new TextEncoder().encode(ch)); }
        return new TextDecoder('utf-8').decode(new Uint8Array(b)).replace(/\u0001/g, 'Á').replace(/\u0002/g, 'Í').replace(/\u0003/g, 'í').replace(/\u0004/g, 'à').replace(/\uFFFD/g, '');
    }
    const marcaDagua = it => /^\s*(EM\s*)?(BRANCO)?\s*$/.test(it.str) && /EM|BRANCO/.test(it.str) && Math.abs(it.transform[0]) >= 8;
    // texto por linhas (agrupa os trechos pela altura na página)
    async function texto(arq) {
        const lib = await carregar(), pdf = await lib.getDocument({ data: await arq.arrayBuffer() }).promise, linhas = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
            const pg = await pdf.getPage(i), c = await pg.getTextContent(), mapa = new Map();
            for (const it of c.items) { if (!it.str.trim() || marcaDagua(it)) continue; it.str = corrigir(it.str); const y = Math.round(it.transform[5] / 2.5); if (!mapa.has(y)) mapa.set(y, []); mapa.get(y).push(it); }
            [...mapa.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => linhas.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map(t => t.str).join(' ').replace(/\s+/g, ' ').trim()));
        }
        return { linhas, paginas: pdf.numPages };
    }
    const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
    const PRAZO = /(anualmente|anual|semestral(mente)?|trimestral(mente)?|bimestral(mente)?|mensal(mente)?|a cada \d+\s*\(?[\wáéíóúãõç ]*\)?\s*(dias|meses|anos)|no prazo de \d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias|em at[ée] \d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias|\d+\s*\(?[\wáéíóúãõç ]*\)?\s*dias antes|at[ée] \d{2}\/\d{2}\/\d{4}|antes do vencimento|por ocasi[ãa]o da renova[çc][ãa]o|na renova[çc][ãa]o|durante (toda )?a vig[êe]ncia)/i;
    const ROD = /(N[úu]mero do Protocolo|N[úu]mero do Documento|Validade da Licen[çc]a|Instituto [ÁA]gua e Terra|Rua Engenheiros Rebou[çc]as[^\n]*|P[áa]gina\s*\d+\s*\/\s*\d+|Gabinete da Presid[êe]ncia|Secretaria de Estado[^\n]*|[A-Z]{2,5} N[º°] \d+ - \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})/g;
    function analisarSGA(linhas) {
        const t = linhas.join(' ').replace(/\s+/g, ' '), datas = [...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(m => ({ s: m[0], v: +(m[3] + m[2] + m[1]) }));
        const rod = t.match(/\b([A-Z]{2,5}) N[º°] (\d+) - (\d{2}\/\d{2}\/\d{4})/);
        if (!rod && !/Instituto [ÁA]gua e Terra|IAP|SEDEST/.test(t)) return null;
        const r = { sigla: rod ? rod[1] : '', numero: rod ? rod[2] : '', emissao: rod ? rod[3] : '' };
        r.protocolo = (t.match(/\b\d{2}\.\d{3}\.\d{3}-\d\b/) || [''])[0];
        r.modalidade = ((t.match(/concede\s+(.+?)\s+nas condi[çc][õo]es/i) || [])[1] || '').replace(/^(CERTIFICADO|A)\s+DE\s+/i, m => m.toUpperCase().startsWith('CERT') ? '' : m).trim();
        const posterior = datas.filter(d => r.emissao && d.v > +r.emissao.split('/').reverse().join('')).sort((a, b) => b.v - a.v)[0];
        r.validade = posterior ? posterior.s : '';
        r.atividade = ((t.match(/Espec[íi-]?fica\s+(.+?)\s+(Detalhes da Atividade|Coordenadas|Logradouro)/i) || [])[1] || '').trim();
        r.porte = ((t.match(/\b(Micro|Pequeno|M[ée]dio|Grande|Excepcional)\b/) || [])[1] || '');
        // condicionantes: depois de "CONDICIONANTES" até a assinatura; sem cabeçalhos/rodapés de página
        const ini = t.search(/\bCONDICIONANTES\b/i), fim = t.search(/(Curitiba|[A-ZÀ-Ú][a-zà-ú]+), \d{1,2} de [A-Za-zç]+ de \d{4}|Assinatura do Representante/);
        r.condicionantes = [];
        if (ini >= 0) {
            const corpo = t.slice(ini + 'CONDICIONANTES'.length, fim > ini ? fim : undefined).replace(ROD, ' ').replace(/\s+/g, ' ');
            const partes = corpo.split(/\s(?=\d{1,2}\.\s+[A-ZÀ-Ú])/);
            let esperado = 1;
            for (const p of partes) {
                const m = p.trim().match(/^(\d{1,2})\.\s+(.*)$/);
                if (m && +m[1] === esperado) { r.condicionantes.push({ n: m[1], texto: m[2].trim() }); esperado++; }
                else if (r.condicionantes.length) r.condicionantes[r.condicionantes.length - 1].texto += ' ' + p.trim();
            }
            r.condicionantes.forEach(x => { x.texto = x.texto.replace(/\s+P[áa]g(ina)?\.?\s*\d*(\/\d+)?\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 900); const pz = x.texto.match(PRAZO); x.prazo = pz ? pz[0] : ''; x.tema = tema(x.texto); });
        }
        // características declaradas (seção 3), quando houver
        const sec = (a, b) => { const i = t.search(a), j = t.search(b); return i >= 0 ? t.slice(i, j > i ? j : i + 600).replace(ROD, ' ') : ''; };
        r.agua = sec(/3\.3 [ÁA]GUA UTILIZADA/i, /3\.4 /);
        r.efluentes = sec(/3\.4 EFLUENTES/i, /3\.5 /);
        r.residuos = sec(/3\.5 RES[ÍI]DUOS/i, /Obs\.:|4\. CONDICIONANTES/i);
        r.temTexto = t.length > 200; r.formato = 'SGA/IAT';
        return r;
    }
    function tema(x) {
        const T = [['Outorga / recursos hídricos', /outorga|recursos h[íi]dricos|po[çc]o|capta[çc][ãa]o/i], ['Efluentes', /efluente|esgoto|lan[çc]amento/i], ['Resíduos', /res[íi]duo|PGRS|inventário|MTR/i],
            ['Emissões / ruído', /ru[íi]do|sonora|emiss[õo]es|queima|fuma[çc]a|odor/i], ['APP / vegetação', /preserva[çc][ãa]o permanente|APP|vegeta[çc][ãa]o|vegetal|supress/i], ['Solo', /movimenta[çc][ãa]o de solo|terraplenagem|eros[ãa]o/i],
            ['Renovação / alterações', /renova[çc][ãa]o|amplia[çc]|altera[çc]/i], ['Monitoramento', /monitoramento|automonitoramento|relat[óo]rio/i]];
        const a = T.find(([, rx]) => rx.test(x)); return a ? a[0] : 'Geral';
    }
    function analisar(linhas) {
        const sga = analisarSGA(linhas); if (sga && (sga.condicionantes.length || sga.numero)) return sga;
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
    return { ler, analisar, corrigir };
})();
