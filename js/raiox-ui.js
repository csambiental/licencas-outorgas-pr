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

    // abrir direto por link: ?raiox=lat,lon,raio
    map.on('load', () => {
        const q = new URLSearchParams(location.search).get('raiox');
        if (!q) return;
        const [lat, lon, r] = q.split(',').map(Number);
        const tenta = () => { if (!MUNS) return setTimeout(tenta, 300); abrir(); if (r) document.getElementById('rxRaio').value = String(r); centro([lon, lat]); };
        tenta();
    });
})();
