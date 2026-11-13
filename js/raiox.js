// Raio X Ambiental da Área – CS Consultoria Ambiental
// Motor único usado pelo site (navegador) e pelo agente/linha de comando (Node: tools/raiox.mjs).
// Entrada: uma área (ponto + raio, ou polígono + entorno) e os arquivos da base (municipios.geojson e m/<cod>.json).
// Saída: resultado calculado (JSON) e relatório HTML pronto para imprimir/PDF.
(function (raiz) {
    'use strict';
    const R = {};
    const VERSAO = '1.2';
    const MAPBOX_TOKEN = 'pk.eyJ1IjoiY3NhbWJpZW50YWwiLCJhIjoiY205MWk4eHU4MDE3czJxcHNqamR4emd5aiJ9.e8K-ENRHJwXTz_FGGwYExg';
    const SGA = 'https://www.sga.pr.gov.br/sga-iap/consultarProcessoLicenciamento.do?action=exibirDadosPublicoLicenca&ucsChamador=carregarInterfaceInicial';
    const PJ = /\b(LTDA|S\.?\s?A\.?|S\/A|ME|EPP|EIRELI|CIA|COMPANHIA|COOPERATIVA|COOP|ASSOCIA[CÇ][AÃ]O|SINDICATO|INSTITUTO|FUNDA[CÇ][AÃ]O|PREFEITURA|MUNIC[IÍ]PIO|ESTADO|SECRETARIA|SERVI[CÇ]O|SANEAMENTO|SANEPAR|COPEL|IND[UÚ]STRIA|COM[EÉ]RCIO|AGRO|EMPREENDIMENTOS|INCORPORA|CONSTRU|TRANSPORT|HOSPITAL|IGREJA|CONDOM[IÍ]NIO|UNIVERSIDADE|FACULDADE|COL[EÉ]GIO|ESCOLA|POSTO|AUTO|PARTICIPA[CÇ][OÕ]ES|HOLDING|GRUPO|CENTRO|CLUBE|LOTEAMENTO|MINERA|CER[AÂ]MICA|FRIGOR|LATIC|USINA|DESTILARIA|ENERGIA|TELECOM|LOG[IÍ]STICA|DISTRIBUIDORA|ATACAD|SUPERMERCADO|MERCADO|FARM|LABORAT|CL[IÍ]NICA)\b/i;

    // ---------------------------------------------------------------- geometria (metros, projeção local)
    const KX = lat => 111320 * Math.cos(lat * Math.PI / 180), KY = 110574;
    function local(o) { const kx = KX(o[1]); return p => [(p[0] - o[0]) * kx, (p[1] - o[1]) * KY]; }
    function dist(a, b) { const kx = KX((a[1] + b[1]) / 2); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KY); }
    function dentro(p, anel) {
        let c = false;
        for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
            const [xi, yi] = anel[i], [xj, yj] = anel[j];
            if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
    }
    function distSeg(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    }
    function areaAnel(anel) { // m², projeção local no 1º vértice
        const f = local(anel[0]), q = anel.map(f); let s = 0;
        for (let i = 0, j = q.length - 1; i < q.length; j = i++) s += (q[j][0] + q[i][0]) * (q[j][1] - q[i][1]);
        return Math.abs(s) / 2;
    }
    function areaGeom(g) {
        const pol = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return pol.reduce((s, p) => s + areaAnel(p[0]) - p.slice(1).reduce((h, a) => h + areaAnel(a), 0), 0);
    }

    // Área de estudo: {tipo:'circulo', centro:[lon,lat], raio:m} ou {tipo:'poligono', aneis:[[[lon,lat],…],…], entorno:m, nome}
    R.area = function (a) {
        a = Object.assign({}, a);
        if (a.tipo === 'circulo') {
            a.raio = +a.raio || 1000;
            const dLat = a.raio / KY, dLon = a.raio / KX(a.centro[1]);
            a.bbox = [a.centro[0] - dLon, a.centro[1] - dLat, a.centro[0] + dLon, a.centro[1] + dLat];
            a.m2 = Math.PI * a.raio * a.raio;
            a.dist = p => dist(p, a.centro);
            a.contem = p => a.dist(p) <= a.raio;
            a.contorno = Array.from({ length: 49 }, (_, i) => { const t = i / 48 * 2 * Math.PI; return [a.centro[0] + Math.cos(t) * dLon, a.centro[1] + Math.sin(t) * dLat]; });
        } else {
            a.entorno = +a.entorno || 0;
            const pts = a.aneis.flat();
            const mx = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
            a.centro = [(mx[0] + mx[2]) / 2, (mx[1] + mx[3]) / 2];
            const dLat = a.entorno / KY, dLon = a.entorno / KX(a.centro[1]);
            a.bbox = [mx[0] - dLon, mx[1] - dLat, mx[2] + dLon, mx[3] + dLat];
            const f = local(a.centro), Q = a.aneis.map(an => an.map(f));
            const perim = Q.reduce((s, an) => s + an.reduce((t, p, i) => t + Math.hypot(p[0] - an[(i + 1) % an.length][0], p[1] - an[(i + 1) % an.length][1]), 0), 0);
            a.m2poligono = a.aneis.reduce((s, an) => s + areaAnel(an), 0);
            a.m2 = a.m2poligono + perim * a.entorno + Math.PI * a.entorno * a.entorno; // polígono + faixa de entorno (aprox.)
            a.dist = p => {
                if (a.aneis.some(an => dentro(p, an))) return 0;
                const q = f(p); let d = Infinity;
                for (const an of Q) for (let i = 0, j = an.length - 1; i < an.length; j = i++) d = Math.min(d, distSeg(q, an[j], an[i]));
                return d;
            };
            a.contem = p => a.dist(p) <= a.entorno;
            a.contorno = a.aneis[0];
        }
        return a;
    };

    // Lê polígonos de um KML (texto). Devolve lista de anéis [[lon,lat],…].
    R.lerKML = function (txt) {
        const aneis = [];
        const blocos = txt.match(/<outerBoundaryIs>[\s\S]*?<\/outerBoundaryIs>/gi) || txt.match(/<LinearRing>[\s\S]*?<\/LinearRing>/gi) || [];
        for (const b of blocos) {
            const c = (b.match(/<coordinates>([\s\S]*?)<\/coordinates>/i) || [])[1];
            if (!c) continue;
            const an = c.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(p => isFinite(p[0]) && isFinite(p[1])).map(p => [p[0], p[1]]);
            if (an.length >= 3) aneis.push(an);
        }
        const nome = (txt.match(/<name>([^<]{1,120})<\/name>/i) || [])[1];
        return { aneis, nome: nome ? nome.trim() : '' };
    };

    // Municípios cuja caixa toca a área
    R.municipiosDaArea = function (area, munGeo) {
        const b = area.bbox;
        return munGeo.features.filter(f => { const c = f.properties.bbox; return c && !(c[2] < b[0] || c[0] > b[2] || c[3] < b[1] || c[1] > b[3]); })
            .map(f => f.properties.cod);
    };

    const provavelPF = n => !PJ.test(n || '');
    const ocultar = (n, op) => op && op.anonimizar && provavelPF(n) && !(op.cliente && R.chaveNome(n) === R.chaveNome(op.cliente)) ? 'Pessoa física (nome omitido)' : n;
    const num = s => { const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
    const dataBR = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? new Date(+m[3], m[2] - 1, +m[1]) : null; };
    const conta = (L, f) => L.reduce((o, x) => { const k = f(x) || '—'; o[k] = (o[k] || 0) + 1; return o; }, {});
    const ordem = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

    // ---------------------------------------------------------------- cálculo
    // dados = [{cod, nome, atualizado, est, lic, out}], munGeo = municipios.geojson
    R.calcular = function (area, dados, munGeo, op) {
        op = op || {};
        const lic = [], out = [], semCoord = { lic: 0, out: 0 };
        const munInfo = {};
        for (const d of dados) {
            const f = munGeo.features.find(x => x.properties.cod === d.cod);
            const km2 = f ? areaGeom(f.geometry) / 1e6 : null;
            munInfo[d.cod] = { cod: d.cod, nome: d.nome, km2, licGeo: d.lic.filter(x => x.xy && x.si !== 'Vencida').length, outGeo: d.out.filter(x => x.xy && x.situ !== 'Irregular' && x.situ !== 'Vencida').length, naArea: 0 };
            for (const x of d.lic) {
                if (!x.xy) continue;
                const dm = area.dist(x.xy);
                if (area.tipo === 'circulo' ? dm <= area.raio : dm <= area.entorno) { lic.push(Object.assign({}, x, { dm: Math.round(dm), cod: d.cod, mun: d.nome })); munInfo[d.cod].naArea++; }
            }
            for (const x of d.out) {
                if (!x.xy) continue;
                const dm = area.dist(x.xy);
                if (area.tipo === 'circulo' ? dm <= area.raio : dm <= area.entorno) { out.push(Object.assign({}, x, { dm: Math.round(dm), cod: d.cod, mun: d.nome })); munInfo[d.cod].naArea++; }
            }
        }
        lic.sort((a, b) => a.dm - b.dm); out.sort((a, b) => a.dm - b.dm);
        const km2 = area.m2 / 1e6;
        const vig = lic.filter(x => x.si !== 'Vencida'), outVal = out.filter(x => x.situ === 'Válida' || x.situ === 'Vence em até 6 meses');
        const capt = outVal.filter(x => /Capta|Poço/.test(x.tipo));
        const vazCapt = capt.reduce((s, x) => s + num(x.vazao), 0);
        const lanc = outVal.filter(x => x.tipo === 'Lançamento de efluentes');
        const k = {
            lic_total: lic.length, lic_vig: vig.length, lic_venc6: lic.filter(x => x.si === 'Vence em até 6 meses').length, lic_vencidas: lic.filter(x => x.si === 'Vencida').length,
            lic_agua_sem: lic.filter(x => /Não localizada/.test(x.oc || '')).length, lic_agua_outro: lic.filter(x => /outro titular/.test(x.oc || '')).length,
            out_total: out.length, out_val: outVal.length, out_venc6: out.filter(x => x.situ === 'Vence em até 6 meses').length,
            out_vencidas: out.filter(x => x.situ === 'Vencida').length, out_irreg: out.filter(x => x.situ === 'Irregular').length,
            out_poco: capt.filter(x => x.tipo.startsWith('Poço')).length, out_sup: capt.filter(x => x.tipo === 'Captação superficial').length,
            out_lanc: lanc.length, vazao_capt_m3h: Math.round(vazCapt * 10) / 10,
            titulares: new Set(lic.concat(out).map(x => (x.n || x.nome || '').toUpperCase())).size
        };
        // comparação com a média dos municípios da área (só registros com coordenada)
        const mm = Object.values(munInfo).filter(m => m.naArea && m.km2);
        const dens = (campo) => { const t = mm.reduce((s, m) => s + m[campo], 0), a = mm.reduce((s, m) => s + m.km2, 0); return a ? t / a : 0; };
        const comp = { lic_km2_area: km2 ? k.lic_vig / km2 : 0, lic_km2_mun: dens('licGeo'), out_km2_area: km2 ? (k.out_val) / km2 : 0, out_km2_mun: dens('outGeo') };
        comp.lic_razao = comp.lic_km2_mun ? comp.lic_km2_area / comp.lic_km2_mun : null;
        comp.out_razao = comp.out_km2_mun ? comp.out_km2_area / comp.out_km2_mun : null;

        const res = {
            versao: VERSAO, emitido: new Date().toLocaleDateString('pt-BR'), base: (dados[0] || {}).atualizado || '',
            titulo: op.titulo || 'Raio X Ambiental da Área', finalidade: op.finalidade || 'Diagnóstico', cliente: op.cliente || '',
            area: { tipo: area.tipo, centro: area.centro.map(v => +v.toFixed(6)), raio: area.raio, entorno: area.entorno, nome: area.nome || '', km2: +km2.toFixed(3), ha: +(km2 * 100).toFixed(1), haPoligono: area.m2poligono ? +(area.m2poligono / 1e4).toFixed(1) : null, contorno: area.contorno },
            municipios: Object.values(munInfo).filter(m => m.naArea).map(m => m.nome),
            k, comp,
            licPorTipo: ordem(conta(vig, x => x.g)), licPorAtividade: ordem(conta(vig, x => x.a)).slice(0, 10),
            outPorTipo: ordem(conta(outVal, x => x.tipo)), bacias: ordem(conta(out, x => x.bacia)), corpos: ordem(conta(outVal, x => x.corpo)).slice(0, 8),
            setores: ordem(conta(outVal, x => x.setor)).slice(0, 6), finalidades: ordem(conta(outVal.flatMap(x => (x.fin || '').split(/,\s*/).filter(Boolean).map(f => ({ f }))), x => x.f)).slice(0, 8),
            lic, out, semCoordMun: dados.reduce((s, d) => s + (d.est ? d.est.sem_coord || 0 : 0), 0)
        };
        res.achados = R.achados(res);
        return res;
    };

    // ---------------------------------------------------------------- achados (regras)
    R.achados = function (r) {
        const k = r.k, A = [], fmt = n => (n || 0).toLocaleString('pt-BR');
        const ar = r.area.tipo === 'circulo' ? `num raio de ${fmt(r.area.raio)} m` : `no polígono${r.area.entorno ? ` e entorno de ${fmt(r.area.entorno)} m` : ''}`;
        A.push({ n: 'Fato', t: `${ar[0].toUpperCase() + ar.slice(1)} há ${fmt(k.lic_total)} licenças ambientais georreferenciadas (${fmt(k.lic_vig)} vigentes) e ${fmt(k.out_total)} outorgas de água (${fmt(k.out_val)} válidas), de ${fmt(k.titulares)} titulares diferentes.` });
        if (k.lic_venc6) A.push({ n: 'Fato', risco: 'Médio', t: `${fmt(k.lic_venc6)} licença(s) vence(m) em até 6 meses. A renovação deve ser requerida com antecedência mínima de 120 dias do vencimento (LC 140/2011, art. 14, §4º).`, op: 'Renovação de licença' });
        if (k.lic_vencidas) A.push({ n: 'Hipótese a verificar', risco: 'Alto', t: `${fmt(k.lic_vencidas)} licença(s) vencida(s) sem renovação registrada no IAT. Pode indicar operação sem licença ou atividade encerrada; confirmar em campo.`, op: 'Regularização de licenciamento' });
        if (k.lic_agua_sem) A.push({ n: 'Hipótese a verificar', risco: 'Alto', t: `${fmt(k.lic_agua_sem)} atividade(s) que normalmente usam água sem outorga de captação localizada a até 500 m. Verificar a fonte de abastecimento (rede pública, poço ou captação).`, op: 'Outorga de captação' });
        if (k.out_irreg) A.push({ n: 'Fato', risco: 'Alto', t: `${fmt(k.out_irreg)} outorga(s) classificada(s) como irregular(es) pelo IAT na área.`, op: 'Regularização de outorga' });
        if (k.out_vencidas) A.push({ n: 'Fato', risco: 'Alto', t: `${fmt(k.out_vencidas)} outorga(s) vencida(s).`, op: 'Renovação de outorga' });
        if (k.out_venc6) A.push({ n: 'Fato', risco: 'Médio', t: `${fmt(k.out_venc6)} outorga(s) vence(m) em até 6 meses.`, op: 'Renovação de outorga' });
        if (k.out_poco + k.out_sup) A.push({ n: 'Fato', t: `Uso da água: ${[k.out_poco ? `${fmt(k.out_poco)} poço(s)` : '', k.out_sup ? `${fmt(k.out_sup)} captação(ões) superficial(is)` : ''].filter(Boolean).join(' e ')} com outorga válida, somando ${k.vazao_capt_m3h.toLocaleString('pt-BR')} m³/h de vazão máxima outorgada.` });
        if (r.comp.out_razao && r.comp.out_razao >= 1.5) A.push({ n: 'Interpretação', risco: 'Médio', t: `A densidade de outorgas válidas na área é ${r.comp.out_razao.toFixed(1).replace('.', ',')} vezes a média dos municípios com registros na área: indício de pressão sobre os recursos hídricos locais, a confirmar com o balanço hídrico da bacia.` });
        if (k.out_lanc) A.push({ n: 'Fato', t: `${fmt(k.out_lanc)} outorga(s) de lançamento de efluentes. Corpos receptores: ${r.corpos.slice(0, 4).map(c => c[0]).join(', ')}.` });
        if (r.comp.lic_razao && r.comp.lic_razao >= 2) A.push({ n: 'Interpretação', t: `Concentração de atividades licenciadas ${r.comp.lic_razao.toFixed(1).replace('.', ',')} vezes acima da média municipal: área de uso intenso, com maior chance de impactos cumulativos.` });
        return A;
    };

    // ---------------------------------------------------------------- saídas
    R.csv = function (r, tipo, op) {
        const L = tipo === 'lic' ? r.lic : r.out;
        const col = tipo === 'lic'
            ? [['Distância (m)', 'dm'], ['Titular', 'n'], ['Atividade', 'a'], ['Atividade específica', 'e'], ['Modalidade', 's'], ['Tipo', 'g'], ['Nº do documento', 'd'], ['Emissão', 'em'], ['Validade', 'va'], ['Situação', 'si'], ['Outorga de captação', 'oc'], ['Protocolo', 'p'], ['Município', 'mun']]
            : [['Distância (m)', 'dm'], ['Titular', 'nome'], ['Empreendimento', 'emp'], ['Tipo', 'interf'], ['Documento', 'doc'], ['Nº', 'num'], ['Situação', 'situ'], ['Publicação', 'pub'], ['Vencimento', 'venc'], ['Finalidade', 'fin'], ['Vazão máx. (m³/h)', 'vazao'], ['Corpo hídrico / aquífero', 'corpo'], ['Bacia', 'bacia'], ['Setor', 'setor'], ['Município', 'mun']];
        const ct = op && op.contatos ? [['Contato – razão social', x => x.ct && x.ct.rs], ['CNPJ', x => x.ct && x.ct.cnpj], ['Telefone', x => x.ct && x.ct.tel], ['E-mail', x => x.ct && x.ct.email], ['Prioridade', x => x.ct && x.ct.prio]] : [];
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const nomeCampo = tipo === 'lic' ? 'n' : 'nome';
        const cab = col.map(c => c[0]).concat(ct.map(c => c[0]), ['Longitude', 'Latitude']);
        const linhas = L.map(x => col.map(([, c]) => q(c === nomeCampo ? ocultar(x[c], op) : x[c])).concat(ct.map(([, f]) => q(f(x))), [q(String(x.xy[0]).replace('.', ',')), q(String(x.xy[1]).replace('.', ','))]).join(';'));
        return '﻿' + [cab.map(q).join(';')].concat(linhas).join('\r\n');
    };

    // pontos com prioridade (atenção primeiro) e cor
    function pontosMapa(r) {
        const cor = { lic: '2e7d32', venc: '9e9e9e', alerta: 'e65100', out: '0277bd', prob: 'c62828' }, P = [];
        for (const x of r.lic.filter(x => x.xy)) { const al = x.si === 'Vence em até 6 meses' || /Não localizada/.test(x.oc || ''); P.push([al ? 0 : x.si === 'Vencida' ? 2 : 1, x.xy, x.si === 'Vencida' ? cor.venc : al ? cor.alerta : cor.lic]); }
        for (const x of r.out.filter(x => x.xy)) { const pr = /Vencida|Irregular/.test(x.situ); P.push([pr ? 0 : x.situ === 'Vence em até 6 meses' ? 0 : 1, x.xy, pr ? cor.prob : x.situ === 'Vence em até 6 meses' ? cor.alerta : cor.out]); }
        return P.sort((a, b) => a[0] - b[0]);
    }
    function polyline(pts) { // Google encoded polyline (lat,lon), precisão 5
        let s = '', pl = 0, pn = 0;
        const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
        for (const [lon, lat] of pts) { const a = Math.round(lat * 1e5), b = Math.round(lon * 1e5); s += enc(a - pl) + enc(b - pn); pl = a; pn = b; }
        return s;
    }
    R.mapaURL = function (r, w, h, estilo) {
        w = w || 900; h = h || 520;
        const P = pontosMapa(r), f5 = v => v.toFixed(5);
        const cont = r.area.contorno.length > 120 ? r.area.contorno.filter((_, i, a) => i % Math.ceil(a.length / 120) === 0).concat([r.area.contorno[0]]) : r.area.contorno;
        const caminho = `path-3+c62828-0.9+c62828-0.07(${encodeURIComponent(polyline(cont))})`;
        const mk = n => `https://api.mapbox.com/styles/v1/mapbox/${estilo || 'light-v11'}/static/${[caminho].concat(P.slice(0, n).reverse().map(p => `pin-s+${p[2]}(${f5(p[1][0])},${f5(p[1][1])})`)).join(',')}/auto/${w}x${h}@2x?padding=40&access_token=${MAPBOX_TOKEN}`;
        let n = Math.min(P.length, 250), u = mk(n);
        while (u.length > 8000 && n > 0) { n -= 10; u = mk(Math.max(n, 0)); }
        return { url: u, pontos: Math.max(n, 0), total: P.length };
    };
    // Croqui SVG sem mapa de fundo (sempre funciona, inclusive offline e no PDF)
    R.croquiSVG = function (r, w, h) {
        w = w || 900; h = h || 520;
        const P = pontosMapa(r), c = r.area.contorno, pts = c.concat(P.map(p => p[1]));
        const kx = KX(r.area.centro[1]);
        let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
        const Wm = (x1 - x0) * kx || 1, Hm = (y1 - y0) * KY || 1, esc = Math.min((w - 80) / Wm, (h - 80) / Hm);
        const X = lon => 40 + ((lon - x0) * kx) * esc + ((w - 80) - Wm * esc) / 2, Y = lat => h - 40 - ((lat - y0) * KY) * esc - ((h - 80) - Hm * esc) / 2;
        const barra = [100, 200, 500, 1000, 2000, 5000, 10000].find(v => v * esc >= 80) || 10000;
        const ptsSvg = P.slice().reverse().map(p => `<circle cx="${X(p[1][0]).toFixed(1)}" cy="${Y(p[1][1]).toFixed(1)}" r="4" fill="#${p[2]}" stroke="#fff" stroke-width="1"/>`).join('');
        return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;border:1px solid #dfe5dc;border-radius:6px;background:#fafbf9" role="img" aria-label="Croqui da área">
<polygon points="${c.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="#c62828" fill-opacity="0.06" stroke="#c62828" stroke-width="2"/>${ptsSvg}
<circle cx="${X(r.area.centro[0])}" cy="${Y(r.area.centro[1])}" r="5" fill="none" stroke="#1f2a1f" stroke-width="1.5"/><path d="M${X(r.area.centro[0]) - 9} ${Y(r.area.centro[1])}h18M${X(r.area.centro[0])} ${Y(r.area.centro[1]) - 9}v18" stroke="#1f2a1f" stroke-width="1.2"/>
<g transform="translate(${w - 40},44)"><path d="M0 -22L7 0H-7Z" fill="#1f2a1f"/><text y="14" text-anchor="middle" font-size="12" fill="#1f2a1f">N</text></g>
<g transform="translate(40,${h - 18})"><rect width="${(barra * esc).toFixed(1)}" height="5" fill="#1f2a1f"/><text x="${(barra * esc + 6).toFixed(1)}" y="6" font-size="11" fill="#5f6b5f">${barra >= 1000 ? barra / 1000 + ' km' : barra + ' m'}</text></g>
<text x="${w - 12}" y="${h - 12}" text-anchor="end" font-size="10" fill="#5f6b5f">Croqui sem fundo de mapa · coordenadas declaradas no IAT</text></svg>`;
    };

    const ESTILO = `<style>
:root{--v:#1b5e20;--v2:#2e7d32;--s:#5f6b5f;--b:#dfe5dc;--f:#f5f7f4}
*{box-sizing:border-box}body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#1f2a1f;margin:0;background:#e9ece7}
.pg{max-width:210mm;margin:16px auto;background:#fff;padding:14mm 14mm 10mm;box-shadow:0 1px 8px rgba(0,0,0,.15)}
header{display:flex;align-items:center;gap:14px;border-bottom:3px solid var(--v2);padding-bottom:10px}header img{height:52px}
header h1{margin:0;color:var(--v);font-size:20px}header p{margin:2px 0 0;color:var(--s);font-size:12px}
.meta{display:grid;grid-template-columns:150px 1fr;gap:3px 10px;font-size:12px;margin:12px 0;padding:10px;background:var(--f);border-radius:6px}.meta b{color:var(--s);font-weight:600}
h2{color:var(--v);font-size:15px;margin:20px 0 8px;border-bottom:1px solid var(--b);padding-bottom:4px;break-after:avoid}h3{font-size:13px;color:var(--v2);margin:14px 0 6px;break-after:avoid}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.kpi{border:1px solid var(--b);border-radius:6px;padding:6px 8px;background:var(--f)}.kpi b{display:block;font-size:18px;color:var(--v)}.kpi span{font-size:10.5px;color:var(--s)}
.kpi.v b{color:#c62828}.kpi.a b{color:#e65100}
ul.ach{padding-left:0;list-style:none;margin:6px 0}ul.ach li{font-size:12px;margin:5px 0;padding:6px 8px;border-left:4px solid var(--b);background:#fafbf9}ul.ach li.v{border-left-color:#c62828}ul.ach li.a{border-left-color:#e65100}
ul.ach .cl{font-size:10px;font-weight:700;color:var(--s);text-transform:uppercase;margin-right:6px}
.mapa{width:100%;border:1px solid var(--b);border-radius:6px;display:block}.leg{font-size:10.5px;color:var(--s);margin:4px 0}.leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 3px 0 10px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:10.5px;margin:4px 0}th{background:var(--f);text-align:left;color:var(--s);font-weight:600;padding:4px 5px;border-bottom:1px solid var(--b)}td{padding:4px 5px;border-bottom:1px solid #eef1ec;vertical-align:top}tr{break-inside:avoid}
td small{color:var(--s)}.nu{text-align:right;white-space:nowrap}a{color:var(--v2);text-decoration:none}
.kv td:first-child{width:75%}.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tg{display:inline-block;font-size:9.5px;padding:1px 6px;border-radius:9px;white-space:nowrap}.tg.v{background:#ffebee;color:#c62828}.tg.a{background:#fff3e0;color:#e65100}.tg.ok{background:#e8f5e9;color:#2e7d32}
.nota,.vazio{font-size:10.5px;color:var(--s)}.box{font-size:11.5px;background:var(--f);border-radius:6px;padding:8px 10px}
footer{margin-top:18px;border-top:1px solid var(--b);padding-top:6px;font-size:9.5px;color:var(--s)}
.barra{max-width:210mm;margin:10px auto 0;display:flex;gap:8px}.barra button{padding:8px 14px;border:0;border-radius:6px;background:var(--v2);color:#fff;cursor:pointer}
@media print{body{background:#fff}.pg{margin:0;box-shadow:none;padding:0;max-width:none}.barra{display:none}@page{size:A4;margin:12mm}}
</style>`;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const fmtN = n => (n ?? 0).toLocaleString('pt-BR');
    const linkSGA = x => `${SGA}&numProtocolo=${String(x.p).replace(/\D/g, '')}&indSia=${x.sia ? 'true' : 'false'}`;

    R.relatorioHTML = function (r, op) {
        op = op || {};
        const k = r.k, mapa = R.mapaURL(r);
        const tag = s => `<span class="tg ${/Vencida|Irregular/.test(s) ? 'v' : /6 meses/.test(s) ? 'a' : 'ok'}">${esc(s)}</span>`;
        const ctCel = x => op.contatos ? `<td>${x.ct ? `${esc(x.ct.rs || '')}<br>${esc([x.ct.tel, x.ct.email].filter(Boolean).join(' · '))}` : '—'}</td>` : '';
        const ctTh = op.contatos ? '<th>Contato (uso interno)</th>' : '';
        const tabLic = (L, lim) => !L.length ? '<p class="vazio">Nenhum registro.</p>' : `<table><thead><tr><th>Dist. (m)</th><th>Titular</th><th>Atividade</th><th>Licença</th><th>Validade</th><th>Situação</th>${ctTh}</tr></thead><tbody>${L.slice(0, lim || 1e9).map(x => `<tr><td class="nu">${fmtN(x.dm)}</td><td>${esc(ocultar(x.n, op))}</td><td>${esc(x.a)}${x.e && x.e !== x.a ? `<br><small>${esc(x.e)}</small>` : ''}${x.oc ? `<br><small>💧 ${esc(x.oc)}</small>` : ''}</td><td><a href="${linkSGA(x)}">${esc(x.s)} ${esc(x.d)}</a></td><td>${esc(x.va || '—')}</td><td>${tag(x.si)}</td>${ctCel(x)}</tr>`).join('')}</tbody></table>${lim && L.length > lim ? `<p class="nota">Mostrando os ${lim} mais próximos de ${fmtN(L.length)}. A lista completa está na planilha.</p>` : ''}`;
        const tabOut = (L, lim) => !L.length ? '<p class="vazio">Nenhum registro.</p>' : `<table><thead><tr><th>Dist. (m)</th><th>Titular</th><th>Tipo / finalidade</th><th>Nº</th><th>Vencimento</th><th>Vazão (m³/h)</th><th>Situação</th>${ctTh}</tr></thead><tbody>${L.slice(0, lim || 1e9).map(x => `<tr><td class="nu">${fmtN(x.dm)}</td><td>${esc(ocultar(x.nome, op))}${x.emp ? `<br><small>${esc(x.emp)}</small>` : ''}</td><td>${esc(x.interf || x.tipo)}${x.fin ? `<br><small>${esc(x.fin)}</small>` : ''}</td><td>${esc(x.num || '—')}</td><td>${esc(x.venc || '—')}</td><td class="nu">${esc(x.vazao || '—')}</td><td>${tag(x.situ)}</td>${ctCel(x)}</tr>`).join('')}</tbody></table>${lim && L.length > lim ? `<p class="nota">Mostrando os ${lim} mais próximos de ${fmtN(L.length)}. A lista completa está na planilha.</p>` : ''}`;
        const kv = (L, u) => L.length ? `<table class="kv">${L.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="nu">${fmtN(b)}${u || ''}</td></tr>`).join('')}</table>` : '<p class="vazio">—</p>';
        const area = r.area.tipo === 'circulo'
            ? `Círculo de raio ${fmtN(r.area.raio)} m centrado em ${r.area.centro[1].toFixed(5)}, ${r.area.centro[0].toFixed(5)} (${fmtN(r.area.ha)} ha)`
            : `Polígono${r.area.nome ? ` “${esc(r.area.nome)}”` : ''} de ${fmtN(r.area.haPoligono)} ha${r.area.entorno ? ` + entorno de ${fmtN(r.area.entorno)} m (${fmtN(r.area.ha)} ha no total)` : ''}`;
        const kpi = (v, t, c) => `<div class="kpi ${c || ''}"><b>${fmtN(v)}</b><span>${t}</span></div>`;
        const risco = { Alto: 'v', Médio: 'a' };
        const lv6 = r.lic.filter(x => x.si === 'Vence em até 6 meses'), lvc = r.lic.filter(x => x.si === 'Vencida'), lag = r.lic.filter(x => /Não localizada/.test(x.oc || ''));
        const oprob = r.out.filter(x => x.situ !== 'Válida');
        const ops = {};
        r.achados.filter(a => a.op).forEach(a => ops[a.op] = 1);
        const finalidade = { 'Prospecção': 'Uso interno CS – prospecção comercial', 'Diagnóstico': 'Diagnóstico técnico – Ficha de Inteligência Prévia', 'Entrega': 'Relatório ao cliente' }[r.finalidade] || r.finalidade;
        return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(r.titulo)}${r.cliente ? ' – ' + esc(r.cliente) : ''}</title>
${ESTILO}</head><body>
${op.botaoImprimir === false ? '' : '<div class="barra"><button onclick="print()">Imprimir / salvar em PDF</button></div>'}
<div class="pg">
<header><img src="${esc(op.logo || 'logo.png')}" alt="CS Consultoria Ambiental"><div><h1>${esc(r.titulo)}</h1><p>Licenças ambientais (IAT – SGA/SIA) e outorgas de água (SIGARH) na área de interesse</p></div></header>
<div class="meta"><b>Área</b><span>${area}</span>${r.cliente ? `<b>Cliente / referência</b><span>${esc(r.cliente)}</span>` : ''}<b>Município(s)</b><span>${esc(r.municipios.join(', ') || '—')}</span>
<b>Finalidade</b><span>${esc(finalidade)}</span><b>Base de dados</b><span>Atualizada em ${esc(r.base)} · emitido em ${esc(r.emitido)} · motor Raio X v${r.versao}</span></div>

<h2>1. Resumo</h2>
<div class="kpis">${kpi(k.lic_vig, 'licenças vigentes')}${kpi(k.lic_venc6, 'licenças vencem em até 6 meses', 'a')}${kpi(k.lic_vencidas, 'licenças vencidas sem renovação', 'v')}${kpi(k.lic_agua_sem, 'atividades com uso de água sem outorga próxima', 'a')}
${kpi(k.out_val, 'outorgas válidas')}${kpi(k.out_venc6, 'outorgas vencem em até 6 meses', 'a')}${kpi(k.out_vencidas + k.out_irreg, 'outorgas vencidas ou irregulares', 'v')}${kpi(k.vazao_capt_m3h, 'm³/h de vazão de captação outorgada')}</div>
<h3>Principais achados</h3>
<ul class="ach">${r.achados.map(a => `<li class="${risco[a.risco] || ''}"><span class="cl">${esc(a.n)}${a.risco ? ' · risco ' + esc(a.risco.toLowerCase()) : ''}</span>${esc(a.t)}</li>`).join('')}</ul>

<h2>2. Mapa da área</h2>
<img class="mapa" src="${esc(mapa.url)}" alt="Mapa da área com licenças e outorgas" onerror="this.style.display='none';this.nextElementSibling.style.display='block';var n=document.getElementById('notaMapa');if(n)n.style.display='none'"><div style="display:${op.soCroqui ? 'block' : 'none'}">${R.croquiSVG(r)}</div>
<p class="leg">Contorno vermelho: área analisada.<i style="background:#2e7d32"></i>licença vigente<i style="background:#e65100"></i>vence em 6 meses / água sem outorga<i style="background:#9e9e9e"></i>licença vencida<i style="background:#0277bd"></i>outorga válida<i style="background:#c62828"></i>outorga vencida/irregular${mapa.pontos < mapa.total ? `<span id="notaMapa"> · o mapa de ruas mostra ${mapa.pontos} de ${mapa.total} pontos, priorizando os de atenção (lista completa nas tabelas e planilhas)</span>` : ''}</p>

<h2>3. Licenciamento ambiental</h2>
<div class="cols"><div><h3>Licenças vigentes por tipo</h3>${kv(r.licPorTipo)}</div><div><h3>Atividades mais licenciadas</h3>${kv(r.licPorAtividade)}</div></div>

<h2>4. Recursos hídricos</h2>
<div class="cols"><div><h3>Outorgas válidas por tipo</h3>${kv(r.outPorTipo)}<h3>Bacias</h3>${kv(r.bacias)}</div><div><h3>Corpos hídricos / aquíferos</h3>${kv(r.corpos)}<h3>Finalidades de uso</h3>${kv(r.finalidades)}</div></div>
<p class="box">Densidade na área: ${r.comp.out_km2_area.toFixed(1).replace('.', ',')} outorgas válidas/km², contra ${r.comp.out_km2_mun.toFixed(2).replace('.', ',')}/km² na média do(s) município(s)${r.comp.out_razao ? ` (${r.comp.out_razao.toFixed(1).replace('.', ',')}×)` : ''}. Licenças vigentes: ${r.comp.lic_km2_area.toFixed(1).replace('.', ',')}/km² contra ${r.comp.lic_km2_mun.toFixed(2).replace('.', ',')}/km²${r.comp.lic_razao ? ` (${r.comp.lic_razao.toFixed(1).replace('.', ',')}×)` : ''}.</p>

<h2>5. Pontos de atenção</h2>
<h3>Licenças que vencem em até 6 meses (${fmtN(lv6.length)})</h3>${tabLic(lv6)}
<h3>Atividades com uso típico de água sem outorga de captação próxima (${fmtN(lag.length)})</h3>${tabLic(lag)}
<h3>Licenças vencidas sem renovação (${fmtN(lvc.length)})</h3>${tabLic(lvc, 60)}
<h3>Outorgas vencidas, irregulares ou que vencem em 6 meses (${fmtN(oprob.length)})</h3>${tabOut(oprob, 80)}

<h2>6. Inventário da área</h2>
<h3>Licenças vigentes (${fmtN(k.lic_vig)})</h3>${tabLic(r.lic.filter(x => x.si !== 'Vencida'), 120)}
<h3>Outorgas válidas (${fmtN(k.out_val)})</h3>${tabOut(r.out.filter(x => x.situ === 'Válida'), 120)}

${Object.keys(ops).length ? `<h2>7. ${r.finalidade === 'Prospecção' ? 'Oportunidades de atuação' : 'Recomendações CS'}</h2><ul class="ach">${Object.keys(ops).map(o => `<li><span class="cl">Recomendação CS</span>${esc(o)}: ${esc({ 'Renovação de licença': 'organizar o calendário de renovações e condicionantes antes do prazo de 120 dias.', 'Regularização de licenciamento': 'confirmar a situação das atividades com licença vencida e, se em operação, regularizar junto ao IAT.', 'Outorga de captação': 'verificar a fonte de água das atividades sem outorga localizada e requerer outorga ou dispensa no SIGARH.', 'Regularização de outorga': 'regularizar as outorgas irregulares para afastar autuação e restrição de uso.', 'Renovação de outorga': 'protocolar a renovação das outorgas vencidas ou a vencer.' }[o] || '')}</li>`).join('')}</ul>` : ''}

<h2>${Object.keys(ops).length ? 8 : 7}. Limitações e fontes</h2>
<p class="box">Relatório gerado automaticamente a partir de dados públicos: IAT/GeoPR (licenciamento ambiental SGA/SIA e outorgas do SIGARH), consulta pública do SGA e IBGE, consolidados pela plataforma Licenças e Outorgas do Paraná da CS. Só entram registros com coordenada; ${fmtN(r.semCoordMun)} licenças vigentes do(s) município(s) não têm coordenada no IAT e podem estar na área. As localizações são as declaradas pelos titulares e podem conter erros. “Hipótese a verificar” indica achado que depende de confirmação documental ou de campo. Este Raio X não substitui vistoria, parecer técnico, consulta a restrições territoriais (unidades de conservação, APP, terras indígenas) nem diagnóstico ambiental completo.${op.anonimizar ? ' Nomes de pessoas físicas foram omitidos.' : ''}</p>
<footer>CS Consultoria Ambiental · Londrina/PR · Raio X Ambiental da Área v${r.versao}${r.finalidade === 'Prospecção' ? ' · DOCUMENTO DE USO INTERNO' : ''}</footer>
</div></body></html>`;
    };

    // ================================================================ RAIO X DO EMPREENDIMENTO (análise unitária)
    const semAc = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    R.chaveNome = t => semAc(t).replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|LIMITADA)\b/g, '').replace(/[^A-Z0-9]/g, '');
    const PARADAS = new Set(['LTDA', 'EIRELI', 'DOS', 'DAS', 'DE', 'DO', 'DA', 'EPP', 'CIA', 'FILIAL', 'MATRIZ', 'S/A', 'SA', 'LIMITADA', 'EM', 'PARA', 'COM', 'POR']);
    R.palavras = nome => [...new Set(semAc(nome).match(/[A-Z0-9]{3,}/g) || [])].filter(w => !PARADAS.has(w));
    R.provavelPF = provavelPF;
    const RX_AGUA = /avicult|suinocult|bovinocult|bubalinocult|ovinocult|caprinocult|equinocult|cunicult|piscicult|aquicult|carcinicult|ranicult|cria[çc][ãa]o de (animais|aves|su[íi]nos|bovinos|frangos|peixes)|confinamento|leite|latic|abate|frigor|alimentos|bebida|f[ée]cula|amido|aguardente|cacha[çc]a|destilaria|usina|curtume|irriga|viveiro|hortali|cogumel|lavagem|lavador|beneficiamento/i;
    const RX_EFL = /latic|leite|abate|frigor|curtume|galvan|tinturaria|lavanderia|f[ée]cula|amido|destilaria|usina|bebida|refriger|cervej|alimentos|suinocult|avicult|bovinocult|confinamento|piscicult|lavagem|lavador|posto de combust|qu[íi]mic|papel|celulose|metal|tratamento de (esgoto|efluente)|aterro/i;
    const RX_EMI = /caldeira|forno|fundi[çc]|cer[âa]mica|olaria|asfalto|torrefa|secagem|secador|usina|metal[úu]rg|siderurg|cimento|cal\b|incinera|pintura|graf|serraria|biomassa|termel|gera[çc][ãa]o de energia|ra[çc][ãa]o/i;
    const somaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const br = d => d ? d.toLocaleDateString('pt-BR') : '—';

    // ref = {nome, cod, xy?, cnpj?}; dados = arquivos m/<cod>.json carregados; op = {soMunicipio, finalidade, ...}
    R.empreendimento = function (ref, dados, munGeo, op) {
        op = op || {};
        const chave = R.chaveNome(ref.nome), pf = provavelPF(ref.nome), hoje = new Date();
        const so = pf || op.soMunicipio;
        let lic = [], out = [];
        for (const d of dados) {
            if (so && d.cod !== ref.cod) continue;
            for (const x of d.lic) if (R.chaveNome(x.n) === chave) lic.push(Object.assign({}, x, { cod: d.cod, mun: d.nome }));
            for (const x of d.out) if (R.chaveNome(x.nome) === chave) out.push(Object.assign({}, x, { cod: d.cod, mun: d.nome }));
        }
        // refinamento por CNPJ (quando os contatos da Área CS foram anexados em x.ct)
        let vinculo = 'nome do titular normalizado' + (so ? ' no município' : ' em todo o Paraná');
        if (op.cnpj) {
            const raiz = String(op.cnpj).replace(/\D/g, '').slice(0, 8);
            const ok = x => !x.ct || !x.ct.cnpj || x.ct.cnpj.replace(/\D/g, '').startsWith(raiz);
            lic = lic.filter(ok); out = out.filter(ok);
            vinculo = `CNPJ (raiz ${raiz}) e nome do titular`;
        }
        const ref0 = ref.xy || null;
        for (const x of lic.concat(out)) x.dm = x.xy && ref0 ? Math.round(dist(x.xy, ref0)) : null;
        const ordSit = { 'Vence em até 6 meses': 0, 'Irregular': 1, 'Vencida': 2, 'Vigente': 3, 'Válida': 3 };
        lic.sort((a, b) => (ordSit[a.si] - ordSit[b.si]) || ((a.dm ?? 1e9) - (b.dm ?? 1e9)));
        out.sort((a, b) => (ordSit[a.situ] - ordSit[b.situ]) || ((a.dm ?? 1e9) - (b.dm ?? 1e9)));

        // unidades físicas: ligação simples – pontos a até 500 m de qualquer ponto da unidade formam a mesma unidade
        let U = [];
        for (const x of lic.concat(out).filter(x => x.xy)) {
            const junta = U.filter(u => u.m.some(p => dist(p.xy, x.xy) <= 500));
            const u = { m: [x].concat(...junta.map(j => j.m)) };
            U = U.filter(v => !junta.includes(v)).concat([u]);
        }
        U = U.map(u => {
            const xy = [u.m.reduce((s, p) => s + p.xy[0], 0) / u.m.length, u.m.reduce((s, p) => s + p.xy[1], 0) / u.m.length];
            const L = u.m.filter(p => p.n);
            return { xy, mun: u.m[0].mun, cod: u.m[0].cod, lic: L.length, out: u.m.length - L.length, ativ: [...new Set(L.filter(p => p.si !== 'Vencida').map(p => p.a))], membros: u.m };
        });
        U.sort((a, b) => ref0 ? Math.min(...a.membros.map(p => dist(p.xy, ref0))) - Math.min(...b.membros.map(p => dist(p.xy, ref0))) : (b.lic + b.out) - (a.lic + a.out));
        U.forEach((u, i) => { u.id = 'U' + (i + 1); u.dm = ref0 ? Math.round(dist(u.xy, ref0)) : null; u.membros.forEach(p => p._u = u.id); delete u.membros; });
        const sem = { lic: lic.filter(x => !x.xy).length, out: out.filter(x => !x.xy).length };

        // ------------- matriz preliminar (padrão da matriz de conformidade do Modelo CS)
        const vig = lic.filter(x => x.si !== 'Vencida'), v6 = lic.filter(x => x.si === 'Vence em até 6 meses'), venc = lic.filter(x => x.si === 'Vencida');
        const atv = lic.map(x => `${x.a} ${x.e || ''}`).join(' | ');
        const capt = out.filter(x => /Capta|Poço/.test(x.tipo)), captOk = capt.filter(x => x.situ === 'Válida' || x.situ === 'Vence em até 6 meses').sort((a, b) => (/direito/i.test(b.doc) ? 1 : 0) - (/direito/i.test(a.doc) ? 1 : 0)), captProb = capt.filter(x => /Vencida|Irregular/.test(x.situ));
        const lanc = out.filter(x => x.tipo === 'Lançamento de efluentes'), lancOk = lanc.filter(x => !/Vencida|Irregular/.test(x.situ)), lancProb = lanc.filter(x => /Vencida|Irregular/.test(x.situ));
        const semOut = lic.filter(x => /Não localizada/.test(x.oc || '')), usaAgua = RX_AGUA.test(atv) || semOut.length > 0;
        const docL = x => `${x.s} ${x.d} (${x.a}) até ${x.va || '—'}`, docO = x => `${x.doc || 'Outorga'} ${x.num || 's/ nº'} – ${x.interf || x.tipo}${x.vazao ? `, ${x.vazao} m³/h` : ''}, venc. ${x.venc || '—'}`;
        const M = [];
        const add = (id, tema, req, st, risco, evid, acao, natureza) => M.push({ id, tema, req, st, risco, evid, acao, natureza: natureza || (st === 'Sem evidência' ? 'Pendente' : 'Fato (base pública)') });
        if (vig.length) add('LIC-01', 'Licenciamento', 'Operar com licença ambiental válida (LC 140/2011; CONAMA 237/1997)', 'Conforme', 'Baixo', vig.slice(0, 4).map(docL).join('; ') + (vig.length > 4 ? ` e mais ${vig.length - 4}` : ''), 'Conferir se a licença cobre a atividade e a capacidade atuais na vistoria.');
        else if (lic.length) add('LIC-01', 'Licenciamento', 'Operar com licença ambiental válida (LC 140/2011; CONAMA 237/1997)', 'Não conforme', 'Alto', `Todas as ${lic.length} licenças localizadas estão vencidas sem renovação registrada.`, 'Confirmar se a atividade opera; se sim, regularizar no IAT com urgência.', 'Hipótese a verificar');
        else add('LIC-01', 'Licenciamento', 'Operar com licença ambiental válida (LC 140/2011; CONAMA 237/1997)', 'Sem evidência', out.length ? 'Alto' : 'Médio', 'Nenhuma licença do titular na base com o nome pesquisado (pode estar sem coordenada, em outra razão social, ser dispensada ou de competência municipal).', 'Solicitar licenças ao cliente e consultar o SGA pelo CNPJ.');
        if (v6.length) {
            const tarde = v6.filter(x => { const v = dataBR(x.va); return v && somaDias(v, -120) < hoje; });
            add('LIC-02', 'Licenciamento', 'Requerer renovação com 120 dias de antecedência (LC 140/2011, art. 14, §4º)', 'Parcial', tarde.length ? 'Alto' : 'Médio',
                v6.map(x => `${x.s} ${x.d} vence ${x.va}; prazo de 120 dias ${somaDias(dataBR(x.va), -120) < hoje ? 'já passou' : 'até ' + br(somaDias(dataBR(x.va), -120))}`).join('; '),
                tarde.length ? 'Protocolar a renovação imediatamente e verificar se há protocolo no SGA.' : 'Preparar e protocolar a renovação antes do prazo de 120 dias.');
        } else if (vig.length) add('LIC-02', 'Licenciamento', 'Requerer renovação com 120 dias de antecedência (LC 140/2011, art. 14, §4º)', 'Conforme', 'Baixo', 'Nenhuma licença vence nos próximos 6 meses.', 'Manter calendário de vencimentos.');
        if (venc.length && vig.length) add('LIC-06', 'Licenciamento', 'Atividades licenciadas no passado continuam regulares ou foram encerradas', 'Verificar', 'Médio', `${venc.length} licença(s) vencida(s) sem renovação: ${[...new Set(venc.map(x => x.a))].slice(0, 4).join('; ')}.`, 'Confirmar em vistoria se essas atividades foram encerradas ou incorporadas a outra licença.', 'Hipótese a verificar');
        if (captProb.length) add('AGU-01', 'Água', 'Captação outorgada ou dispensada (Lei 9.433/1997)', 'Não conforme', 'Alto', captProb.map(docO).join('; '), 'Regularizar ou renovar a outorga no SIGARH.');
        else if (captOk.length) add('AGU-01', 'Água', 'Captação outorgada ou dispensada (Lei 9.433/1997)', 'Conforme', 'Baixo', captOk.slice(0, 4).map(docO).join('; '), 'Conferir em vistoria hidrômetro e volumes captados dentro do outorgado.');
        else if (usaAgua) add('AGU-01', 'Água', 'Captação outorgada ou dispensada (Lei 9.433/1997)', 'Sem evidência', semOut.length ? 'Alto' : 'Médio', semOut.length ? `Atividade com uso típico de água e nenhuma outorga de captação localizada a até 500 m: ${semOut.slice(0, 3).map(x => x.a).join('; ')}.` : 'Atividade com uso típico de água e nenhuma outorga de captação do titular.', 'Verificar a fonte de água (rede pública, poço, captação) e requerer outorga ou dispensa.', 'Hipótese a verificar');
        const o6 = out.filter(x => x.situ === 'Vence em até 6 meses');
        if (o6.length) add('AGU-04', 'Água', 'Outorgas renovadas antes do vencimento', 'Parcial', 'Médio', o6.map(docO).join('; '), 'Protocolar a renovação das outorgas.');
        if (lancProb.length) add('EFL-01', 'Efluentes', 'Lançamento outorgado e dentro dos padrões (CONAMA 430/2011)', 'Não conforme', 'Alto', lancProb.map(docO).join('; '), 'Regularizar a outorga de lançamento.');
        else if (lancOk.length) add('EFL-01', 'Efluentes', 'Lançamento outorgado e dentro dos padrões (CONAMA 430/2011)', 'Parcial', 'Médio', lancOk.map(docO).join('; ') + '. Atendimento aos padrões depende de laudos.', 'Solicitar laudos de efluente na frequência da licença.');
        else if (RX_EFL.test(atv)) add('EFL-01', 'Efluentes', 'Destino de efluentes regular (CONAMA 430/2011)', 'Sem evidência', 'Médio', 'Atividade com geração típica de efluente e sem outorga de lançamento do titular.', 'Verificar o destino (rede pública com anuência, fertirrigação licenciada, ETE com lançamento).', 'Hipótese a verificar');
        if (RX_EMI.test(atv)) add('EMI-01', 'Emissões', 'Fontes fixas monitoradas (CONAMA 382/2006 e 436/2011)', 'Sem evidência', 'Médio', 'Atividade com fonte típica de emissão atmosférica.', 'Solicitar laudos de chaminé e condicionantes de monitoramento.', 'Pendente');
        add('CAD-01', 'Cadastros', 'CTF/APP regular e RAPP entregue (IBAMA)', 'Sem evidência', 'Médio', 'Não consta na base pública da plataforma.', 'Consultar o certificado de regularidade no IBAMA pelo CNPJ.', 'Pendente');
        add('RES-01', 'Resíduos', 'PGRS implantado e destinação rastreada (Lei 12.305/2010)', 'Sem evidência', 'Médio', 'Não consta na base pública da plataforma.', 'Solicitar PGRS, MTRs e CDFs de 12 meses.', 'Pendente');
        add('PAS-01', 'Passivos', 'Sem embargos, autos ou TACs pendentes', 'Sem evidência', 'Médio', 'Não consta na base pública da plataforma.', 'Consultar IBAMA (embargos e autos), IAT, TJPR e MPPR.', 'Pendente');
        add('FLO-03', 'Território', 'Fora de unidade de conservação e zona de amortecimento, ou com anuência do gestor; APP preservada', 'Sem evidência', 'Médio', 'Não consta na base pública da plataforma.', 'Cruzar as unidades com UCs, hidrografia (APP) e zoneamento municipal.', 'Pendente');

        const det = M.filter(m => m.natureza !== 'Pendente');
        const pts = det.reduce((s, m) => s + (m.st === 'Conforme' ? 0 : m.risco === 'Alto' ? 3 : m.risco === 'Médio' ? 1 : 0), 0);
        const exposicao = pts >= 6 ? 'Alta' : pts >= 3 ? 'Média' : 'Baixa';
        const SERV = { 'LIC-01': 'Regularização do licenciamento ambiental (enquadramento e requerimento no IAT)', 'LIC-02': 'Renovação de licença com calendário de condicionantes', 'LIC-06': 'Revisão do portfólio de licenças (encerramento ou incorporação de atividades)',
            'AGU-01': 'Outorga de captação no SIGARH (ou declaração de uso insignificante)', 'AGU-04': 'Renovação de outorga', 'EFL-01': 'Regularização de efluentes (outorga de lançamento, anuência ou fertirrigação)', 'EMI-01': 'Plano de monitoramento de emissões' };
        const escopo = det.filter(m => m.st !== 'Conforme' && SERV[m.id]).map(m => ({ id: m.id, servico: m.id === 'EFL-01' && m.st === 'Parcial' ? 'Monitoramento de efluentes (laudos e condicionantes da outorga de lançamento)' : SERV[m.id], risco: m.risco }));
        escopo.push({ id: 'DIAG', servico: 'Diagnóstico Ambiental Empresarial CS – Nível 1 (matriz completa com vistoria e documentos)', risco: '' });
        const docs = ['A. Identificação: contrato social, CNPJ de todas as unidades, responsável ambiental', 'B. Licenciamento: licenças vigentes, condicionantes e comprovantes de atendimento, protocolos de renovação'];
        if (usaAgua || capt.length) docs.push('C. Água: outorgas/dispensas, hidrômetros ou registros de captação, contas de água');
        if (RX_EFL.test(atv) || lanc.length) docs.push('C. Efluentes: projeto e operação da ETE, laudos de efluente, anuência da concessionária');
        docs.push('D. Resíduos: PGRS, MTRs e CDFs de 12 meses, licenças dos destinadores');
        if (RX_EMI.test(atv)) docs.push('E. Emissões: laudos de chaminé, consumo de combustíveis');
        docs.push('H. Riscos: AVCB, PAE, tanques e produtos perigosos', 'I. Passivos: autos de infração, TACs, notificações, processos');

        // entorno imediato da unidade principal (1 km)
        let entorno = null;
        if (U.length) {
            const a = R.area({ tipo: 'circulo', centro: U[0].xy, raio: 1000 });
            const r1 = R.calcular(a, dados.filter(d => R.municipiosDaArea(a, munGeo).includes(d.cod)), munGeo, {});
            entorno = { k: r1.k, achados: r1.achados.filter(x => x.risco).map(x => x.t) };
        }
        const munNomes = [...new Set(lic.concat(out).map(x => x.mun))];
        const base = (dados.find(d => d.cod === ref.cod) || dados[0] || {}).atualizado || '';
        const titular = (lic[0] && lic[0].n) || (out[0] && out[0].nome) || ref.nome;
        const ct = lic.concat(out).map(x => x.ct).find(Boolean) || null;
        const centro = U.length ? U[0].xy : ref0 || [0, 0];
        const dLat = 1000 / KY, dLon = 1000 / KX(centro[1] || -24);
        return {
            tipo: 'empreendimento', versao: VERSAO, emitido: new Date().toLocaleDateString('pt-BR'), base, finalidade: op.finalidade || 'Diagnóstico', cliente: op.cliente || '',
            titular, pf, vinculo, cnpj: op.cnpj || (ct && ct.cnpj) || '', ct: ct ? { rs: ct.rs, nf: ct.nf, cnpj: ct.cnpj, sit: ct.sit, porte: ct.porte, cnae: ct.cnae, end: [ct.end, ct.bai, ct.cep].filter(Boolean).join(' – '), mun: ct.mun, tel: ct.tel, email: ct.email } : null,
            municipios: munNomes, unidades: U, semCoord: sem, lic, out,
            k: { lic: lic.length, lic_vig: vig.length, lic_venc6: v6.length, lic_vencidas: venc.length, out: out.length, out_val: out.filter(x => !/Vencida|Irregular/.test(x.situ)).length, out_prob: out.filter(x => /Vencida|Irregular/.test(x.situ)).length, out_venc6: o6.length, vazao_capt_m3h: Math.round(captOk.reduce((s, x) => s + num(x.vazao), 0) * 10) / 10, unidades: U.length },
            matriz: M, exposicao, pontos: pts, escopo, docs, entorno,
            area: { tipo: 'circulo', centro, raio: 1000, contorno: Array.from({ length: 49 }, (_, i) => { const t = i / 48 * 2 * Math.PI; return [centro[0] + Math.cos(t) * dLon, centro[1] + Math.sin(t) * dLat]; }) }
        };
    };

    // ---------------------------------------------------------------- Raio-X do Empreendimento – documento inicial (padrão visual do Raio-X do imóvel rural)
    const RX_ST = { ok: ['✓', 'Em acordo', 'ok'], at: ['!', 'Atenção', 'at'], no: ['✕', 'Em desacordo', 'no'], pd: ['…', 'Pendente – Fase 2', 'pd'], na: ['–', 'Não se aplica', 'na'] };
    const stDe = m => !m ? 'na' : m.st === 'Conforme' ? 'ok' : m.st === 'Não conforme' ? 'no' : m.natureza === 'Pendente' ? 'pd' : 'at';
    // código de conferência (FNV-1a 48 bits) – mesmo resultado no navegador e no Node
    function codigoConf(obj) {
        const s = JSON.stringify(obj); let h1 = 0x811c9dc5, h2 = 0x01000193;
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0; }
        const h = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase();
        return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
    }
    R.checklistEmpreendimento = function (e) {
        const G = [], m = id => e.matriz.find(x => x.id === id);
        const grupo = nome => { const g = { nome, itens: [] }; G.push(g); return (ind, st, det) => g.itens.push({ ind, st, det: det || '' }); };
        const doM = (add, id, ind) => { const x = m(id); if (x) add(ind || x.req, stDe(x), x.evid); };
        let add = grupo('Licenciamento ambiental');
        doM(add, 'LIC-01', 'Licença ambiental válida para a atividade (IAT – SGA/SIA)');
        doM(add, 'LIC-02', 'Renovação requerida com 120 dias de antecedência');
        if (m('LIC-06')) doM(add, 'LIC-06', 'Licenças antigas encerradas ou incorporadas');
        add = grupo('Recursos hídricos');
        doM(add, 'AGU-01', 'Captação de água outorgada ou dispensada (SIGARH)');
        if (!m('AGU-01')) add('Captação de água outorgada ou dispensada (SIGARH)', 'na', 'Atividade sem uso típico de água e sem outorga de captação do titular');
        const o = e.out, prob = o.filter(x => /Vencida|Irregular/.test(x.situ)), v6 = o.filter(x => x.situ === 'Vence em até 6 meses');
        add('Outorgas do titular vigentes', !o.length ? 'na' : prob.length ? 'no' : v6.length ? 'at' : 'ok',
            o.length ? `${o.length} outorga(s): ${o.length - prob.length} válida(s)${v6.length ? `, ${v6.length} vence(m) em até 6 meses` : ''}${prob.length ? `, ${prob.length} vencida(s) ou irregular(es)` : ''}` : 'Nenhuma outorga do titular localizada');
        add = grupo('Efluentes e emissões atmosféricas');
        doM(add, 'EFL-01', 'Destino de efluentes regular (outorga de lançamento, rede ou fertirrigação)');
        if (!m('EFL-01')) add('Destino de efluentes regular', 'na', 'Atividade sem geração típica de efluente industrial na base pública');
        doM(add, 'EMI-01', 'Fontes fixas de emissão monitoradas');
        if (!m('EMI-01')) add('Fontes fixas de emissão monitoradas', 'na', 'Atividade sem fonte típica de emissão na base pública');
        add = grupo('Cadastros, resíduos e passivos');
        doM(add, 'CAD-01', 'CTF/APP regular e RAPP entregue (IBAMA)');
        doM(add, 'RES-01', 'PGRS implantado e destinação rastreada (MTR/CDF)');
        doM(add, 'PAS-01', 'Sem embargos, autos de infração ou TACs pendentes');
        add = grupo('Território e entorno (1 km)');
        doM(add, 'FLO-03', 'Fora de UC/zona de amortecimento e APP preservada');
        if (e.entorno) {
            const k = e.entorno.k, pr = (k.out_vencidas || 0) + (k.out_irreg || 0);
            add('Outorgas vencidas ou irregulares no entorno', pr ? 'at' : 'ok', `${pr} outorga(s) de terceiros vencida(s)/irregular(es) a até 1 km`);
            add('Pressão sobre a água no entorno', k.vazao_capt_m3h >= 100 ? 'at' : 'ok', `${k.out_val} outorga(s) válida(s), ${String(k.vazao_capt_m3h).replace('.', ',')} m³/h de captação outorgada a até 1 km`);
        } else add('Entorno imediato', 'na', 'Sem unidade georreferenciada para calcular o entorno');
        return G;
    };
    R.pendenciasEmpreendimento = function (e) {
        const P = { Alto: 1, 'Médio': 2, Baixo: 3 }, S = {}; e.escopo.forEach(s => S[s.id] = s.servico);
        const N = e.matriz.filter(m => m.st !== 'Conforme').map(m => ({ prior: m.natureza === 'Pendente' ? 3 : P[m.risco] || 2, fase: m.natureza === 'Pendente' ? 2 : 1, id: m.id, tema: m.tema, achado: m.evid, adequacao: (S[m.id] ? S[m.id] + '. ' : '') + m.acao }));
        N.push({ prior: 3, fase: 2, id: 'VIST', tema: 'Vistoria', achado: 'Análise feita só com bases públicas', adequacao: 'Vistoria técnica e conferência documental (licenças, condicionantes, outorgas, PGRS, laudos) para confirmar os itens acima' });
        return N.sort((a, b) => a.prior - b.prior || a.fase - b.fase);
    };

    R.relatorioEmpreendimentoHTML = function (e, op) {
        op = op || {};
        const G = R.checklistEmpreendimento(e), N = R.pendenciasEmpreendimento(e), todos = G.flatMap(g => g.itens);
        const cont = s => todos.filter(i => i.st === s).length, avaliados = todos.filter(i => i.st !== 'na' && i.st !== 'pd').length;
        const u1 = e.unidades[0], perto = x => x.xy && u1 && dist(x.xy, u1.xy) <= 1500;
        const vista = { area: e.area, lic: e.lic.filter(perto), out: e.out.filter(perto) };
        const mapaPts = R.mapaURL(vista, 900, 520), mapaSat = R.mapaURL({ area: e.area, lic: [], out: [] }, 640, 900, 'satellite-streets-v12');
        const agora = new Date(), dataHora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(',', '');
        const nome = e.titular, mun = e.municipios[0] || (u1 && u1.mun) || '–';
        const codigo = codigoConf({ t: nome, b: e.base, k: e.k, m: e.matriz.map(m => [m.id, m.st]), d: agora.toISOString().slice(0, 10) });
        const link = op.link || '';
        const qr = px => { try { const Q = (op.qrcode || (typeof qrcode !== 'undefined' ? qrcode : null)); if (!Q || !link) return ''; const q = Q(0, 'M'); q.addData(link); q.make(); return q.createSvgTag({ cellSize: Math.max(2, Math.round(px / (q.getModuleCount() + 8))), margin: 4, scalable: true }); } catch (er) { return ''; } };
        const F = n => Number(n || 0).toLocaleString('pt-BR');
        const card = (rot, val, sub, cls) => { const t = String(val).replace(/<[^>]+>/g, ''), tam = t.length > 34 ? 'xs' : t.length > 20 ? 'sm' : ''; return `<div class="cd ${cls || ''}"><span>${rot}</span><b class="${tam}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; };
        const selo = st => `<span class="selo ${RX_ST[st][2]}">${RX_ST[st][0]} ${RX_ST[st][1]}</span>`;
        const sec = (titulo, sub, corpo, quebra) => `<section class="${quebra === false ? '' : 'pg'}"><div class="st"><i></i><div><h2>${titulo}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>${corpo}</section>`;
        const ROT = { 1: ['Alta', '#c62828'], 2: ['Média', '#ef6c00'], 3: ['Baixa / verificar', '#558b2f'] };
        const venc = v => { const d = dataBR(v); if (!v) return '–'; if (!d) return esc(v); const dias = (d - agora) / 864e5;
            return dias < 0 ? `<b style="color:#c62828">${esc(v)}<br>vencida</b>` : dias <= 180 ? `<b style="color:#e65100">${esc(v)}<br>vence em ${Math.ceil(dias)} dias</b>` : esc(v); };
        const tab = (cab, linhas, vazio) => linhas.length ? `<table class="rx-tab"><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>` : `<p class="hint">${vazio || 'Nada encontrado.'}</p>`;
        const tl = tab(['Nº', 'Unid.', 'Atividade', 'Modalidade e nº do documento', 'Emissão', 'Validade'], e.lic.map((x, i) => [`<b>${i + 1}</b>`, esc(unid(e, x)),
            `${esc(x.a)}${x.e && x.e !== x.a ? `<br><span class="hint">${esc(x.e)}</span>` : ''}${x.oc ? `<br><span class="hint">💧 ${esc(x.oc)}</span>` : ''}<br><span class="hint">${esc(x.mun)}</span>`,
            `${esc(x.s)}<br><span class="mono">nº ${esc(x.d || '–')}</span><br><a href="${linkSGA(x)}" target="_blank" rel="noopener">consulta no SGA ↗</a>`, esc(x.em || '–'), x.si === 'Vencida' ? `<b style="color:#c62828">${esc(x.va || '–')}<br>vencida</b>` : venc(x.va)]), 'Nenhuma licença do titular localizada na base pública.');
        const to = tab(['Nº', 'Unid.', 'Tipo / finalidade', 'Nº da outorga / declaração', 'Vazão (m³/h)', 'Corpo hídrico / bacia', 'Vencimento'], e.out.map((x, i) => [`<b>${i + 1}</b>`, esc(unid(e, x)),
            `${esc(x.interf || x.tipo)}${x.fin ? `<br><span class="hint">${esc(x.fin)}</span>` : ''}`, `<span class="mono">${esc(x.num || '–')}</span><br><span class="hint">${esc(x.doc || '')}${x.situ ? ' · ' + esc(x.situ) : ''}</span>`,
            esc(x.vazao || '–'), `${esc(x.corpo || '–')}<br><span class="hint">${esc(x.bacia || '')}</span>`, /Irregular/.test(x.situ) ? '<b style="color:#c62828">irregular</b>' : venc(x.venc)]), 'Nenhuma outorga do titular localizada na base pública.');
        const tu = tab(['Unidade', 'Município', 'Coordenadas (lat, long – SIRGAS 2000)', 'Licenças', 'Outorgas', 'Atividades vigentes'], e.unidades.map(u => [`<b>${u.id}</b>${u.dm != null ? `<br><span class="hint">${F(u.dm)} m do ponto consultado</span>` : ''}`, esc(u.mun),
            `<span class="mono">${u.xy[1].toFixed(5)}, ${u.xy[0].toFixed(5)}</span><br><a href="https://www.google.com/maps?q=${u.xy[1].toFixed(6)},${u.xy[0].toFixed(6)}" target="_blank" rel="noopener">ver no Google Maps ↗</a>`, u.lic, u.out, `<span class="hint">${esc(u.ativ.slice(0, 3).join('; ') || '–')}</span>`]), 'Nenhum registro do titular com coordenada.');
        const PF = e.pf;
        const contato = op.contatos && e.ct ? [e.ct.tel, e.ct.email].filter(Boolean).join(' · ') : '';
        const corExp = { Alta: '#c62828', 'Média': '#ef6c00', Baixa: '#2e7d32' }[e.exposicao];
        const fin = { 'Prospecção': 'Uso interno CS – prospecção', 'Diagnóstico': 'Análise técnica CS', 'Entrega': 'Entrega ao cliente' }[e.finalidade] || e.finalidade;
        const logo = esc(op.logo || 'logo.png');
        const blocoCS = `<div class="csb"><img src="${logo}" alt="CS Consultoria Ambiental"><div><b>CS Consultoria Ambiental</b><br><span>Diagnóstico Ambiental Empresarial · licenciamento, outorgas, resíduos, efluentes e ESG · Londrina/PR</span></div></div>`;
        return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Raio-X do Empreendimento – ${esc(nome)}</title>
<style>
 @page { size: A4; margin: 22mm 14mm 20mm;
   @top-left { content: "CS Consultoria Ambiental  ·  RAIO-X DO EMPREENDIMENTO"; font: 600 8pt Arial; color: #1f4933; }
   @top-right { content: "${esc(dataHora)}   ·   Página " counter(page) " de " counter(pages); font: 8pt Arial; color: #5f6d66; }
   @bottom-left { content: "Código de conferência ${codigo}"; font: 8pt Consolas, monospace; color: #5f6d66; }
   @bottom-right { content: "Fase 1 – análise automática sobre bases públicas – não substitui vistoria"; font: 7.5pt Arial; color: #8a978f; } }
 @page :first { margin: 0; @top-left { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-right { content: none } }
 * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1d2a24; margin: 0; font-size: 10.5pt; line-height: 1.45; background: #e9eeeb; }
 .folha { max-width: 210mm; margin: 0 auto; background: #fff; }
 section, .capa { position: relative; z-index: 1; }
 .pg { break-before: page; padding: 6mm 0 0; }
 @media screen { .pg { padding: 14mm 14mm 8mm; border-top: 10px solid #e9eeeb; } }
 .capa { height: 297mm; color: #fff; display: flex; flex-direction: column; padding: 18mm 16mm 14mm; overflow: hidden;
   background: linear-gradient(160deg, rgba(20,46,32,.93), rgba(31,73,51,.80) 55%, rgba(20,46,32,.96)), url("${esc(mapaSat.url)}") center/cover, #1f4933; }
 .capa .topo { display: flex; justify-content: space-between; align-items: center; } .capa .topo img { height: 52px; background: #fff; border-radius: 10px; padding: 6px 10px; }
 .capa .data { background: rgba(0,0,0,.35); border-radius: 999px; padding: 6px 14px; font-size: 10pt; }
 .capa .meio { margin-top: auto; margin-bottom: auto; } .capa .kick { letter-spacing: .3em; font-size: 9.5pt; font-weight: 700; color: #83bb4e; }
 .capa h1 { font-size: 46pt; line-height: 1; margin: 8px 0 6px; font-weight: 800; } .capa h1 span { color: #83bb4e; display: block; }
 .capa .sub { font-size: 13pt; opacity: .9; } .capa .tit { font-size: 15pt; font-weight: 700; margin-top: 14px; }
 .capa .faixa { display: grid; grid-template-columns: 0.9fr 2.4fr 1fr auto; gap: 14px; align-items: center; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.25); border-radius: 14px; padding: 12px 16px; }
 .capa .faixa span { display: block; font-size: 8pt; opacity: .75; text-transform: uppercase; letter-spacing: .08em; } .capa .faixa b { font-size: 10.5pt; overflow-wrap: anywhere; } .capa .faixa b.mono { font-size: 9pt; }
 .capa .qr { background: #fff; border-radius: 8px; padding: 4px; width: 92px; height: 92px; } .capa .qr svg { width: 100%; height: 100%; } .capa .qr:empty { display: none; }
 .capa .fase { display: inline-block; margin-top: 12px; background: #83bb4e; color: #10261a; font-weight: 700; border-radius: 999px; padding: 5px 14px; font-size: 9.5pt; }
 .st { display: flex; gap: 10px; align-items: center; margin: 0 0 10px; } .st i { width: 6px; height: 34px; border-radius: 3px; background: linear-gradient(#83bb4e, #1f4933); }
 .st h2 { margin: 0; font-size: 15pt; color: #1f4933; } .st p { margin: 0; color: #5f6d66; font-size: 9pt; }
 h4 { margin: 14px 0 6px; font-size: 10.5pt; color: #1f4933; }
 .cds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 6px 0 10px; }
 .cd { border: 1px solid #dfe8e2; border-radius: 10px; padding: 8px 10px; background: #fafcfb; min-width: 0; } .cd span { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7a72; }
 .cd b { display: block; font-size: 12.5pt; line-height: 1.25; margin-top: 3px; overflow-wrap: break-word; } .cd b.sm { font-size: 11pt; } .cd b.xs { font-size: 9.5pt; } .cd small { display: block; color: #6b7a72; font-size: 8.5pt; margin-top: 2px; }
 .cd.l2 { grid-column: span 2; } .cd.l3 { grid-column: span 3; } .cds.n4 { grid-template-columns: repeat(4, 1fr); } .cds.n4 .cd b { font-size: 16pt; color: #1f4933; }
 .placar { display: grid; grid-template-columns: 1.2fr repeat(4, 1fr); gap: 8px; margin: 6px 0 12px; }
 .placar div { border-radius: 10px; padding: 10px; text-align: center; } .placar b { display: block; font-size: 20pt; } .placar span { font-size: 8.5pt; }
 .placar .g { background: #1f4933; color: #fff; } .placar .ok { background: #e7f5ec; color: #1b6b3a; } .placar .at { background: #fff6dd; color: #8a5a00; } .placar .no { background: #fdecea; color: #b71c1c; } .placar .pd { background: #e8eef7; color: #2b4f86; }
 .ck { width: 100%; border-collapse: collapse; margin-bottom: 10px; } .ck caption { background: #eef6e6; color: #1f4933; font-weight: 700; font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; padding: 6px; border-radius: 6px; text-align: left; }
 .ck th { font-size: 7.5pt; color: #6b7a72; text-align: left; text-transform: uppercase; letter-spacing: .06em; padding: 6px 4px; border-bottom: 1px solid #dfe8e2; } .ck th:last-child, .ck td:last-child { text-align: right; width: 150px; }
 .ck td { padding: 7px 4px; border-bottom: 1px solid #eef2ef; vertical-align: top; } .ck tr { break-inside: avoid; }
 .ck .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; } .ck .det { display: block; color: #5f6d66; font-size: 8.5pt; margin: 3px 0 0 16px; }
 .selo { display: inline-block; font-size: 8pt; font-weight: 700; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
 .selo.ok { background: #e7f5ec; color: #1b6b3a; } .selo.at { background: #fff3d6; color: #8a5a00; } .selo.no { background: #fdecea; color: #b71c1c; } .selo.pd { background: #e8eef7; color: #2b4f86; } .selo.na { background: #eef1ef; color: #7b8781; }
 .dot.ok { background: #2e7d32; } .dot.at { background: #f9a825; } .dot.no { background: #c62828; } .dot.pd { background: #5c85c4; } .dot.na { background: #b0bab4; }
 img.mapa { width: 100%; border-radius: 10px; border: 1px solid #cfd8d3; margin: 4px 0 2px; } .leg { font-size: 8pt; color: #5f6d66; margin-bottom: 6px; }
 .leg i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 3px -1px 8px; }
 table.rx-tab { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 6px; } .rx-tab th { background: #1d2a24; color: #fff; text-align: left; padding: 6px; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; }
 .rx-tab td { border-bottom: 1px solid #e5ebe7; padding: 5px 6px; vertical-align: top; } .rx-tab tr { break-inside: avoid; }
 .rx-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
 .mono { font-family: Consolas, monospace; font-size: 8.5pt; } .hint { color: #5f6d66; font-size: 8.5pt; } a { color: #1f4933; }
 .obs { border: 1px solid #dfe8e2; border-left: 4px solid #83bb4e; border-radius: 8px; padding: 8px 10px; margin: 6px 0; font-size: 9pt; background: #fafcfb; }
 .exp { border-radius: 10px; padding: 10px 12px; margin: 6px 0 10px; color: #fff; display: flex; justify-content: space-between; align-items: center; } .exp b { font-size: 15pt; } .exp span { font-size: 9pt; opacity: .9; max-width: 72%; }
 .fonte { display: grid; grid-template-columns: 30% 1fr; gap: 4px 12px; font-size: 9pt; } .fonte b { color: #1f4933; }
 .doc { columns: 2; font-size: 9pt; margin: 4px 0 8px; padding-left: 18px; } .doc li { break-inside: avoid; margin-bottom: 3px; }
 .valida { display: flex; gap: 14px; align-items: center; border: 1px solid #dfe8e2; border-radius: 10px; padding: 10px; margin-top: 12px; } .valida .qr { width: 96px; height: 96px; } .valida .qr svg { width: 100%; height: 100%; } .valida .qr:empty { display: none; }
 .csb { display: flex; gap: 14px; align-items: center; border-top: 3px solid #83bb4e; margin-top: 14px; padding-top: 10px; font-size: 9pt; color: #1f4933; } .csb img { height: 46px; } .csb span { color: #5f6d66; }
 .interno { background: #fdecea; color: #b71c1c; font-weight: 700; text-align: center; border-radius: 8px; padding: 6px; margin: 0 0 8px; font-size: 9pt; }
 .noprint { text-align: center; padding: 14px; } .noprint button { padding: 10px 20px; font-size: 14px; background: #1f4933; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
 @media print { body { background: #fff; } .noprint { display: none; } h4 { break-after: avoid; } img.mapa { break-inside: avoid; max-height: 125mm; object-fit: cover; } }
</style></head><body>
${op.botaoImprimir === false ? '' : '<p class="noprint"><button onclick="window.print()">Salvar em PDF / imprimir</button> <span class="hint">Use "Salvar como PDF", papel A4, com "Gráficos de fundo" ligado.</span></p>'}
<div class="folha">
<div class="capa">
  <div class="topo"><img src="${logo}" alt="CS Consultoria Ambiental"><span class="data">${esc(dataHora)}</span></div>
  <div class="meio"><div class="kick">DIAGNÓSTICO AMBIENTAL EMPRESARIAL · CONSULTA AUTOMÁTICA</div><h1>Raio-X do<span>Empreendimento</span></h1>
    <div class="sub">Consulta automática a ${todos.length} indicadores em bases públicas oficiais<br><b>${esc(e.municipios.join(', ') || mun)}</b></div>
    <div class="tit">${esc(nome)}</div><span class="fase">FASE 1 · DADOS PÚBLICOS</span></div>
  <div class="faixa"><div><span>Emitido por</span><b>CS Consultoria Ambiental</b></div><div><span>${PF ? 'Titular' : 'Titular · CNPJ'}</span><b>${esc(nome)}</b>${!PF && e.cnpj ? `<br><b class="mono">${esc(e.cnpj)}</b>` : ''}</div>
    <div><span>Unidades · finalidade</span><b>${e.k.unidades} unidade(s)</b><br><b style="font-size:9pt">${esc(fin)}</b></div><div class="qr">${qr(92)}</div></div>
</div>

${sec('Detalhes do empreendimento', 'Identificação, cadastro e localização da unidade principal', `
  ${e.finalidade === 'Prospecção' ? '<div class="interno">DOCUMENTO DE USO INTERNO – contém contatos</div>' : ''}
  <div class="cds">${card('Titular', esc(nome), '', 'l2')}${card(PF ? 'Tipo' : 'CNPJ', PF ? 'Pessoa física' : `<span class="mono">${esc(e.cnpj || 'não identificado')}</span>`)}
  ${e.ct && e.ct.nf ? card('Nome fantasia', esc(e.ct.nf)) : ''}${e.ct && e.ct.cnae ? card('Atividade principal (CNAE)', esc(e.ct.cnae), '', 'l2') : ''}
  ${e.ct && (e.ct.porte || e.ct.sit) ? card('Porte · situação na Receita', esc([e.ct.porte, e.ct.sit].filter(Boolean).join(' · '))) : ''}
  ${!PF && e.ct && e.ct.end ? card('Endereço (Receita Federal)', esc(e.ct.end), '', 'l2') : ''}${contato ? card('Contato (uso interno)', esc(contato), '', 'l3') : ''}
  ${card('Município(s)', esc(e.municipios.join(', ') || '–'))}${card('Unidade principal', u1 ? `${u1.id} · ${esc(u1.mun)}` : '–', u1 ? `<span class="mono">${u1.xy[1].toFixed(5)}, ${u1.xy[0].toFixed(5)}</span>` : '')}
  ${card('Base de dados', esc(e.base || '–'), `motor Raio-X v${e.versao}`)}${card('Vínculo dos registros', esc(e.vinculo), '', 'l3')}</div>
  ${u1 ? `<img class="mapa" src="${esc(mapaPts.url)}" alt="Localização da unidade principal" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div style="display:none">${R.croquiSVG(vista)}</div>
  <div class="leg">Círculo vermelho: 1 km em torno da unidade principal.<i style="background:#2e7d32"></i>licença vigente<i style="background:#e65100"></i>vence em 6 meses / água sem outorga<i style="background:#9e9e9e"></i>licença vencida<i style="background:#0277bd"></i>outorga válida<i style="background:#c62828"></i>outorga vencida/irregular</div>` : '<p class="hint">Sem registro do titular com coordenada – localização a confirmar com o cliente.</p>'}`)}

${sec('Resultado da análise', 'Resumo dos indicadores consultados', `
  <div class="placar"><div class="g"><b>${cont('ok')}/${avaliados}</b><span>indicadores verificáveis em acordo</span></div><div class="ok"><b>${cont('ok')}</b><span>✓ em acordo</span></div><div class="at"><b>${cont('at')}</b><span>! atenção</span></div><div class="no"><b>${cont('no')}</b><span>✕ em desacordo</span></div><div class="pd"><b>${cont('pd')}</b><span>… pendentes – Fase 2</span></div></div>
  <div class="exp" style="background:${corExp}"><b>Exposição preliminar: ${esc(e.exposicao)}</b><span>Calculada só com os requisitos verificáveis na base pública (${e.matriz.filter(m => m.natureza !== 'Pendente').length} de ${e.matriz.length}). Os pendentes entram na Fase 2, com documentos e vistoria.</span></div>
  <div class="cds n4">${card('Licenças vigentes', F(e.k.lic_vig), `${F(e.k.lic_venc6)} vencem em até 6 meses`)}${card('Licenças vencidas', F(e.k.lic_vencidas), 'sem renovação registrada')}${card('Outorgas válidas', F(e.k.out_val), `${F(e.k.out_prob)} vencidas ou irregulares`)}${card('Captação outorgada', F(e.k.vazao_capt_m3h), 'm³/h')}</div>
  ${G.map(g => `<table class="ck"><caption>${g.nome}</caption><tr><th>Indicador</th><th>Status</th></tr>${g.itens.map(i => `<tr><td><span class="dot ${RX_ST[i.st][2]}"></span>${esc(i.ind)}${i.det ? `<span class="det">${esc(i.det)}</span>` : ''}</td><td>${selo(i.st)}</td></tr>`).join('')}</table>`).join('')}`)}

${sec('Licenciamento ambiental', `Licenças do titular no IAT (SGA/SIA) – ${F(e.lic.length)} registro(s)`, tl)}

${sec('Recursos hídricos', `Outorgas e declarações do titular no SIGARH – ${F(e.out.length)} registro(s)`, to, e.lic.length + e.out.length > 14)}

${sec('Unidades e entorno', 'Unidades físicas do titular e situação no raio de 1 km da unidade principal', `
  ${tu}${e.semCoord.lic + e.semCoord.out ? `<p class="hint">${e.semCoord.lic} licença(s) e ${e.semCoord.out} outorga(s) do titular sem coordenada no IAT não entram no mapa.</p>` : ''}
  ${e.entorno ? `<h4>Entorno imediato (1 km, todos os titulares)</h4><div class="cds n4">${card('Licenças vigentes', F(e.entorno.k.lic_vig))}${card('Outorgas válidas', F(e.entorno.k.out_val))}${card('Captação outorgada', F(e.entorno.k.vazao_capt_m3h), 'm³/h')}${card('Outorgas vencidas/irregulares', F((e.entorno.k.out_vencidas || 0) + (e.entorno.k.out_irreg || 0)))}</div>
  ${e.entorno.achados.length ? e.entorno.achados.slice(0, 5).map(t => `<div class="obs">${esc(t)}</div>`).join('') : ''}` : ''}`)}

${sec('Pendências e adequações sugeridas', 'Base para o plano de adequação, o escopo da Fase 2 e o orçamento', `
  <div class="placar" style="grid-template-columns:repeat(3,1fr) 1.2fr">${[1, 2, 3].map(k => `<div style="background:${ROT[k][1]}1a;color:${ROT[k][1]}"><b>${N.filter(n => n.prior === k).length}</b><span>prioridade ${ROT[k][0].toLowerCase()}</span></div>`).join('')}<div class="g"><b>${N.length}</b><span>itens no total</span></div></div>
  <table class="rx-tab"><tr><th>Nº</th><th>Prioridade</th><th>Tema</th><th>Situação encontrada</th><th>Adequação / serviço sugerido</th></tr>
  ${N.map((n, i) => `<tr><td><b>${i + 1}</b><br><span class="hint">${esc(n.id)}</span></td><td><span class="rx-sw" style="background:${ROT[n.prior][1]}"></span>${ROT[n.prior][0]}${n.fase === 2 ? '<br><span class="hint">Fase 2</span>' : ''}</td><td>${esc(n.tema)}</td><td>${esc(n.achado)}</td><td>${esc(n.adequacao)}</td></tr>`).join('')}</table>
  <p class="hint">Lista indicativa. Itens marcados como Fase 2 dependem de documentos do cliente e de vistoria técnica.</p>
  <h4>Documentos a solicitar para a Fase 2</h4><ul class="doc">${e.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
  <div class="obs"><b>Próximo passo com a CS:</b> Fase 2 – Diagnóstico Ambiental Empresarial completo (matriz CS Nível 1, com documentos, condicionantes das licenças e vistoria), índice ICMA e plano de ação 5W2H priorizado, unificado com esta Fase 1.</div>${blocoCS}`)}

${sec('Metodologia e fontes', 'Como esta análise foi feita', `
  <p>Os registros públicos do titular são reunidos por ${esc(e.vinculo)} e agrupados em unidades físicas (pontos a até 500 m entre si). Cada indicador segue os mesmos IDs da matriz do Diagnóstico Ambiental Empresarial CS, para que a Fase 2 parta deste resultado. Pontos usam as coordenadas declaradas pelos titulares ao IAT e podem conter erros.</p>
  <div class="fonte">
   <b>IAT – SGA/SIA</b><span>Licenças ambientais: modalidade, número, atividade, emissão e validade; consulta pública do processo.</span>
   <b>IAT – SIGARH</b><span>Outorgas e declarações de uso da água: tipo, número, vazão, corpo hídrico, bacia e vencimento.</span>
   <b>IAT / GeoPR</b><span>Camadas geográficas de licenciamento e outorgas, consolidadas pela plataforma Licenças e Outorgas do Paraná (CS).</span>
   <b>IBGE</b><span>Limites municipais.</span>
   ${e.ct ? '<b>Receita Federal (CNPJ)</b><span>Razão social, CNAE, porte e endereço, quando disponíveis na Área CS.</span>' : ''}
   <b>Legislação de referência</b><span>LC 140/2011; CONAMA 237/1997, 430/2011, 382/2006 e 436/2011; Lei 9.433/1997; Lei 12.305/2010; Lei 6.938/1981 (CTF/APP).</span>
  </div>
  <p class="hint">Legenda dos selos: <b>Em acordo</b> – situação regular na base pública; <b>Atenção</b> – item a verificar ou que pode exigir adequação; <b>Em desacordo</b> – pendência identificada; <b>Pendente – Fase 2</b> – não verificável em base pública, depende de documento ou vistoria; <b>Não se aplica</b> – sem indício da obrigação para a atividade.</p>
  <p class="hint">Limitações: homônimos ou razões sociais diferentes da mesma empresa podem ficar de fora ou entrar indevidamente; licenças sem coordenada, dispensadas ou de competência municipal podem não aparecer. Este Raio-X não substitui vistoria, análise documental, consulta a restrições territoriais (UC, APP, terras indígenas) nem o diagnóstico completo.${PF ? ' Titular pessoa física: CPF e endereço não são exibidos.' : ''}</p>
  <div class="valida"><div class="qr">${qr(96)}</div><div><b>Conferência do relatório</b><br><span class="mono">${codigo}</span><br><span class="hint">${link ? 'Aponte a câmera para o QR code para abrir este empreendimento na plataforma.' : 'Gerado pelo agente CS a partir da base pública da plataforma.'} Base de ${esc(e.base)} · emitido em ${esc(dataHora)}.</span></div></div>
  ${blocoCS}`)}
</div></body></html>`;
    };
    // Pré-preenchimento da Matriz de Diagnóstico Técnico CS (planilha) a partir do Raio X do Empreendimento
    R.preenchimentoMatriz = function (e) {
        const ST = { 'Conforme': 'Conforme', 'Parcial': 'Parcial', 'Não conforme': 'Não conforme', 'Verificar': 'Sem evidência', 'Sem evidência': 'Sem evidência' };
        const P = { 'Conforme': null, 'Parcial': 3, 'Não conforme': 4, 'Verificar': 3, 'Sem evidência': 3 };
        const linhas = e.matriz.filter(m => m.natureza !== 'Pendente').map(m => ({ id: m.id, status: ST[m.st] || '', p: P[m.st] ?? null, fonte: 'Base pública (Raio X)', evidencia: `[Raio X ${e.base}] ${m.evid}` }));
        const pend = e.matriz.filter(m => m.natureza === 'Pendente').map(m => ({ id: m.id, nota: `[Raio X] Pendente: ${m.acao}` }));
        const u = e.unidades[0];
        return { linhas, pendentes: pend, identificacao: {
            'Cliente (razão social)': e.titular, 'CNPJ': e.cnpj || '', 'Nome fantasia': (e.ct && e.ct.nf) || '', 'Atividade principal (CNAE)': (e.ct && e.ct.cnae) || '', 'Porte': (e.ct && e.ct.porte) || '',
            'Unidade avaliada': u ? `${u.id} – ${u.mun}` : '', 'Município': e.municipios.join(', '), 'Coordenadas (lat, lon)': u ? `${u.xy[1].toFixed(5)}, ${u.xy[0].toFixed(5)}` : '',
            'Licenças e outorgas principais': e.lic.filter(x => x.si !== 'Vencida').slice(0, 6).map(x => `${x.s} ${x.d} (${x.a}) até ${x.va}`).concat(e.out.filter(x => !/Vencida|Irregular/.test(x.situ)).slice(0, 4).map(x => `${x.num} – ${x.interf || x.tipo}`)).join('; '),
            'Raio X do empreendimento (data da base e exposição preliminar)': `Base de ${e.base}; exposição preliminar ${e.exposicao}; ${e.k.unidades} unidade(s), ${e.k.lic_vig} licenças vigentes, ${e.k.out_val} outorgas válidas` } };
    };
    const unid = (e, x) => x._u || (x.xy ? '—' : 's/ coord.');
    R.csvEmpreendimento = function (e) {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const L = [['Tipo', 'Unidade', 'Município', 'Titular', 'Atividade / tipo', 'Documento', 'Nº', 'Emissão / publicação', 'Validade / vencimento', 'Situação', 'Vazão (m³/h)', 'Observação', 'Longitude', 'Latitude']];
        e.lic.forEach(x => L.push(['Licença', unid(e, x), x.mun, x.n, x.a + (x.e && x.e !== x.a ? ' – ' + x.e : ''), x.s, x.d, x.em, x.va, x.si, '', x.oc || '', x.xy ? x.xy[0] : '', x.xy ? x.xy[1] : '']));
        e.out.forEach(x => L.push(['Outorga', unid(e, x), x.mun, x.nome, x.interf || x.tipo, x.doc, x.num, x.pub, x.venc, x.situ, x.vazao, x.fin || '', x.xy ? x.xy[0] : '', x.xy ? x.xy[1] : '']));
        L.push([]); L.push(['Matriz', 'ID', 'Requisito', 'Status', 'Risco', 'Evidência', 'Ação']);
        e.matriz.forEach(m => L.push(['Matriz', m.id, m.req, m.st, m.risco, m.evid, m.acao]));
        return '﻿' + L.map(l => l.map(v => q(String(v).replace(/^(-?\d+)\.(\d+)$/, '$1,$2'))).join(';')).join('\r\n');
    };

    R.VERSAO = VERSAO;
    if (typeof module !== 'undefined' && module.exports) module.exports = R; else raiz.RaioX = R;
})(typeof window !== 'undefined' ? window : globalThis);
