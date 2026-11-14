// Licenças e Outorgas do Paraná – CS Consultoria Ambiental
mapboxgl.accessToken = 'pk.eyJ1IjoiY3NhbWJpZW50YWwiLCJhIjoiY205MWk4eHU4MDE3czJxcHNqamR4emd5aiJ9.e8K-ENRHJwXTz_FGGwYExg';
const SGA = 'https://www.sga.pr.gov.br/sga-iap/consultarProcessoLicenciamento.do?action=exibirDadosPublicoLicenca&ucsChamador=carregarInterfaceInicial';
const COR_LIC = { 'Licença de Operação': '#2e7d32', 'Licença Simplificada': '#66bb6a', 'Licença por Adesão e Compromisso': '#26a69a', 'Licença Prévia / de Instalação': '#ffa000',
    'Dispensa / inexigibilidade': '#ab47bc', 'Autorização Ambiental': '#1e88e5', 'Autorização Florestal': '#6d4c41', 'Outras': '#78909c' };
const COR_OUT = { 'Captação superficial': '#0288d1', 'Poço (água subterrânea)': '#5e35b1', 'Lançamento de efluentes': '#8d6e63', 'Barragem / soleira': '#00897b', 'Obras e intervenções em rios': '#90a4ae' };
const ESCALA = ['#f1f8e9', '#c5e1a5', '#8bc34a', '#558b2f', '#1b5e20'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => (n ?? 0).toLocaleString('pt-BR');
const ROTULO = {}; document.querySelectorAll('#indicador option').forEach(o => ROTULO[o.value] = o.textContent);
let MUNS = null, munSel = null, dadosMun = null, aba = 'lic', mostrar = 150;

const map = new mapboxgl.Map({ container: 'mapa', style: 'mapbox://styles/mapbox/light-v11', center: [-51.6, -24.6], zoom: 6.2, minZoom: 5, maxZoom: 18, attributionControl: true });
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');

async function iniciar() {
    const [res, mun] = await Promise.all([fetch('data/resumo.json').then(r => r.json()), fetch('data/municipios.geojson').then(r => r.json())]);
    MUNS = mun;
    document.getElementById('atualizado').textContent = res.atualizado;
    document.getElementById('kpisEstado').innerHTML = [
        [res.lic_vig, 'licenças ambientais vigentes'], [res.lic_venc6, 'licenças vencem em até 6 meses', 'atencao'],
        [res.lic_vencidas, 'licenças vencidas sem renovação', 'alerta'], [res.out_val, 'outorgas de água válidas'],
        [res.out_venc6, 'outorgas vencem em até 6 meses', 'atencao'], [res.out_irreg, 'outorgas irregulares (IAT)', 'alerta']
    ].map(([v, t, c]) => `<div class="kpi ${c || ''}"><b>${fmt(v)}</b><span>${t}</span></div>`).join('');
    document.getElementById('listaMun').innerHTML = mun.features.map(f => `<option value="${esc(f.properties.nome)}">`).join('');
    adicionarCamadas();
    colorir();
    const m = new URLSearchParams(location.search).get('m');
    if (m) abrirMunicipio(m);
}

function adicionarCamadas() {
    map.addSource('mun', { type: 'geojson', data: MUNS, promoteId: 'cod' });
    map.addLayer({ id: 'mun-fill', type: 'fill', source: 'mun', paint: { 'fill-color': '#ccc', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0.75, 9.5, 0.12] } });
    map.addLayer({ id: 'mun-linha', type: 'line', source: 'mun', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 1.5] } });
    map.addLayer({ id: 'mun-sel', type: 'line', source: 'mun', paint: { 'line-color': '#c62828', 'line-width': 2.5 }, filter: ['==', ['get', 'cod'], ''] });
    map.addLayer({ id: 'mun-rot', type: 'symbol', source: 'mun', minzoom: 7.3,
        layout: { 'text-field': ['get', 'nome'], 'text-size': 11, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
        paint: { 'text-color': '#263238', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
    map.addSource('pts', { type: 'vector', tiles: [new URL('data/tiles/{z}/{x}/{y}.pbf', location.href).href.replace(/%7B/g, '{').replace(/%7D/g, '}')], minzoom: 6, maxzoom: 13 });
    const raio = ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4.5, 16, 7];
    map.addLayer({ id: 'lic-venc', type: 'circle', source: 'pts', 'source-layer': 'lic', minzoom: 8, filter: ['==', ['get', 'si'], 'Vencida'],
        paint: { 'circle-radius': raio, 'circle-color': '#9e9e9e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
    map.addLayer({ id: 'lic-vig', type: 'circle', source: 'pts', 'source-layer': 'lic', minzoom: 8, filter: ['!=', ['get', 'si'], 'Vencida'],
        paint: { 'circle-radius': raio, 'circle-color': ['match', ['get', 'g'], ...Object.entries(COR_LIC).flat(), '#78909c'],
            'circle-stroke-color': ['case', ['==', ['get', 'si'], 'Vence em até 6 meses'], '#e65100', '#fff'], 'circle-stroke-width': ['case', ['==', ['get', 'si'], 'Vence em até 6 meses'], 2, 0.8] } });
    map.addLayer({ id: 'out-prob', type: 'circle', source: 'pts', 'source-layer': 'out', minzoom: 8, filter: ['in', ['get', 'situ'], ['literal', ['Vencida', 'Irregular']]],
        paint: { 'circle-radius': raio, 'circle-color': ['match', ['get', 'tipo'], ...Object.entries(COR_OUT).flat(), '#90a4ae'], 'circle-stroke-color': '#c62828', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'out-val', type: 'circle', source: 'pts', 'source-layer': 'out', minzoom: 8, filter: ['!', ['in', ['get', 'situ'], ['literal', ['Vencida', 'Irregular']]]],
        paint: { 'circle-radius': raio, 'circle-color': ['match', ['get', 'tipo'], ...Object.entries(COR_OUT).flat(), '#90a4ae'],
            'circle-stroke-color': ['case', ['==', ['get', 'situ'], 'Vence em até 6 meses'], '#e65100', '#fff'], 'circle-stroke-width': ['case', ['==', ['get', 'situ'], 'Vence em até 6 meses'], 2, 0.8] } });
    document.getElementById('legendaPontos').innerHTML = '<div class="rot">Licenças (cor = tipo)</div>' +
        Object.entries(COR_LIC).map(([k, c]) => `<div class="it"><span class="pt" style="background:${c}"></span>${k}</div>`).join('') +
        '<div class="it"><span class="pt" style="background:#9e9e9e"></span>Licença vencida sem renovação</div><div class="rot">Outorgas (cor = tipo)</div>' +
        Object.entries(COR_OUT).map(([k, c]) => `<div class="it"><span class="pt" style="background:${c}"></span>${k}</div>`).join('') +
        '<div class="it"><span class="pt" style="background:#fff;box-shadow:0 0 0 2px #c62828"></span>Contorno vermelho: vencida/irregular · laranja: vence em 6 meses</div><div class="rot">Pontos aparecem ao aproximar o mapa</div>';
    for (const id of ['lic-vig', 'lic-venc', 'out-val', 'out-prob']) {
        map.on('click', id, e => { if (window.modoRaioX) return; e.originalEvent._pt = true; popup(e.features[0], e.lngLat); });
        map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    }
    map.on('click', 'mun-fill', e => { if (e.originalEvent._pt || window.modoRaioX) return; abrirMunicipio(e.features[0].properties.cod, false); });
    document.querySelectorAll('#camadas input[data-c]').forEach(i => i.addEventListener('change', () => map.setLayoutProperty(i.dataset.c, 'visibility', i.checked ? 'visible' : 'none')));
    document.getElementById('satelite').addEventListener('change', e => {
        if (e.target.checked) { if (!map.getSource('sat')) map.addSource('sat', { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 }); map.addLayer({ id: 'sat', type: 'raster', source: 'sat' }, 'mun-fill'); }
        else if (map.getLayer('sat')) map.removeLayer('sat');
    });
}

function colorir() {
    const k = document.getElementById('indicador').value;
    const vals = MUNS.features.map(f => f.properties[k] || 0).filter(v => v > 0).sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8].map(p => vals[Math.floor(p * (vals.length - 1))] || 0);
    const cortes = [...new Set(q)].filter(v => v > 0);
    const expr = ['step', ['coalesce', ['get', k], 0], '#eeeeee', 1, ESCALA[0]];
    cortes.forEach((c, i) => expr.push(c + 1, ESCALA[Math.min(i + 1, 4)]));
    map.setPaintProperty('mun-fill', 'fill-color', expr);
    const faixas = [[1, cortes[0] || '…']].concat(cortes.map((c, i) => [c + 1, cortes[i + 1] ?? vals[vals.length - 1]]));
    document.getElementById('legendaMapa').innerHTML = `<div class="rot">${esc(ROTULO[k])} (por município)</div><div class="it"><span class="sw" style="background:#eee"></span>nenhuma</div>` +
        faixas.map(([a, b], i) => `<div class="it"><span class="sw" style="background:${ESCALA[Math.min(i, 4)]}"></span>${fmt(a)}${b && b !== a ? ' a ' + fmt(b) : ''}</div>`).join('');
    const top = [...MUNS.features].sort((a, b) => (b.properties[k] || 0) - (a.properties[k] || 0)).slice(0, 10);
    document.getElementById('ranking').innerHTML = `<h3>Os 10 municípios com mais</h3><ol>${top.map(f => `<li data-c="${f.properties.cod}">${esc(f.properties.nome)} – <b>${fmt(f.properties[k])}</b></li>`).join('')}</ol>`;
    document.querySelectorAll('#ranking li').forEach(li => li.onclick = () => abrirMunicipio(li.dataset.c));
}
document.getElementById('indicador').addEventListener('change', colorir);

// ---------------- busca geral: município, titular, nº da licença/protocolo ou nº da outorga
const cacheMun = {};
const carregarMun = cod => cacheMun[cod] || (cacheMun[cod] = fetch(`data/m/${cod}.json`).then(r => r.json()));
const cacheIdx = {};
const carregarIdx = (p, k) => cacheIdx[p + k] || (cacheIdx[p + k] = fetch(`data/busca/${p}/${k}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
const semAcento = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const PARADAS = new Set(['LTDA', 'EIRELI', 'DOS', 'DAS', 'DE', 'DO', 'DA', 'EPP', 'CIA', 'FILIAL', 'MATRIZ', 'SA', 'LIMITADA', 'EM', 'PARA', 'COM', 'POR']);
document.getElementById('formBusca').addEventListener('submit', e => { e.preventDefault(); buscar(document.getElementById('buscaMun').value); });
document.getElementById('buscaMun').addEventListener('change', e => {
    const f = MUNS && MUNS.features.find(f => f.properties.nome.toLowerCase() === e.target.value.trim().toLowerCase());
    if (f) { abrirMunicipio(f.properties.cod); e.target.value = ''; }
});
async function buscar(q) {
    q = q.trim(); if (q.length < 3) return;
    const box = document.getElementById('resultados');
    box.hidden = false; document.getElementById('estado').hidden = true; document.getElementById('municipio').hidden = true;
    box.innerHTML = `<button class="voltar" id="fecharBusca">← voltar</button><h2>Buscando “${esc(q)}”…</h2>`;
    document.getElementById('fecharBusca').onclick = fecharBusca;
    const Q = semAcento(q), digitos = q.replace(/\D/g, '');
    const muns = MUNS.features.filter(f => semAcento(f.properties.nome).includes(Q)).slice(0, 5);
    let chaves = new Set();
    if (digitos.length >= 4 && digitos.length >= Q.replace(/[^A-Z]/g, '').length) {
        const nums = (q.match(/\d+/g) || []).map(n => n.replace(/^0+/, ''));
        // primeiro o número inteiro (licença, protocolo); se não achar, as partes (ex.: 10846 de 10846/2026/OD-GOUT)
        const cands = [[digitos.replace(/^0+/, '')], [nums[0], (nums[0] || '') + (nums[1] || '')]];
        for (const grupo of cands) {
            for (const k of [...new Set(grupo.filter(k => k && k.length >= 4))]) { const d = await carregarIdx('n', k.slice(0, 3)); (d[k] || []).forEach(v => chaves.add(v.join('|'))); }
            if (chaves.size) break;
        }
    } else {
        const palavras = [...new Set(Q.match(/[A-Z0-9]{3,}/g) || [])].filter(w => !PARADAS.has(w));
        let primeiro = true;
        for (const w of palavras) {
            const d = await carregarIdx('w', w.slice(0, 3)), s = new Set();
            for (const [k, vs] of Object.entries(d)) if (k.startsWith(w)) vs.forEach(v => s.add(v.join('|')));
            chaves = primeiro ? s : new Set([...chaves].filter(x => s.has(x))); primeiro = false;
            if (!chaves.size) break;
        }
    }
    const lista = [...chaves].map(k => k.split('|')).slice(0, 80);
    const porMun = {}; lista.forEach(([c]) => porMun[c] = 1);
    await Promise.all(Object.keys(porMun).slice(0, 25).map(carregarMun));
    const nomeMun = c => (MUNS.features.find(f => f.properties.cod === c) || { properties: { nome: c } }).properties.nome;
    const itens = [];
    for (const [c, t, i] of lista) {
        if (!cacheMun[c]) continue; const d = await cacheMun[c], x = (t === 'l' ? d.lic : d.out)[+i]; if (!x) continue;
        itens.push(t === 'l'
            ? { c, t, i, nome: x.n, sit: x.si, cor: COR_LIC[x.g] || '#78909c', rot: 'Licença', l1: `${x.s} nº ${x.d} · protocolo ${x.p}`, l2: `${x.a}${x.e && x.e !== x.a ? ' – ' + x.e : ''} · validade ${x.va || '–'}`, busca: x.d }
            : { c, t, i, nome: x.nome, sit: x.situ, cor: COR_OUT[x.tipo] || '#90a4ae', rot: 'Outorga', l1: `${x.doc} nº ${x.num || '–'}`, l2: `${x.interf || x.tipo} · vencimento ${x.venc || '–'}`, busca: x.num || x.nome });
    }
    box.innerHTML = `<button class="voltar" id="fecharBusca">← voltar</button><h2>Resultado para “${esc(q)}”</h2>
        ${muns.length ? `<h3>Municípios</h3>${muns.map(f => `<div class="item res" data-m="${f.properties.cod}"><div class="n">📍 ${esc(f.properties.nome)}</div><div class="m">${fmt(f.properties.lic_vig)} licenças vigentes · ${fmt(f.properties.out_val)} outorgas válidas</div></div>`).join('')}` : ''}
        <h3>Licenças e outorgas (${fmt(chaves.size)}${chaves.size > itens.length ? `, mostrando ${itens.length}` : ''})</h3>
        ${itens.length ? itens.map((x, k) => `<div class="item res" data-k="${k}" style="border-left-color:${x.cor}"><div class="n"><span class="tipo" style="background:${x.t === 'l' ? '#2e7d32' : '#0277bd'}">${x.rot}</span>${esc(x.nome)} ${tagSit(x.sit)}</div>
            <div class="m">${esc(x.l1)}</div><div class="m">${esc(x.l2)}</div><div class="m">📍 ${esc(nomeMun(x.c))}</div></div>`).join('')
            : `<p class="dica">Nada encontrado. Dicas: para números, digite só o número da licença (ex.: 265644), o protocolo (ex.: 18.525.996-0) ou o nº da outorga (ex.: 10846/2026); para titulares, digite parte do nome.</p>`}`;
    document.getElementById('fecharBusca').onclick = fecharBusca;
    box.querySelectorAll('[data-m]').forEach(el => el.onclick = () => { fecharBusca(); abrirMunicipio(el.dataset.m); });
    box.querySelectorAll('[data-k]').forEach(el => el.onclick = async () => {
        const x = itens[+el.dataset.k]; fecharBusca(); aba = x.t === 'l' ? 'lic' : 'out';
        await abrirMunicipio(x.c);
        const ft = document.getElementById('fTexto'); if (ft) { ft.value = x.busca; ft.dispatchEvent(new Event('input')); }
        const d = await cacheMun[x.c], r = (x.t === 'l' ? d.lic : d.out)[+x.i];
        if (r && r.xy) setTimeout(() => map.flyTo({ center: r.xy, zoom: 15 }), 400);
    });
}
function fecharBusca() { document.getElementById('resultados').hidden = true; if (munSel) document.getElementById('municipio').hidden = false; else document.getElementById('estado').hidden = false; }

async function abrirMunicipio(cod, zoom = true) {
    const f = MUNS.features.find(x => x.properties.cod === String(cod)); if (!f) return;
    munSel = f.properties; map.setFilter('mun-sel', ['==', ['get', 'cod'], munSel.cod]);
    if (zoom) map.fitBounds(munSel.bbox ? (typeof munSel.bbox === 'string' ? JSON.parse(munSel.bbox) : munSel.bbox) : [-54.6, -26.7, -48, -22.5], { padding: 30, maxZoom: 12 });
    history.replaceState(null, '', `?m=${munSel.cod}`);
    const el = document.getElementById('municipio'); el.hidden = false; document.getElementById('estado').hidden = true; document.getElementById('resultados').hidden = true;
    el.innerHTML = `<button class="voltar" id="voltar">← Paraná</button><h2>${esc(munSel.nome)}</h2><p class="dica">Carregando…</p>`;
    document.getElementById('voltar').onclick = fecharMunicipio;
    dadosMun = await carregarMun(munSel.cod);
    mostrar = 150; renderMunicipio();
}
function fecharMunicipio() {
    munSel = dadosMun = null; map.setFilter('mun-sel', ['==', ['get', 'cod'], '']);
    document.getElementById('municipio').hidden = true; document.getElementById('estado').hidden = false;
    history.replaceState(null, '', location.pathname); map.flyTo({ center: [-51.6, -24.6], zoom: 6.2 });
}

const tagSit = s => `<span class="tag ${/Vencida|Irregular/.test(s) ? 'vencida' : /6 meses/.test(s) ? 'vence' : 'ok'}">${esc(s)}</span>`;
function renderMunicipio() {
    const d = dadosMun, e = d.est;
    const el = document.getElementById('municipio');
    el.innerHTML = `<button class="voltar" id="voltar">← Paraná</button><h2>${esc(d.nome)}</h2>
        <div class="kpis">
          <div class="kpi"><b>${fmt(e.lic_vig)}</b><span>licenças vigentes</span></div>
          <div class="kpi atencao"><b>${fmt(e.lic_venc6)}</b><span>licenças vencem em até 6 meses</span></div>
          <div class="kpi alerta"><b>${fmt(e.lic_vencidas)}</b><span>licenças vencidas sem renovação</span></div>
          <div class="kpi atencao"><b>${fmt(e.lic_agua_sem)}</b><span>atividades com consumo de água sem outorga de captação próxima</span></div>
          <div class="kpi"><b>${fmt(e.out_val)}</b><span>outorgas válidas (${fmt(e.out_sup)} captações superficiais, ${fmt(e.out_poco)} poços)</span></div>
          <div class="kpi atencao"><b>${fmt(e.out_venc6)}</b><span>outorgas vencem em até 6 meses</span></div>
          <div class="kpi alerta"><b>${fmt(e.out_vencidas)}</b><span>outorgas vencidas</span></div>
          <div class="kpi alerta"><b>${fmt(e.out_irreg)}</b><span>outorgas irregulares (IAT)</span></div>
        </div>
        ${e.top.length ? `<h3>Atividades mais licenciadas</h3><ol class="top">${e.top.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
        ${e.sem_coord || e.aprox ? `<p class="dica">${e.aprox ? `${fmt(e.aprox)} licença(s) sem coordenada no IAT foram localizadas de forma aproximada pela outorga de água do mesmo titular. ` : ''}${e.sem_coord ? `${fmt(e.sem_coord)} licença(s) vigente(s) sem coordenada aparecem só na lista.` : ''}</p>` : ''}
        <div class="baixar"><button id="csvLic">⬇ Planilha de licenças</button><button id="csvOut">⬇ Planilha de outorgas</button></div>
        <div class="abas"><button data-a="lic" class="${aba === 'lic' ? 'on' : ''}">Licenças (${fmt(d.lic.length)})</button><button data-a="out" class="${aba === 'out' ? 'on' : ''}">Outorgas (${fmt(d.out.length)})</button></div>
        <div class="filtros"><input id="fTexto" placeholder="Filtrar por titular, atividade, nº…"><select id="fSit"></select><select id="fTipo"></select></div>
        <div class="lista" id="lista"></div>`;
    document.getElementById('voltar').onclick = fecharMunicipio;
    el.querySelectorAll('.abas button').forEach(b => b.onclick = () => { aba = b.dataset.a; mostrar = 150; renderMunicipio(); });
    document.getElementById('csvLic').onclick = () => baixarCSV('lic'); document.getElementById('csvOut').onclick = () => baixarCSV('out');
    const L = aba === 'lic' ? d.lic : d.out, campoSit = aba === 'lic' ? 'si' : 'situ', campoTipo = aba === 'lic' ? 'g' : 'tipo';
    const opc = (sel, campo, rot) => { sel.innerHTML = `<option value="">${rot}</option>` + [...new Set(L.map(x => x[campo]))].sort().map(v => `<option>${esc(v)}</option>`).join(''); };
    const fSit = document.getElementById('fSit'), fTipo = document.getElementById('fTipo'), fTexto = document.getElementById('fTexto');
    opc(fSit, campoSit, 'Todas as situações'); opc(fTipo, campoTipo, 'Todos os tipos');
    if (aba === 'lic') fSit.insertAdjacentHTML('beforeend', '<option value="__agua">Consumo de água sem outorga próxima</option>');
    const desenhar = () => {
        const t = fTexto.value.trim().toLowerCase(), s = fSit.value, g = fTipo.value;
        const F = L.filter(x => (!s || (s === '__agua' ? /Não localizada/.test(x.oc || '') : x[campoSit] === s)) && (!g || x[campoTipo] === g) &&
            (!t || JSON.stringify(x).toLowerCase().includes(t)));
        document.getElementById('lista').innerHTML = `<p class="rot">${fmt(F.length)} registro(s)</p>` + F.slice(0, mostrar).map((x, i) => aba === 'lic' ? itemLic(x, i) : itemOut(x, i)).join('') +
            (F.length > mostrar ? `<button class="mais" id="mais">Mostrar mais (${fmt(F.length - mostrar)} restantes)</button>` : '');
        document.querySelectorAll('#lista [data-xy]').forEach(b => b.onclick = () => { const xy = JSON.parse(b.dataset.xy); map.flyTo({ center: xy, zoom: 15 }); });
        const m = document.getElementById('mais'); if (m) m.onclick = () => { mostrar += 300; desenhar(); };
    };
    fTexto.oninput = desenhar; fSit.onchange = desenhar; fTipo.onchange = desenhar; desenhar();
}
const linkSGA = x => `${SGA}&numProtocolo=${String(x.p).replace(/\D/g, '')}&indSia=${x.sia ? 'true' : 'false'}`;
function itemLic(x) {
    return `<div class="item" style="border-left-color:${x.si === 'Vencida' ? '#9e9e9e' : COR_LIC[x.g] || '#78909c'}">
        <div class="n">${esc(x.n)} ${tagSit(x.si)}</div>
        <div class="m">${esc(x.a)}${x.e && x.e !== x.a ? ' – ' + esc(x.e) : ''}</div>
        <div class="m">${esc(x.s)} nº ${esc(x.d)} · emissão ${esc(x.em) || '–'} · validade ${esc(x.va) || '–'}</div>
        ${x.oc ? `<div class="m">💧 Outorga de captação: ${esc(x.oc)}</div>` : ''}
        <div class="acoes">${x.xy ? `<button data-xy="${esc(JSON.stringify(x.xy))}">📍 ver no mapa${x.lo ? ' (aprox.)' : ''}</button>` : '<span class="m">sem coordenada</span>'}<a href="${linkSGA(x)}" target="_blank" rel="noopener">📄 licença no SGA (PDF)</a><button class="btnEmp" data-nome="${esc(x.n)}" data-c="${dadosMun.cod}" data-p="${esc(x.p)}" ${x.xy ? `data-xy="${esc(JSON.stringify(x.xy))}"` : ''}>🔎 Raio X do empreendimento</button></div></div>`;
}
function itemOut(x) {
    return `<div class="item" style="border-left-color:${COR_OUT[x.tipo] || '#90a4ae'}">
        <div class="n">${esc(x.nome)} ${tagSit(x.situ)}</div>
        <div class="m">${esc(x.interf || x.tipo)}${x.emp ? ' · ' + esc(x.emp) : ''}</div>
        <div class="m">${esc(x.doc)} nº ${esc(x.num) || '–'} · vencimento ${esc(x.venc) || '–'}${x.vazao ? ' · ' + esc(x.vazao) + ' m³/h' : ''}</div>
        ${x.fin ? `<div class="m">Finalidade: ${esc(x.fin)}</div>` : ''}
        <div class="acoes">${x.xy ? `<button data-xy="${esc(JSON.stringify(x.xy))}">📍 ver no mapa</button>` : '<span class="m">sem coordenada</span>'}<button class="btnEmp" data-nome="${esc(x.nome)}" data-c="${dadosMun.cod}" data-num="${esc(x.num || '')}" ${x.xy ? `data-xy="${esc(JSON.stringify(x.xy))}"` : ''}>🔎 Raio X do empreendimento</button></div></div>`;
}

// ---------------- Área CS: contatos criptografados (só abre com a senha da CS)
let CHAVE = null; const cacheCont = {};
const b64 = { de: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), para: u => btoa(String.fromCharCode(...new Uint8Array(u))) };
async function decifrar(buf, chave) {
    const u = new Uint8Array(buf);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, chave, u.slice(12))));
}
async function entrarArea(senha) {
    const cfg = await fetch('data/c/chave.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null);
    if (!cfg) throw new Error('Os contatos ainda não foram gerados.');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    const sal = Uint8Array.from(cfg.sal.match(/../g).map(h => parseInt(h, 16)));
    const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: cfg.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    try { await decifrar(await fetch('data/c/verifica.bin', { cache: 'no-cache' }).then(r => r.arrayBuffer()), k); } catch (e) { throw new Error('Senha incorreta.'); }
    CHAVE = k;
    try { sessionStorage.setItem('csChave', JSON.stringify({ k: b64.para(await crypto.subtle.exportKey('raw', k)), s: cfg.sal })); } catch (e) { }
    marcarArea();
}
function marcarArea() { const b = document.getElementById('btnArea'); b.textContent = CHAVE ? '🔓 Área CS (ativa)' : '🔒 Área CS'; b.classList.toggle('on', !!CHAVE); }
(async () => {
    try {
        const g = JSON.parse(sessionStorage.getItem('csChave') || 'null');
        const cfg = g && await fetch('data/c/chave.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null);
        if (g && cfg && cfg.sal === g.s) { CHAVE = await crypto.subtle.importKey('raw', b64.de(g.k), 'AES-GCM', false, ['decrypt']); marcarArea(); }
    } catch (e) { }
})();
document.getElementById('btnArea').onclick = () => {
    if (CHAVE) { if (confirmarSaida()) { CHAVE = null; try { sessionStorage.removeItem('csChave'); } catch (e) { } marcarArea(); } return; }
    document.getElementById('msgArea').textContent = ''; document.getElementById('dlgArea').showModal(); document.getElementById('senhaArea').focus();
};
function confirmarSaida() { return true; }
document.getElementById('cancArea').onclick = () => document.getElementById('dlgArea').close();
document.getElementById('formArea').addEventListener('submit', async e => {
    e.preventDefault(); const msg = document.getElementById('msgArea'); msg.textContent = 'Verificando…';
    try { await entrarArea(document.getElementById('senhaArea').value); document.getElementById('senhaArea').value = ''; document.getElementById('dlgArea').close(); }
    catch (err) { msg.textContent = err.message; }
});
async function contatosMun(cod) {
    if (!CHAVE) return null;
    if (!(cod in cacheCont)) cacheCont[cod] = fetch(`data/c/${cod}.bin`).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? decifrar(b, CHAVE) : null).catch(() => null);
    return cacheCont[cod];
}
async function htmlContato(cod, tipo, chave) {
    const d = await contatosMun(cod); if (!d) return '';
    const idx = (d[tipo] || {})[chave]; if (!idx || !idx.length) return '<div class="contato"><h5>🔒 Contato (uso interno CS)</h5>Empresa não localizada no cadastro da Receita.</div>';
    return idx.map(i => d.r[i]).map(c => {
        const lin = (k, v) => v ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '';
        if (c.tp === 'Pessoa física (PF)') return `<div class="contato"><h5>🔒 Uso interno CS</h5><b>Pessoa física (PF)</b> – sem dados de contato.</div>`;
        return `<div class="contato"><h5>🔒 Contato (uso interno CS) · prioridade ${esc(c.prio || '–')}</h5><table>${lin('Tipo', c.tp)}${lin('Razão social', c.rs)}${lin('Nome fantasia', c.nf)}
            ${lin('CNPJ', c.cnpj)}${lin('Situação na Receita', c.sit)}${lin('Endereço', [c.end, c.bai, c.cep].filter(Boolean).join(' – '))}${lin('Município', c.mun)}
            ${lin('Telefone', c.tel)}${c.email ? `<tr><td>E-mail</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td></tr>` : ''}${lin('Atividade (CNAE)', c.cnae)}${lin('Porte', c.porte)}
            ${lin('Oportunidades', c.oport)}</table></div>`;
    }).join('');
}

function popup(f, ll) {
    const p = f.properties, lin = (k, v) => v ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '';
    let h;
    if (f.layer.id.startsWith('lic')) h = `<div class="pop"><h4>${esc(p.n)}</h4><table>${lin('Atividade', p.a)}${lin('Atividade específica', p.e !== p.a ? p.e : '')}${lin('Modalidade', `${p.s} – ${p.g}`)}
        ${lin('Nº do documento', p.d)}${lin('Emissão', p.em)}${lin('Validade', p.va)}${lin('Situação', p.si)}${lin('Outorga de captação', p.oc)}${lin('Protocolo', p.p)}${lin('Localização', p.lo ? 'Aproximada – ponto da outorga de água do mesmo titular' : 'Cadastrada no licenciamento (IAT)')}</table>
        <a href="${linkSGA(p)}" target="_blank" rel="noopener">📄 Abrir a licença no SGA (PDF) ↗</a>${window.blocoEmitir ? blocoEmitir({ nome: p.n, c: p.c, p: p.p, xy: [ll.lng, ll.lat] }) : ''}</div>`;
    else h = `<div class="pop"><h4>${esc(p.nome)}</h4><table>${lin('Empreendimento', p.emp)}${lin('Tipo', p.interf || p.tipo)}${lin('Documento', p.doc)}${lin('Nº', p.num)}
        ${lin('Situação', p.situ + (p.st && p.st !== p.situ ? ` (${p.st})` : ''))}${lin('Publicação', p.pub)}${lin('Vencimento', p.venc)}${lin('Finalidade', p.fin)}
        ${lin('Vazão máxima', p.vazao ? p.vazao + ' m³/h' : '')}${lin('Corpo hídrico / aquífero', p.corpo)}${lin('Bacia', p.bacia)}${lin('Setor', p.setor)}</table>${window.blocoEmitir ? blocoEmitir({ nome: p.nome, c: p.c, num: p.num, xy: [ll.lng, ll.lat] }) : ''}</div>`;
    const pop = new mapboxgl.Popup({ maxWidth: '360px' }).setLngLat(ll).setHTML(h).addTo(map);
    if (CHAVE && p.c) {
        const lic = f.layer.id.startsWith('lic');
        htmlContato(String(p.c), lic ? 'l' : 'o', lic ? p.p : p.num).then(extra => { if (extra && pop.isOpen()) pop.setHTML(h.replace(/<\/div>$/, extra + '</div>')); });
    }
}

function baixarCSV(tipo) {
    const d = dadosMun, L = tipo === 'lic' ? d.lic : d.out;
    const col = tipo === 'lic'
        ? [['Titular', 'n'], ['Atividade', 'a'], ['Atividade específica', 'e'], ['Modalidade', 's'], ['Tipo', 'g'], ['Nº do documento', 'd'], ['Emissão', 'em'], ['Validade', 'va'], ['Situação', 'si'], ['Outorga de captação', 'oc'], ['Protocolo', 'p']]
        : [['Titular', 'nome'], ['Empreendimento', 'emp'], ['Tipo', 'interf'], ['Documento', 'doc'], ['Nº', 'num'], ['Situação', 'situ'], ['Situação no IAT', 'st'], ['Publicação', 'pub'], ['Vencimento', 'venc'], ['Finalidade', 'fin'], ['Vazão máx. (m³/h)', 'vazao'], ['Corpo hídrico / aquífero', 'corpo'], ['Bacia', 'bacia'], ['Setor', 'setor']];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [[...col.map(c => c[0]), 'Longitude', 'Latitude'].map(q).join(';')].concat(L.map(x => [...col.map(c => q(x[c[1]])), q(x.xy ? String(x.xy[0]).replace('.', ',') : ''), q(x.xy ? String(x.xy[1]).replace('.', ',') : '')].join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `${tipo === 'lic' ? 'licencas' : 'outorgas'}_${d.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_')}.csv`; a.click();
}

map.on('load', iniciar);
