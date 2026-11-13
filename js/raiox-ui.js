// Raio X da área – interface no mapa (usa o motor js/raiox.js e as funções de app.js)
(function () {
    'use strict';
    const el = document.getElementById('raiox'), btn = document.getElementById('btnRaioX');
    let area = null, resultado = null, kml = null;
    window.modoRaioX = false;

    const vazioFC = { type: 'FeatureCollection', features: [] };
    function camadas() {
        if (map.getSource('rx-area')) return;
        map.addSource('rx-area', { type: 'geojson', data: vazioFC });
        map.addLayer({ id: 'rx-fill', type: 'fill', source: 'rx-area', paint: { 'fill-color': '#c62828', 'fill-opacity': 0.07 } });
        map.addLayer({ id: 'rx-linha', type: 'line', source: 'rx-area', paint: { 'line-color': '#c62828', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
    }
    function desenharArea(a) {
        camadas();
        map.getSource('rx-area').setData(a ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: a.tipo === 'circulo' ? [a.contorno] : a.aneis } }] } : vazioFC);
    }

    function abrir() {
        window.modoRaioX = true; btn.classList.add('on');
        ['estado', 'municipio', 'resultados'].forEach(i => document.getElementById(i).hidden = true);
        el.hidden = false; map.getCanvas().style.cursor = 'crosshair';
        formulario();
    }
    function fechar() {
        window.modoRaioX = false; btn.classList.remove('on'); el.hidden = true; map.getCanvas().style.cursor = '';
        desenharArea(null); area = resultado = null;
        document.getElementById(munSel ? 'municipio' : 'estado').hidden = false;
    }
    btn.onclick = () => window.modoRaioX ? fechar() : abrir();

    function formulario() {
        const interno = !!CHAVE;
        el.innerHTML = `<button class="voltar" id="rxFechar">← sair do Raio X</button><h2>🎯 Raio X da área</h2>
        <p class="dica">Clique no mapa para marcar o centro, digite coordenadas ou carregue um KML. O relatório reúne as licenças e outorgas da área, os pontos de atenção e os achados.</p>
        <div class="rxform">
          <label class="rot">Raio</label>
          <select id="rxRaio">${[500, 1000, 2000, 3000, 5000, 10000].map(v => `<option value="${v}" ${v === 2000 ? 'selected' : ''}>${v >= 1000 ? v / 1000 + ' km' : v + ' m'}</option>`).join('')}</select>
          <label class="rot">Coordenadas do centro (lat, lon)</label>
          <div class="lin"><input id="rxCoord" placeholder="-23.3045, -51.1696"><button id="rxUsar" type="button">Usar</button></div>
          <label class="rot">Ou polígono (KML) + entorno</label>
          <div class="lin"><input type="file" id="rxKml" accept=".kml"><select id="rxEntorno"><option value="0">só o polígono</option><option value="500">+500 m</option><option value="1000" selected>+1 km</option><option value="2000">+2 km</option></select></div>
          <label class="rot">Finalidade</label>
          <select id="rxFin"><option value="Diagnóstico">Diagnóstico técnico (Ficha de Inteligência Prévia)</option><option value="Entrega">Entrega ao cliente (nomes de PF omitidos)</option>${interno ? '<option value="Prospecção">Prospecção comercial (uso interno, com contatos)</option>' : ''}</select>
          <label class="rot">Cliente / referência (opcional)</label>
          <input id="rxCli" placeholder="Ex.: Fazenda Santa Rita – sede">
          ${interno ? '' : '<p class="rot">Para prospecção com contatos, entre na 🔒 Área CS.</p>'}
        </div>
        <div id="rxRes"></div>`;
        document.getElementById('rxFechar').onclick = fechar;
        document.getElementById('rxUsar').onclick = () => {
            const m = document.getElementById('rxCoord').value.match(/-?\d+(?:[.,]\d+)?/g);
            if (!m || m.length < 2) return alert('Digite latitude e longitude, ex.: -23.3045, -51.1696');
            let [a, b] = m.slice(0, 2).map(v => +v.replace(',', '.'));
            if (a < -40) [a, b] = [b, a];   // aceita lon, lat
            kml = null; centro([b, a]);
        };
        document.getElementById('rxRaio').onchange = () => { if (area && area.tipo === 'circulo') centro(area.centro); };
        document.getElementById('rxEntorno').onchange = () => { if (kml) poligono(); };
        document.getElementById('rxFin').onchange = () => { if (resultado) calcular(); };
        document.getElementById('rxKml').onchange = async e => {
            const f = e.target.files[0]; if (!f) return;
            const k = RaioX.lerKML(await f.text());
            if (!k.aneis.length) return alert('Não encontrei polígono neste KML.');
            kml = k; poligono();
        };
    }

    function centro(c) {
        area = RaioX.area({ tipo: 'circulo', centro: c, raio: +document.getElementById('rxRaio').value });
        desenharArea(area);
        map.fitBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]], { padding: 40 });
        calcular();
    }
    function poligono() {
        area = RaioX.area({ tipo: 'poligono', aneis: kml.aneis, entorno: +document.getElementById('rxEntorno').value, nome: kml.nome });
        desenharArea(area);
        map.fitBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]], { padding: 40 });
        calcular();
    }
    map.on('click', e => { if (window.modoRaioX && !e.originalEvent._rx) { kml = null; centro([e.lngLat.lng, e.lngLat.lat]); } });

    async function calcular() {
        const box = document.getElementById('rxRes'); if (!box) return;
        box.innerHTML = '<p class="dica">Calculando…</p>';
        const fin = document.getElementById('rxFin').value;
        const op = { finalidade: fin, cliente: document.getElementById('rxCli').value.trim(), anonimizar: fin === 'Entrega', contatos: fin === 'Prospecção' && !!CHAVE,
            titulo: 'Raio X Ambiental da Área', logo: new URL('logo.png', location.href).href, botaoImprimir: true };
        const cods = RaioX.municipiosDaArea(area, MUNS);
        if (!cods.length) { box.innerHTML = '<p class="dica">A área está fora do Paraná.</p>'; return; }
        const dados = await Promise.all(cods.map(c => carregarMun(c)));
        resultado = RaioX.calcular(area, dados, MUNS, op);
        if (op.contatos) {
            const C = {}; await Promise.all(cods.map(async c => C[c] = await contatosMun(c)));
            const pega = (cod, t, ch) => { const d = C[cod]; const i = d && (d[t] || {})[ch]; return i && i.length ? d.r[i[0]] : null; };
            resultado.lic.forEach(x => x.ct = pega(x.cod, 'l', x.p)); resultado.out.forEach(x => x.ct = pega(x.cod, 'o', x.num));
        }
        const k = resultado.k;
        const kp = (v, t, c) => `<div class="kpi ${c || ''}"><b>${fmt(v)}</b><span>${t}</span></div>`;
        const aten = resultado.lic.filter(x => x.si === 'Vence em até 6 meses' || /Não localizada/.test(x.oc || '')).map(x => ({ x, t: 'l' }))
            .concat(resultado.out.filter(x => x.situ !== 'Válida').map(x => ({ x, t: 'o' }))).sort((a, b) => a.x.dm - b.x.dm);
        box.innerHTML = `<h3>${resultado.area.tipo === 'circulo' ? `Raio de ${fmt(resultado.area.raio)} m` : `Polígono ${esc(resultado.area.nome || '')}`} · ${fmt(resultado.area.ha)} ha</h3>
            <p class="rot">${esc(resultado.municipios.join(', ') || 'sem registros')} · base de ${esc(resultado.base)}</p>
            <div class="kpis">${kp(k.lic_vig, 'licenças vigentes')}${kp(k.lic_venc6, 'licenças vencem em até 6 meses', 'atencao')}${kp(k.lic_vencidas, 'licenças vencidas sem renovação', 'alerta')}${kp(k.lic_agua_sem, 'uso de água sem outorga próxima', 'atencao')}
            ${kp(k.out_val, 'outorgas válidas')}${kp(k.out_venc6, 'outorgas vencem em até 6 meses', 'atencao')}${kp(k.out_vencidas + k.out_irreg, 'outorgas vencidas ou irregulares', 'alerta')}${kp(k.vazao_capt_m3h, 'm³/h de captação outorgada')}</div>
            <div class="baixar"><button id="rxRel">📄 Relatório (imprimir/PDF)</button></div>
            <div class="baixar"><button id="rxCsvL">⬇ Licenças da área</button><button id="rxCsvO">⬇ Outorgas da área</button></div>
            <h3>Achados</h3><ul class="rxach">${resultado.achados.map(a => `<li class="${a.risco === 'Alto' ? 'alerta' : a.risco === 'Médio' ? 'atencao' : ''}"><b>${esc(a.n)}</b> ${esc(a.t)}</li>`).join('')}</ul>
            <h3>Pontos de atenção (${fmt(aten.length)})</h3>
            <div class="lista">${aten.slice(0, 60).map(({ x, t }) => `<div class="item res" data-xy="${esc(JSON.stringify(x.xy))}" style="border-left-color:${t === 'l' ? '#e65100' : '#c62828'}">
                <div class="n">${esc(t === 'l' ? x.n : x.nome)} ${tagSit(t === 'l' ? x.si : x.situ)}</div>
                <div class="m">${t === 'l' ? `${esc(x.a)} · ${esc(x.s)} ${esc(x.d)} · validade ${esc(x.va || '–')}` : `${esc(x.interf || x.tipo)} · nº ${esc(x.num || '–')} · venc. ${esc(x.venc || '–')}`}</div>
                ${x.oc ? `<div class="m">💧 ${esc(x.oc)}</div>` : ''}<div class="m">📍 ${fmt(x.dm)} m${x.ct ? ` · ☎ ${esc([x.ct.tel, x.ct.email].filter(Boolean).join(' · '))}` : ''}</div></div>`).join('') || '<p class="rot">Nenhum ponto de atenção.</p>'}</div>`;
        box.querySelectorAll('[data-xy]').forEach(b => b.onclick = () => map.flyTo({ center: JSON.parse(b.dataset.xy), zoom: 16 }));
        document.getElementById('rxRel').onclick = () => {
            const w = window.open('', '_blank'); if (!w) return alert('Permita janelas pop-up para abrir o relatório.');
            w.document.open(); w.document.write(RaioX.relatorioHTML(resultado, op)); w.document.close();
        };
        const csv = t => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([RaioX.csv(resultado, t, op)], { type: 'text/csv;charset=utf-8' })); a.download = `raiox_${t === 'lic' ? 'licencas' : 'outorgas'}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); };
        document.getElementById('rxCsvL').onclick = () => csv('lic'); document.getElementById('rxCsvO').onclick = () => csv('out');
    }


    // ================================================================ Raio X do EMPREENDIMENTO (clique num único negócio)
    let refEmp = null, empRes = null;
    document.addEventListener('click', e => {
        const b = e.target.closest('.btnEmp'); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        abrirEmpreendimento({ nome: b.dataset.nome, cod: b.dataset.c, xy: b.dataset.xy ? JSON.parse(b.dataset.xy) : null, p: b.dataset.p, num: b.dataset.num });
    });
    async function abrirEmpreendimento(ref) {
        refEmp = ref; window.modoRaioX = false; btn.classList.remove('on'); map.getCanvas().style.cursor = '';
        document.querySelectorAll('.mapboxgl-popup').forEach(p => p.remove());
        ['estado', 'municipio', 'resultados'].forEach(i => document.getElementById(i).hidden = true);
        el.hidden = false;
        const interno = !!CHAVE;
        el.innerHTML = `<button class="voltar" id="empVoltar">← voltar</button><h2>🔎 Raio X do empreendimento</h2>
            <p class="rot">${esc(ref.nome)}</p>
            <div class="rxform"><label class="rot">Finalidade</label>
            <select id="empFin"><option value="Diagnóstico">Pré-diagnóstico técnico</option><option value="Entrega">Entrega ao cliente</option>${interno ? '<option value="Prospecção">Prospecção comercial (uso interno)</option>' : ''}</select>
            <label class="rot"><input type="checkbox" id="empSoMun"> Só neste município (evita homônimos e outras filiais)</label></div>
            ${interno ? '' : '<p class="rot">Entre na 🔒 Área CS para reunir as unidades pelo CNPJ e ver CNAE, porte e endereço.</p>'}
            <div id="empRes"><p class="dica">Reunindo licenças e outorgas do titular em todo o Paraná…</p></div>`;
        document.getElementById('empVoltar').onclick = () => { el.hidden = true; document.getElementById(munSel ? 'municipio' : 'estado').hidden = false; };
        document.getElementById('empFin').onchange = calcularEmp; document.getElementById('empSoMun').onchange = calcularEmp;
        await calcularEmp();
    }
    async function cdsTitular(nome) {
        let ch = null;
        for (const w of RaioX.palavras(nome)) {
            const d = await carregarIdx('w', w.slice(0, 3)), st = new Set((d[w] || []).map(v => v.join('|')));
            ch = ch ? new Set([...ch].filter(x => st.has(x))) : st;
            if (!ch.size) break;
        }
        return [...new Set([...(ch || [])].map(k => k.split('|')[0]))];
    }
    // cálculo reaproveitado pelo painel e pela emissão direta no balão
    async function calcEmp(ref, op) {
        let cods = RaioX.provavelPF(ref.nome) ? [ref.cod] : await cdsTitular(ref.nome);
        if (!cods.includes(ref.cod)) cods.push(ref.cod);
        if (cods.length > 40 && !op.soMunicipio) op.soMunicipio = true;
        if (op.soMunicipio) cods = [ref.cod];
        let dados = await Promise.all(cods.map(c => carregarMun(c)));
        const anexar = async ds => { if (!CHAVE) return; for (const d of ds) { const C = await contatosMun(d.cod); if (!C) continue; const pega = (t, k) => { const i = (C[t] || {})[k]; return i && i.length ? C.r[i[0]] : null; }; d.lic.forEach(x => { if (!('ct' in x)) x.ct = pega('l', x.p); }); d.out.forEach(x => { if (!('ct' in x)) x.ct = pega('o', x.num); }); } };
        await anexar(dados);
        if (CHAVE) {   // CNPJ do registro clicado → só as unidades do mesmo CNPJ (raiz)
            const d0 = dados.find(d => d.cod === ref.cod), x0 = d0 && (ref.p ? d0.lic.find(x => x.p === ref.p) : d0.out.find(x => x.num === ref.num));
            if (x0 && x0.ct && x0.ct.cnpj) op.cnpj = x0.ct.cnpj;
        }
        let e = RaioX.empreendimento(ref, dados, MUNS, op);
        if (e.unidades.length) {
            const viz = RaioX.municipiosDaArea(RaioX.area({ tipo: 'circulo', centro: e.unidades[0].xy, raio: 1000 }), MUNS).filter(c => !cods.includes(c));
            if (viz.length) { const mais = await Promise.all(viz.map(c => carregarMun(c))); await anexar(mais); dados = dados.concat(mais); e = RaioX.empreendimento(ref, dados, MUNS, op); }
        }
        return e;
    }
    async function calcularEmp() {
        const ref = refEmp, box = document.getElementById('empRes');
        const fin = document.getElementById('empFin').value;
        const op = { finalidade: fin, soMunicipio: document.getElementById('empSoMun').checked, anonimizar: fin === 'Entrega', contatos: fin === 'Prospecção' && !!CHAVE, logo: new URL('logo.png', location.href).href, link: linkEmp(ref) };
        empRes = await calcEmp(ref, op);
        if (op.soMunicipio) document.getElementById('empSoMun').checked = true;
        const e = empRes, k = e.k;
        const kp = (v, t, c) => `<div class="kpi ${c || ''}"><b>${fmt(v)}</b><span>${t}</span></div>`;
        const cor = { 'Conforme': 'ok', 'Parcial': 'vence', 'Verificar': 'vence', 'Sem evidência': 'vence', 'Não conforme': 'vencida' };
        box.innerHTML = `<h3>${esc(e.titular)}</h3>
            ${e.ct ? `<p class="rot">CNPJ ${esc(e.ct.cnpj || '')} · ${esc(e.ct.cnae || '')} · ${esc(e.ct.porte || '')}</p>` : ''}
            <p class="rot">${esc(e.municipios.join(', '))} · vínculo por ${esc(e.vinculo)} · base de ${esc(e.base)}</p>
            <p>Exposição preliminar: <span class="tag ${{ Alta: 'vencida', Média: 'vence', Baixa: 'ok' }[e.exposicao]}">${esc(e.exposicao)}</span></p>
            <div class="kpis">${kp(k.unidades, 'unidades')}${kp(k.lic_vig, 'licenças vigentes')}${kp(k.lic_venc6, 'licenças vencem em 6 meses', 'atencao')}${kp(k.lic_vencidas, 'licenças vencidas', 'alerta')}
            ${kp(k.out_val, 'outorgas válidas')}${kp(k.out_prob, 'outorgas vencidas/irregulares', 'alerta')}</div>
            <div class="baixar"><button id="empRel">📄 Pré-diagnóstico (imprimir/PDF)</button><button id="empCsv">⬇ Planilha</button></div>
            <div class="baixar"><button id="empArea">🎯 Raio X da área (1 km)</button><button id="empAg">📋 Pedido para o agente CS</button></div>
            <h3>Matriz preliminar</h3>
            <div class="lista">${e.matriz.map(m => `<div class="item"><div class="n">${esc(m.id)} · ${esc(m.tema)} <span class="tag ${cor[m.st] || ''}">${esc(m.st)}</span>${m.natureza !== 'Pendente' ? ` <span class="tag">risco ${esc(m.risco.toLowerCase())}</span>` : ''}</div><div class="m">${esc(m.evid)}</div><div class="m">→ ${esc(m.acao)}</div></div>`).join('')}</div>
            <h3>Unidades</h3>
            <div class="lista">${e.unidades.map(u => `<div class="item res" data-xy="${esc(JSON.stringify(u.xy))}"><div class="n">${u.id} · ${esc(u.mun)}</div><div class="m">${u.lic} licença(s) · ${u.out} outorga(s)${u.dm != null ? ` · ${fmt(u.dm)} m do ponto` : ''}</div><div class="m">${esc(u.ativ.slice(0, 2).join('; '))}</div></div>`).join('') || '<p class="rot">Sem coordenadas.</p>'}</div>
            <h3>Escopo sugerido para o diagnóstico</h3><ol class="top">${e.escopo.map(x => `<li>${esc(x.servico)}</li>`).join('')}</ol>`;
        box.querySelectorAll('[data-xy]').forEach(b => b.onclick = () => map.flyTo({ center: JSON.parse(b.dataset.xy), zoom: 16 }));
        document.getElementById('empRel').onclick = () => { const w = window.open('', '_blank'); if (!w) return alert('Permita janelas pop-up para abrir o relatório.'); w.document.open(); w.document.write(RaioX.relatorioEmpreendimentoHTML(e, op)); w.document.close(); };
        document.getElementById('empCsv').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([RaioX.csvEmpreendimento(e)], { type: 'text/csv;charset=utf-8' })); a.download = `raiox_${e.titular.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_').slice(0, 40)}.csv`; a.click(); };
        document.getElementById('empArea').onclick = () => { if (!e.unidades.length) return; abrir(); centro(e.unidades[0].xy); };
        document.getElementById('empAg').onclick = async () => {
            const u = e.unidades[0];
            const t = `Raio X do empreendimento (agente CS): titular "${e.titular}"${e.cnpj ? `, CNPJ ${e.cnpj}` : ''}, município ${e.municipios[0] || ''}${u ? `, unidade principal em ${u.xy[1].toFixed(5)}, ${u.xy[0].toFixed(5)}` : ''}. Finalidade: ${fin}. Gerar pré-diagnóstico com buscas complementares e matriz.`;
            try { await navigator.clipboard.writeText(t); alert('Pedido copiado. Cole no Claude, no projeto da CS.'); } catch (er) { prompt('Copie o pedido:', t); }
        };
    }
    window.abrirEmpreendimento = abrirEmpreendimento;
    // link público do empreendimento (QR code do relatório): reabre o mesmo Raio-X na plataforma
    function linkEmp(ref) {
        const q = new URLSearchParams({ emp: ref.nome, m: ref.cod || '' });
        if (ref.p) q.set('p', ref.p); if (ref.num) q.set('num', ref.num); if (ref.xy) q.set('xy', ref.xy.map(v => (+v).toFixed(5)).join(','));
        return `${location.origin}${location.pathname}?${q}`;
    }

    // ================================================================ EMITIR RELATÓRIO direto do balão (PJ ou PF)
    const TIPOS_TEC = [['Posto de combustíveis', /posto|combust/i], ['Indústria', /ind[uú]stria|fabrica|usina|concret|metal|qu[ií]mic/i], ['Laticínio e agroindústria', /latic|leite|alimentos|abate|frigor|avicult|suinocult/i], ['Comércio e serviços', /com[eé]rcio|servi[cç]o|oficina|lavador|sa[uú]de|atacad|varej/i]];
    window.blocoEmitir = d => {
        const at = Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `data-${k}="${esc(typeof v === 'string' ? v : JSON.stringify(v))}"`).join(' ');
        const pf = RaioX.provavelPF(d.nome);
        return `<div class="emitir" ${at}><div class="emT">📄 Emitir relatório${pf ? ' <span class="tag">pessoa física</span>' : ''}</div>
            <select class="emTipo"><optgroup label="Fase 1 – dados públicos (imediato)"><option value="emp">Diagnóstico do empreendimento (Raio X)</option><option value="area1">Raio X da área – 1 km</option><option value="area3">Raio X da área – 3 km</option>${CHAVE ? '<option value="prosp">Ficha de prospecção (uso interno)</option>' : ''}</optgroup>
            <optgroup label="Fase 2 – documentos e vistoria"><option value="tec">Abrir diagnóstico completo (relatório unificado)</option></optgroup></select>
            <select class="emFin"><option value="Diagnóstico">Para análise técnica da CS</option><option value="Entrega">Para entregar ao cliente</option></select>
            <div class="emB"><button class="emGo">Emitir</button><button class="emPainel">Ver no painel</button></div></div>`;
    };
    const janela = () => { const w = window.open('', '_blank'); if (w) w.document.write('<p style="font-family:sans-serif;padding:24px">Gerando relatório da CS…</p>'); return w; };
    const escrever = (w, html) => { w.document.open(); w.document.write(html); w.document.close(); };
    document.addEventListener('click', async ev => {
        const b = ev.target.closest('.emGo, .emPainel'); if (!b) return;
        ev.preventDefault(); ev.stopPropagation();
        const box = b.closest('.emitir'), D = box.dataset;
        const ref = { nome: D.nome, cod: D.c, p: D.p, num: D.num, xy: D.xy ? JSON.parse(D.xy) : null };
        if (b.classList.contains('emPainel')) return abrirEmpreendimento(ref);
        const tipo = box.querySelector('.emTipo').value, fin = tipo === 'prosp' ? 'Prospecção' : box.querySelector('.emFin').value;
        const w = janela(); if (!w) return alert('Permita janelas pop-up neste site para emitir relatórios.');
        const logo = new URL('logo.png', location.href).href;
        try {
            if (tipo === 'area1' || tipo === 'area3') {
                const a = RaioX.area({ tipo: 'circulo', centro: ref.xy, raio: tipo === 'area1' ? 1000 : 3000 });
                const dados = await Promise.all(RaioX.municipiosDaArea(a, MUNS).map(c => carregarMun(c)));
                const op = { finalidade: fin, cliente: ref.nome, anonimizar: fin === 'Entrega', titulo: 'Raio X Ambiental da Área', logo };
                return escrever(w, RaioX.relatorioHTML(RaioX.calcular(a, dados, MUNS, op), op));
            }
            const op = { finalidade: fin, anonimizar: fin === 'Entrega', contatos: fin === 'Prospecção' && !!CHAVE, logo, link: linkEmp(ref) };
            const e = await calcEmp(ref, op);
            if (tipo !== 'tec') return escrever(w, RaioX.relatorioEmpreendimentoHTML(e, op));
            // abertura do diagnóstico técnico: tipologias sugeridas + pré-preenchimento da matriz
            const atv = e.lic.map(x => `${x.a} ${x.e || ''}`).join(' | ');
            const tip = TIPOS_TEC.filter(([, rx]) => rx.test(atv)).map(([t]) => t);
            const pre = RaioX.preenchimentoMatriz(e);
            const pacote = { titular: e.titular, cnpj: e.cnpj || '', pessoa: e.pf ? 'física' : 'jurídica', municipios: e.municipios, unidades: e.unidades.map(u => ({ id: u.id, municipio: u.mun, lat: +u.xy[1].toFixed(6), lon: +u.xy[0].toFixed(6) })), tipologias: tip, base: e.base, exposicao: e.exposicao, preenchimento: pre };
            const blob = URL.createObjectURL(new Blob([JSON.stringify(pacote, null, 1)], { type: 'application/json' }));
            const slug = e.titular.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
            escrever(w, `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Fase 2 – diagnóstico completo – ${esc(e.titular)}</title><style>body{font-family:"Segoe UI",Roboto,Arial,sans-serif;max-width:760px;margin:24px auto;color:#1f2a1f;padding:0 16px}h1{color:#1b5e20;font-size:20px}h2{color:#2e7d32;font-size:15px;margin-top:22px}td{padding:4px 8px;border-bottom:1px solid #eef1ec;font-size:13px;vertical-align:top}td:first-child{color:#5f6b5f;width:38%}code{background:#f5f7f4;padding:2px 6px;border-radius:4px}a.b{display:inline-block;margin-top:8px;padding:8px 14px;background:#2e7d32;color:#fff;border-radius:6px;text-decoration:none}li{margin:6px 0;font-size:13px}</style></head><body>
<img src="${esc(logo)}" style="height:48px"><h1>Fase 2 – abertura do diagnóstico completo</h1><p style="font-size:13px;color:#5f6b5f">A Fase 1 (dados públicos) já está pronta. Na Fase 2, documentos, informações complementares e vistoria entram na matriz do cliente, e o relatório é reemitido como um único relatório unificado.</p>
<table><tr><td>Titular</td><td>${esc(e.titular)}</td></tr>${e.cnpj ? `<tr><td>CNPJ</td><td>${esc(e.cnpj)}</td></tr>` : ''}<tr><td>Pessoa</td><td>${e.pf ? 'Física (análise restrita ao município)' : 'Jurídica'}</td></tr><tr><td>Município(s)</td><td>${esc(e.municipios.join(', '))}</td></tr>
<tr><td>Unidades</td><td>${e.unidades.map(u => `${u.id} – ${esc(u.mun)} (${u.xy[1].toFixed(5)}, ${u.xy[0].toFixed(5)})`).join('<br>') || 'sem coordenada'}</td></tr><tr><td>Tipologias sugeridas</td><td>${esc(tip.join(', ') || 'só requisitos gerais')}</td></tr>
<tr><td>Raio X</td><td>Base de ${esc(e.base)} · exposição preliminar ${esc(e.exposicao)} · ${pre.linhas.length} requisito(s) pré-preenchidos, ${pre.pendentes.length} pendência(s) para a vistoria</td></tr></table>
<a class="b" href="${blob}" download="diagnostico_${slug}.json">⬇ Baixar pré-preenchimento da matriz</a>
<h2>Próximos passos</h2><ol><li>No repositório privado <b>diagnosticos-cs</b>: Actions → <b>Novo cliente (Raio X + matriz)</b> → Run workflow.</li>
<li>Razão social: <code>${esc(e.titular)}</code> · pasta: <code>${slug}</code> · tipologias: <code>${esc(tip.join(','))}</code>${e.pf ? ` · município: <code>${esc(e.municipios[0] || '')}</code>` : ''}</li>
<li>Empresa com mais de uma unidade: uma pasta por unidade (ex.: <code>${slug}/${(e.unidades[0] ? e.unidades[0].mun : 'unidade').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}</code>).</li>
<li>Enviar os documentos do cliente para <code>clientes/&lt;pasta&gt;/documentos/</code> e registrá-los na aba <b>Documentos</b> da matriz; preencher a aba <b>Informações complementares</b> e, após a vistoria, a aba <b>Matriz</b>.</li><li>Ao subir a matriz, o <b>relatório unificado</b> (Fase 1 + Fase 2) é gerado automaticamente.</li></ol></body></html>`);
        } catch (er) { escrever(w, `<p style="font-family:sans-serif;padding:24px">Não foi possível gerar o relatório: ${esc(er.message)}</p>`); }
    });


    // abrir direto por link: ?emp=<titular>&m=<município>[&p|num][&xy=lon,lat] (QR code do Raio-X do Empreendimento)
    map.on('load', () => {
        const q = new URLSearchParams(location.search), nome = q.get('emp');
        if (!nome) return;
        const ref = { nome, cod: q.get('m'), p: q.get('p') || undefined, num: q.get('num') || undefined, xy: q.get('xy') ? q.get('xy').split(',').map(Number) : null };
        const tenta = () => { if (!MUNS) return setTimeout(tenta, 300); if (ref.xy) map.jumpTo({ center: ref.xy, zoom: 15 }); abrirEmpreendimento(ref); };
        tenta();
    });
    // abrir direto por link: ?raiox=lat,lon,raio
    map.on('load', () => {
        const q = new URLSearchParams(location.search).get('raiox');
        if (!q) return;
        const [lat, lon, r] = q.split(',').map(Number);
        const tenta = () => { if (!MUNS) return setTimeout(tenta, 300); abrir(); if (r) document.getElementById('rxRaio').value = String(r); centro([lon, lat]); };
        tenta();
    });
})();
