# Licenças e Outorgas do Paraná

Mapa das **licenças ambientais do IAT (SGA/SIA)** e das **outorgas de água do SIGARH** de todos os municípios do Paraná – CS Consultoria Ambiental.

- Fontes públicas: IAT/GeoPR (licenciamento ambiental e outorgas), consulta pública do SGA e malha municipal do IBGE.
- CPF/CNPJ **não** são baixados nem publicados; titulares aparecem como nas consultas públicas.
- Atualização automática todo mês (workflow *Atualizar dados*); o site é publicado pelo workflow *Publicar site*.

## Raio X Ambiental da Área

Relatório de licenças e outorgas num **raio em torno de um ponto** ou num **polígono (KML) com entorno**: indicadores, achados classificados (fato, hipótese a verificar, interpretação), pontos de atenção, mapa, inventário e planilhas.

- **No site:** botão 🎯 *Raio X da área* → clicar no mapa (ou digitar coordenadas / carregar KML) → *Relatório (imprimir/PDF)*. Link direto: `?raiox=lat,lon,raio` (ex.: `?raiox=-23.3045,-51.1696,2000`).
- **Linha de comando / agente CS no Claude:** `node tools/raiox.mjs --lat -23.3045 --lon -51.1696 --raio 2000 --finalidade Diagnóstico` (ou `--kml area.kml --entorno 1000`). Gera `relatorio.html`, `resultado.json`, `licencas.csv` e `outorgas.csv`, baixando só os arquivos necessários do ramo `dados`.
- Finalidades: `Diagnóstico` (Ficha de Inteligência Prévia), `Entrega` (ao cliente; nomes de pessoas físicas omitidos) e `Prospecção` (uso interno; contatos só com a senha da Área CS em `CONTATOS_SENHA`).
- Site e linha de comando usam o **mesmo motor** (`js/raiox.js`), então os números são idênticos.

### Raio X do Empreendimento (análise unitária)

Clique num ponto do mapa ou num item da lista do município → **🔎 Raio X do empreendimento**. Reúne todas as licenças e outorgas do titular no Paraná (pelo nome normalizado; com a Área CS aberta, também pela raiz do CNPJ), separa as **unidades físicas** (pontos a até 500 m), monta a **matriz preliminar** com os mesmos IDs do Diagnóstico Ambiental Empresarial CS (LIC, AGU, EFL, EMI, CAD, RES, PAS, TER), calcula a **exposição preliminar** e sugere o **escopo do diagnóstico** e os documentos a pedir ao cliente.

Linha de comando: `node tools/raiox.mjs --titular "RAZÃO SOCIAL" --municipio Londrina [--lat .. --lon ..] [--so-municipio]` → `relatorio.html`, `resultado.json`, `empreendimento.csv`. Pessoa física exige `--municipio` (evita homônimos).
