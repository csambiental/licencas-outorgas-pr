#!/usr/bin/env node
// Raio X Ambiental da Área – linha de comando (usada pelo agente da CS no Claude e por quem quiser rodar localmente).
// Usa o MESMO motor do site (js/raiox.js) e a base publicada no ramo "dados" deste repositório.
//
// Exemplos:
//   node tools/raiox.mjs --lat -23.3045 --lon -51.1696 --raio 2000 --titulo "Raio X – Fazenda X" --cliente "Fazenda X" --finalidade Diagnóstico
//   node tools/raiox.mjs --kml area.kml --entorno 1000 --finalidade Entrega --anonimizar
//   CONTATOS_SENHA=... node tools/raiox.mjs --lat ... --lon ... --raio 3000 --finalidade Prospecção --contatos
//   Raio X do EMPREENDIMENTO (análise unitária, pré-diagnóstico):
//   node tools/raiox.mjs --titular "LATICINIO EXEMPLO LTDA" [--municipio Londrina] [--lat .. --lon ..] [--cnpj 00000000000100] [--so-municipio]
//
// Saída (pasta --saida, padrão ./raiox_<data>): relatorio.html, resultado.json, licencas.csv, outorgas.csv
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { webcrypto as crypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname);
const RaioX = require(path.join(AQUI, '..', 'js', 'raiox.js'));
const REPO = 'https://github.com/csambiental/licencas-outorgas-pr.git';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2), v = process.argv[i + 1];
    if (!v || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; }
}
const sair = m => { console.error('Erro:', m); process.exit(1); };
if (args.ajuda || args.help) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 11).join('\n')); process.exit(0); }

// ---------------- área
let area;
const MODO_EMP = !!args.titular;
if (MODO_EMP) { /* análise unitária: área definida depois */ }
else if (args.kml) {
    const k = RaioX.lerKML(fs.readFileSync(args.kml, 'utf8'));
    if (!k.aneis.length) sair('nenhum polígono encontrado no KML');
    area = RaioX.area({ tipo: 'poligono', aneis: k.aneis, entorno: +(args.entorno || 0), nome: args.nome || k.nome });
} else {
    const lat = +args.lat, lon = +args.lon;
    if (!isFinite(lat) || !isFinite(lon)) sair('informe --lat e --lon (graus decimais) ou --kml');
    if (!(lat < -22.4 && lat > -27 && lon > -55 && lon < -47.9)) sair('o ponto está fora do Paraná (a base cobre só o PR)');
    area = RaioX.area({ tipo: 'circulo', centro: [lon, lat], raio: +(args.raio || 2000), nome: args.nome || '' });
}

