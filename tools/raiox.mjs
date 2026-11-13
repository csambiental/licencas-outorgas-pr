#!/usr/bin/env node
// Raio X Ambiental da Área – linha de comando (usada pelo agente da CS no Claude e por quem quiser rodar localmente).
// Usa o MESMO motor do site (js/raiox.js) e a base publicada no ramo "dados" deste repositório.
//
// Exemplos:
//   node tools/raiox.mjs --lat -23.3045 --lon -51.1696 --raio 2000 --titulo "Raio X – Fazenda X" --cliente "Fazenda X" --finalidade Diagnóstico
//   node tools/raiox.mjs --kml area.kml --entorno 1000 --finalidade Entrega --anonimizar
//   CONTATOS_SENHA=... node tools/raiox.mjs --lat ... --lon ... --raio 3000 --finalidade Prospecção --contatos
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
if (args.kml) {
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
const cods = RaioX.municipiosDaArea(area, munGeo);
if (!cods.length) sair('nenhum município do PR na área');
const precisa = cods.map(c => `/m/${c}.json`).concat(args.contatos ? cods.map(c => `/c/${c}.bin`) : []);
git(`sparse-checkout add ${precisa.join(' ')}`);
const dados = cods.map(c => ler(`m/${c}.json`));

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
const r = RaioX.calcular(area, dados, munGeo, op);

if (args.contatos) {
    if (op.finalidade !== 'Prospecção') sair('--contatos só é permitido com --finalidade Prospecção (uso interno)');
    if (!process.env.CONTATOS_SENHA) sair('defina a variável CONTATOS_SENHA para incluir contatos');
    const k = await chave(process.env.CONTATOS_SENHA);
    try { await decifrar('c/verifica.bin', k); } catch (e) { sair('senha da Área CS incorreta'); }
    const C = {};
    for (const c of cods) { try { C[c] = await decifrar(`c/${c}.bin`, k); } catch (e) { C[c] = null; } }
    const pega = (cod, t, ch) => { const d = C[cod]; const i = d && (d[t] || {})[ch]; return i && i.length ? d.r[i[0]] : null; };
    r.lic.forEach(x => { x.ct = pega(x.cod, 'l', x.p); });
    r.out.forEach(x => { x.ct = pega(x.cod, 'o', x.num); });
    op.contatos = true;
}

// ---------------- saída
const pasta = args.saida || `raiox_${new Date().toISOString().slice(0, 10)}`;
fs.mkdirSync(pasta, { recursive: true });
const logo = path.join(AQUI, '..', 'logo.png');
op.logo = fs.existsSync(logo) ? 'data:image/png;base64,' + fs.readFileSync(logo).toString('base64') : '';
fs.writeFileSync(path.join(pasta, 'relatorio.html'), RaioX.relatorioHTML(r, op));
fs.writeFileSync(path.join(pasta, 'licencas.csv'), RaioX.csv(r, 'lic', op));
fs.writeFileSync(path.join(pasta, 'outorgas.csv'), RaioX.csv(r, 'out', op));
const semContato = JSON.parse(JSON.stringify(r, (k, v) => k === 'ct' ? undefined : v));
fs.writeFileSync(path.join(pasta, 'resultado.json'), JSON.stringify(semContato, null, 1));
console.log(JSON.stringify({ pasta: path.resolve(pasta), base: r.base, municipios: r.municipios, area: { ha: r.area.ha, centro: r.area.centro }, indicadores: r.k, comparacao: r.comp, achados: r.achados }, null, 1));