// ---------------- base (ramo "dados"): clone parcial, só os arquivos necessários
const BASE = args.base || path.join(process.env.HOME || '/tmp', '.cache', 'raiox-base');
const git = (c, cwd = BASE) => execSync(`git ${c}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
if (!fs.existsSync(path.join(BASE, '.git'))) {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    execSync(`git clone -q --depth 1 --filter=blob:none --sparse -b dados ${REPO} "${BASE}"`, { stdio: 'inherit' });
    git('sparse-checkout set --no-cone /resumo.json /municipios.geojson /c/chave.json /c/verifica.bin');
} else if (!args['sem-atualizar']) {
    try { git('fetch -q --depth 1 origin dados'); git('reset -q --hard origin/dados'); } catch (e) { console.error('Aviso: não consegui atualizar a base; usando a cópia local.'); }
}
const ler = f => JSON.parse(fs.readFileSync(path.join(BASE, f), 'utf8'));
const munGeo = ler('municipios.geojson');
const addSparse = L => { if (L.length) git(`sparse-checkout add ${L.join(' ')}`); };
const carregar = cs => { addSparse(cs.filter(c => !fs.existsSync(path.join(BASE, 'm', c + '.json'))).map(c => `/m/${c}.json`)); return cs.map(c => ler(`m/${c}.json`)); };
const semAc = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let cods, dados, ref = null;
if (MODO_EMP) {
    const pal = RaioX.palavras(args.titular);
    if (!pal.length) sair('nome do titular muito curto');
    addSparse([...new Set(pal.map(w => `/busca/w/${w.slice(0, 3)}.json`))].filter(f => !fs.existsSync(path.join(BASE, f))));
    let chaves = null;
    for (const w of pal) {
        const f = path.join(BASE, 'busca', 'w', w.slice(0, 3) + '.json');
        const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
        const st = new Set((d[w] || []).map(v => v.join('|')));
        chaves = chaves ? new Set([...chaves].filter(x => st.has(x))) : st;
    }
    cods = [...new Set([...chaves].map(k => k.split('|')[0]))];
    let codRef = '';
    if (args.municipio) {
        const m = munGeo.features.find(f => f.properties.cod === String(args.municipio) || semAc(f.properties.nome) === semAc(args.municipio));
        if (!m) sair('município não encontrado: ' + args.municipio);
        codRef = m.properties.cod;
    }
    if (!cods.length) sair('titular não encontrado na base: ' + args.titular);
    if (RaioX.provavelPF(args.titular) && !codRef) sair('titular parece pessoa física: informe --municipio para evitar homônimos');
    if (codRef && !cods.includes(codRef)) cods.push(codRef);
    if (args['so-municipio'] && codRef) cods = [codRef];
    ref = { nome: args.titular, cod: codRef || cods[0], xy: isFinite(+args.lat) && isFinite(+args.lon) && args.lat ? [+args.lon, +args.lat] : null };
    dados = carregar(cods);
} else {
    cods = RaioX.municipiosDaArea(area, munGeo);
    if (!cods.length) sair('nenhum município do PR na área');
    dados = carregar(cods);
}
if (args.contatos) addSparse(cods.map(c => `/c/${c}.bin`).filter(f => !fs.existsSync(path.join(BASE, f))));

// ---------------- contatos (uso interno; exige CONTATOS_SENHA)
async function chave(senha) {
    const cfg = ler('c/chave.json');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    const sal = Uint8Array.from(cfg.sal.match(/../g).map(h => parseInt(h, 16)));
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: cfg.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function decifrar(arq, k) {
    const u = new Uint8Array(fs.readFileSync(path.join(BASE, arq)));
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12))));
}

const op = {
    titulo: args.titulo || 'Raio X Ambiental da Área', cliente: args.cliente || '',
    finalidade: { prospeccao: 'Prospecção', 'prospecção': 'Prospecção', entrega: 'Entrega', diagnostico: 'Diagnóstico', 'diagnóstico': 'Diagnóstico' }[String(args.finalidade || 'diagnostico').toLowerCase()] || args.finalidade,
    anonimizar: !!args.anonimizar || String(args.finalidade || '').toLowerCase() === 'entrega'
};
// Área CS (senha em CONTATOS_SENHA): anexa o cadastro da Receita (CNPJ, CNAE, endereço) a cada registro; telefone e e-mail só saem em Prospecção
if (args.contatos) {
    if (!process.env.CONTATOS_SENHA) sair('defina a variável CONTATOS_SENHA para usar os dados da Área CS');
    const k = await chave(process.env.CONTATOS_SENHA);
    try { await decifrar('c/verifica.bin', k); } catch (e) { sair('senha da Área CS incorreta'); }
    for (const d of dados) {
        let C = null; try { C = await decifrar(`c/${d.cod}.bin`, k); } catch (e) { }
        const pega = (t, ch) => { const i = C && (C[t] || {})[ch]; return i && i.length ? C.r[i[0]] : null; };
        d.lic.forEach(x => { x.ct = pega('l', x.p); }); d.out.forEach(x => { x.ct = pega('o', x.num); });
    }
    op.contatos = op.finalidade === 'Prospecção';
}
let r;
if (MODO_EMP) {
    op.soMunicipio = !!args['so-municipio']; op.cnpj = args.cnpj || '';
    r = RaioX.empreendimento(ref, dados, munGeo, op);
    if (r.unidades.length) {   // vizinhos para o entorno de 1 km
        const viz = RaioX.municipiosDaArea(RaioX.area({ tipo: 'circulo', centro: r.unidades[0].decl.xy, raio: 500 }), munGeo).filter(c => !cods.includes(c));
        if (viz.length) { dados = dados.concat(carregar(viz)); cods = cods.concat(viz); r = RaioX.empreendimento(ref, dados, munGeo, op); }
    }
} else r = RaioX.calcular(area, dados, munGeo, op);

// ---------------- saída
const pasta = args.saida || `raiox_${new Date().toISOString().slice(0, 10)}`;
fs.mkdirSync(pasta, { recursive: true });
const logo = path.join(AQUI, '..', 'logo.png');
op.logo = fs.existsSync(logo) ? 'data:image/png;base64,' + fs.readFileSync(logo).toString('base64') : '';
if (MODO_EMP) {
    // QR code e link de conferência apontam para o mesmo empreendimento na plataforma pública
    try { op.qrcode = require(path.join(AQUI, '..', 'js', 'vendor', 'qrcode.js')); } catch (e) { }
    const q = new URLSearchParams({ emp: ref.nome, m: ref.cod || '' }); if (ref.xy) q.set('xy', ref.xy.map(v => v.toFixed(5)).join(','));
    op.link = `https://csambiental.github.io/licencas-outorgas-pr/?${q}`;
    op.imgs = await RaioX.embutirImagens(r);
    if (!op.imgs.mapa) console.error('Aviso: imagem de satélite indisponível (sem acesso ao Mapbox); o relatório usa o croqui.');
    fs.writeFileSync(path.join(pasta, 'relatorio.html'), RaioX.relatorioEmpreendimentoHTML(r, op));
    fs.writeFileSync(path.join(pasta, 'empreendimento.csv'), RaioX.csvEmpreendimento(r));
    fs.writeFileSync(path.join(pasta, 'preenchimento_matriz.json'), JSON.stringify(RaioX.preenchimentoMatriz(r), null, 1));
} else {
    fs.writeFileSync(path.join(pasta, 'relatorio.html'), RaioX.relatorioHTML(r, op));
    fs.writeFileSync(path.join(pasta, 'licencas.csv'), RaioX.csv(r, 'lic', op));
    fs.writeFileSync(path.join(pasta, 'outorgas.csv'), RaioX.csv(r, 'out', op));
}
const semContato = JSON.parse(JSON.stringify(r, (k, v) => k === 'ct' ? undefined : v));
fs.writeFileSync(path.join(pasta, 'resultado.json'), JSON.stringify(semContato, null, 1));
console.log(JSON.stringify(MODO_EMP
    ? { pasta: path.resolve(pasta), base: r.base, titular: r.titular, vinculo: r.vinculo, municipios: r.municipios, unidades: r.unidades.map(u => ({ id: u.id, mun: u.mun, xy: u.xy, lic: u.lic, out: u.out })), indicadores: r.k, exposicao: r.exposicao, matriz: r.matriz.map(m => ({ id: m.id, st: m.st, risco: m.risco, evid: m.evid })), escopo: r.escopo.map(x => x.servico) }
    : { pasta: path.resolve(pasta), base: r.base, municipios: r.municipios, area: { ha: r.area.ha, centro: r.area.centro }, indicadores: r.k, comparacao: r.comp, achados: r.achados }, null, 1));
