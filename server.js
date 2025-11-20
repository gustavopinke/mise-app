import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import XLSX from "xlsx";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { buscarFotoR2, r2Habilitado } from "./r2-helper.js";

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto (funciona local e no Render)
const projectRoot = __dirname;

const app = express();
const PORT = process.env.PORT || 10000;

// Cache em memória otimizado (economizar RAM no Render)
let cacheBase = null;
let cacheBaseMap = null; // Índice Map para busca O(1)
let ultimaAtualizacao = 0;
const CACHE_TIMEOUT = 300000; // 5 minutos - cache mais longo, menos recargas

app.use(express.json());

// Arquivos estáticos (HTML, imagens, etc)
app.use(express.static(path.join(projectRoot, "public")));

// Servir fotos dos produtos
app.use("/fotos", express.static(path.join(projectRoot, "data", "fotos_produtos")));

// -------------------------------------------
// NORMALIZA CÓDIGO DE BARRAS (7.8913E+12 → 7891300000000)
// -------------------------------------------
function normalizarCodigo(valor) {
  if (!valor) return "";
  const str = String(valor).trim();

  if (str.toLowerCase().includes("e")) {
    const num = Number(str);
    return String(num.toFixed(0));
  }

  return str.replace(/\D/g, "");
}

// -------------------------------------------
// CARREGA BASE LOCAL (CSV ou XLSX) COM CACHE
// -------------------------------------------
function carregarBase() {
  const agora = Date.now();

  // Retorna cache se ainda válido
  if (cacheBase && cacheBaseMap && (agora - ultimaAtualizacao) < CACHE_TIMEOUT) {
    return { produtos: cacheBase, map: cacheBaseMap };
  }

  const csvPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.csv");
  const xlsxPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.xlsx");

  let produtos = [];

  // Prioridade para CSV
  if (fs.existsSync(csvPath)) {
    console.log("📂 Carregando base do CSV...");
    const conteudo = fs.readFileSync(csvPath, "utf8");
    const linhas = conteudo.split("\n").filter(l => l.trim());

    if (linhas.length === 0) {
      return { produtos: [], map: new Map() };
    }

    // Detectar delimitador (ponto e vírgula ou vírgula)
    const delimitador = linhas[0].includes(';') ? ';' : ',';
    const cabecalhos = linhas[0].split(delimitador).map(h => h.trim().toLowerCase());

    for (let i = 1; i < linhas.length; i++) {
      const colunas = linhas[i].split(delimitador);
      if (!colunas[0] || !colunas[0].trim()) continue;

      let obj = {};
      cabecalhos.forEach((cab, idx) => {
        obj[cab] = (colunas[idx] || "").trim();
      });

      // Normalizar código de barra
      const codigoOriginal = obj["cod. de barra"] || obj["cod de barra"] || obj["codigo de barra"] || obj["gtin"];
      obj["cod de barra"] = normalizarCodigo(codigoOriginal);

      if (obj["cod de barra"]) {
        produtos.push(obj);
      }
    }

    // Criar índice Map para busca O(1)
    const map = new Map();
    produtos.forEach(produto => {
      const codigo = produto["cod de barra"];
      if (codigo) {
        map.set(codigo, produto);
      }
    });

    // Atualizar cache
    cacheBase = produtos;
    cacheBaseMap = map;
    ultimaAtualizacao = agora;

    console.log(`✅ Base carregada: ${produtos.length} produtos indexados`);
    return { produtos, map };
  }

  // Se não tiver CSV, tenta XLSX
  if (fs.existsSync(xlsxPath)) {
    console.log("📂 Carregando base do XLSX...");
    const workbook = XLSX.readFile(xlsxPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sheet);

    linhas.forEach(l => {
      let p = {};
      for (const key in l) {
        const keyLower = key.toString().toLowerCase().trim();
        p[keyLower] = String(l[key] ?? "").trim();
      }

      // Normalizar código de barra
      const codigoOriginal = p["cod. de barra"] || p["cod de barra"] || p["codigo de barra"] || p["gtin"];
      p["cod de barra"] = normalizarCodigo(codigoOriginal);

      if (p["cod de barra"]) {
        produtos.push(p);
      }
    });

    // Criar índice Map para busca O(1)
    const map = new Map();
    produtos.forEach(produto => {
      const codigo = produto["cod de barra"];
      if (codigo) {
        map.set(codigo, produto);
      }
    });

    // Atualizar cache
    cacheBase = produtos;
    cacheBaseMap = map;
    ultimaAtualizacao = agora;

    console.log(`✅ Base carregada: ${produtos.length} produtos indexados`);
  }

  return { produtos, map: cacheBaseMap || new Map() };
}

// -------------------------------------------
// BUSCA FOTO DO PRODUTO (LOCAL)
// -------------------------------------------
function buscarFotoLocal(codigo) {
  const fotosDir = path.join(projectRoot, "data", "fotos_produtos");

  if (!fs.existsSync(fotosDir)) {
    return null;
  }

  try {
    const arquivos = fs.readdirSync(fotosDir);
    const codigoNormalizado = normalizarCodigo(codigo).toLowerCase();

    // Procurar arquivo que comece com o código de barras
    const foto = arquivos.find(arquivo => {
      // Ignorar arquivos ocultos
      if (arquivo.startsWith('.')) return false;

      const nomeArquivo = arquivo.toLowerCase();
      const extensoesValidas = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

      // Verificar se tem extensão válida
      const temExtensaoValida = extensoesValidas.some(ext => nomeArquivo.endsWith(ext));
      if (!temExtensaoValida) return false;

      // Aceitar formatos: codigo.ext ou codigo_*.ext
      return nomeArquivo.startsWith(codigoNormalizado);
    });

    return foto || null;
  } catch (err) {
    console.error("❌ Erro ao buscar foto local:", err);
    return null;
  }
}

// -------------------------------------------
// BUSCA FOTO DO PRODUTO (R2 + LOCAL FALLBACK)
// -------------------------------------------
async function buscarFoto(codigo) {
  console.log(`🔍 Buscando foto para código ${codigo}...`);

  // 1. Tentar buscar do R2 (se configurado)
  if (r2Habilitado()) {
    console.log("☁️  Tentando buscar foto do R2...");
    const fotoR2 = await buscarFotoR2(codigo);

    if (fotoR2) {
      console.log(`✅ Foto encontrada no R2: ${fotoR2.filename}`);
      return {
        fonte: 'r2',
        url: fotoR2.url,
        filename: fotoR2.filename
      };
    }
    console.log("❌ Foto não encontrada no R2");
  }

  // 2. Fallback: buscar localmente
  console.log("📁 Tentando buscar foto localmente...");
  const fotoLocal = buscarFotoLocal(codigo);

  if (fotoLocal) {
    console.log(`✅ Foto encontrada localmente: ${fotoLocal}`);
    return {
      fonte: 'local',
      url: `/fotos/${fotoLocal}`,
      filename: fotoLocal
    };
  }

  console.log(`❌ Nenhuma foto encontrada para código ${codigo}`);
  return null;
}

// -------------------------------------------
// LIMPAR NOME DO PRODUTO
// -------------------------------------------
function limparNome(nome) {
  if (!nome) return "";
  nome = nome.trim();

  // Remover tudo após separadores comuns
  const separadores = [" | ", " - ", " — ", " – "];
  for (const sep of separadores) {
    if (nome.includes(sep)) {
      nome = nome.split(sep)[0].trim();
    }
  }

  return nome;
}

// -------------------------------------------
// BUSCA ONLINE – COSMOS (Bluesoft) COM SCRAPING
// -------------------------------------------
async function buscarCosmos(codigo) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌐 INICIANDO BUSCA NO COSMOS");
  console.log(`📋 Código: ${codigo}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Lista de URLs para tentar (ordem de prioridade)
  const urls = [
    `https://cosmos.bluesoft.com.br/produtos/${codigo}`,
    `https://api.cosmos.bluesoft.com.br/gtins/${codigo}`
  ];

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://cosmos.bluesoft.com.br/"
  };

  for (const url of urls) {
    try {
      console.log(`\n🔗 Tentando URL [${urls.indexOf(url) + 1}/${urls.length}]:`, url);

      const resposta = await axios.get(url, {
        headers,
        timeout: 30000, // Aumentado para 30 segundos
        validateStatus: (status) => status < 500,
        maxRedirects: 5
      });

      console.log("📊 Status da resposta:", resposta.status);

      if (resposta.status === 404) {
        console.log("❌ Produto não encontrado nesta URL (404)");
        continue;
      }

      if (resposta.status !== 200) {
        console.log("⚠️ Status inesperado:", resposta.status);
        continue;
      }

      // Se a resposta for JSON (da API)
      if (resposta.headers['content-type']?.includes('application/json')) {
        const data = resposta.data;
        console.log("📦 Dados JSON recebidos");

        const nome = data.description ||
                     data.product_name ||
                     data.brand_name ||
                     data.name ||
                     (data.gtin && data.gtin.description) ||
                     null;

        if (nome) {
          const nomeLimpo = limparNome(nome);
          console.log("✅ Nome encontrado (JSON):", nomeLimpo);
          return nomeLimpo;
        }
      }

      // Se a resposta for HTML (scraping)
      if (resposta.headers['content-type']?.includes('text/html')) {
        console.log("📄 Fazendo scraping do HTML...");

        const $ = cheerio.load(resposta.data);
        let nome = null;

        // Método 1: span#product_description
        const prodDesc = $('span#product_description').text().trim();
        if (prodDesc) {
          nome = limparNome(prodDesc);
          console.log("✅ Nome encontrado (span#product_description):", nome);
          return nome;
        }

        // Método 2: meta tag og:title
        const ogTitle = $('meta[property="og:title"]').attr('content');
        if (ogTitle) {
          nome = limparNome(ogTitle);
          console.log("✅ Nome encontrado (og:title):", nome);
          return nome;
        }

        // Método 3: h1
        const h1Text = $('h1').first().text().trim();
        if (h1Text) {
          nome = limparNome(h1Text);
          console.log("✅ Nome encontrado (h1):", nome);
          return nome;
        }

        // Método 4: buscar em qualquer elemento com classe ou id relacionado
        const descricoes = [
          $('.product-description').text().trim(),
          $('.produto-nome').text().trim(),
          $('#product-name').text().trim(),
          $('.product-title').text().trim(),
          $('[itemprop="name"]').text().trim(),
          $('.card-title').text().trim(),
          $('.product-info h1').text().trim(),
          $('.product-info h2').text().trim(),
          $('meta[name="description"]').attr('content'),
          $('title').text().trim()
        ];

        for (const desc of descricoes) {
          if (desc) {
            nome = limparNome(desc);
            console.log("✅ Nome encontrado (elemento genérico):", nome);
            return nome;
          }
        }

        console.log("⚠️ HTML recebido mas nenhum nome encontrado");
        console.log("⚠️ Tentando buscar qualquer texto em elementos principais...");

        // Método 5: Buscar em divs ou sections com conteúdo relevante
        const textosEncontrados = [];
        $('div, section, article').each((i, elem) => {
          const texto = $(elem).text().trim();
          if (texto.length > 10 && texto.length < 200) {
            textosEncontrados.push(texto);
          }
        });

        if (textosEncontrados.length > 0) {
          console.log(`⚠️ Encontrados ${textosEncontrados.length} textos no HTML, usando o primeiro relevante`);
          // Usar o primeiro texto que pareça ser um nome de produto
          for (const texto of textosEncontrados) {
            if (texto && !texto.includes('Cookie') && !texto.includes('Login') && !texto.includes('Cadastr')) {
              nome = limparNome(texto);
              console.log("✅ Nome encontrado (busca genérica):", nome);
              return nome;
            }
          }
        }

        console.log("❌ Nenhum nome de produto encontrado no HTML");
      }

    } catch (err) {
      console.error(`\n❌ ERRO ao buscar em ${url}`);
      console.error("   Mensagem:", err.message);

      if (err.response) {
        console.error("   Status HTTP:", err.response.status);
        console.error("   Headers:", err.response.headers);
      }

      if (err.code === 'ECONNABORTED') {
        console.error("   ⏱️ TIMEOUT da requisição (30s)");
      } else if (err.code === 'ENOTFOUND') {
        console.error("   🌐 Servidor não encontrado / Sem internet");
      } else {
        console.error("   Código de erro:", err.code);
      }

      // Continuar tentando próxima URL
      console.log("   ⏭️ Tentando próxima URL...");
      continue;
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("❌ COSMOS: Produto NÃO encontrado");
  console.log("   Tentativas: " + urls.length + " URLs");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  return null;
}

// -------------------------------------------
// SALVA PRODUTOS ENCONTRADOS ONLINE NO EXCEL
// -------------------------------------------
function salvarProduto(codigo, nome) {
  const excelPath = path.join(projectRoot, "data", "OK BASE DO APP COLETADO.xlsx");
  const jsonPath = path.join(projectRoot, "data", "produtos.json");

  // Salvar no JSON (cache rápido)
  let lista = [];
  try {
    if (fs.existsSync(jsonPath)) {
      lista = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    }
  } catch (e) {
    lista = [];
  }

  if (!lista.find(x => x.codigo === codigo)) {
    lista.push({ codigo, nome });
    fs.writeFileSync(jsonPath, JSON.stringify(lista, null, 2));
  }

  // Salvar no Excel
  let workbook;
  let dados = [];

  // Tentar carregar Excel existente
  if (fs.existsSync(excelPath)) {
    try {
      workbook = XLSX.readFile(excelPath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      dados = XLSX.utils.sheet_to_json(sheet);
    } catch (e) {
      console.error("Erro ao ler Excel existente:", e);
      dados = [];
    }
  }

  // Verificar se produto já existe no Excel
  const jaExiste = dados.some(item => {
    const codigoExistente = normalizarCodigo(item["Código de Barra"] || item["codigo"] || item["Cod. de Barra"]);
    return codigoExistente === codigo;
  });

  if (!jaExiste) {
    // Adicionar novo produto
    dados.push({
      "Código de Barra": codigo,
      "Nome do Produto": nome,
      "Data de Coleta": new Date().toLocaleString("pt-BR")
    });

    // Criar nova planilha
    const novaSheet = XLSX.utils.json_to_sheet(dados);
    const novoWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(novoWorkbook, novaSheet, "Produtos Coletados");

    // Salvar arquivo
    XLSX.writeFile(novoWorkbook, excelPath);
    console.log("✅ Produto salvo no Excel:", codigo, "-", nome);
  }
}

// -------------------------------------------
// ROTA PRINCIPAL DE CONSULTA
// -------------------------------------------
app.get("/consulta/:codigo", async (req, res) => {
  const codigo = normalizarCodigo(req.params.codigo);
  if (!codigo || codigo.length < 8) {
    return res.json({ ok: false, mensagem: "Código inválido" });
  }

  console.log("🔍 Buscando código:", codigo);

  // 1ª BASE LOCAL (Excel/CSV) - Busca otimizada com Map O(1)
  const { map: baseLocalMap } = carregarBase();
  const encontradoLocal = baseLocalMap.get(codigo);

  if (encontradoLocal) {
    console.log("✅ Encontrado na base local");

    // Buscar foto do produto
    const foto = await buscarFoto(codigo);
    if (foto) {
      encontradoLocal.foto = foto;
    }

    return res.json({
      ok: true,
      origem: "local",
      produto: encontradoLocal
    });
  }

  // 2ª produtos.json (cache de buscas online anteriores)
  const jsonPath = path.join(projectRoot, "data", "produtos.json");
  if (fs.existsSync(jsonPath)) {
    const cache = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const noCache = cache.find(p => p.codigo === codigo);
    if (noCache) {
      console.log("✅ Encontrado no cache");

      // Buscar foto do produto
      const foto = await buscarFoto(codigo);

      return res.json({
        ok: true,
        origem: "cosmos",
        produto: {
          "cod de barra": noCache.codigo,
          nome: noCache.nome,
          foto: foto
        }
      });
    }
  }

  // 3ª BUSCA ONLINE (Cosmos)
  console.log("🌐 Buscando no Cosmos...");
  try {
    const nomeOnline = await buscarCosmos(codigo);
    if (nomeOnline) {
      console.log("✅ Encontrado no Cosmos:", nomeOnline);
      salvarProduto(codigo, nomeOnline);

      // Buscar foto do produto
      const foto = await buscarFoto(codigo);

      return res.json({
        ok: true,
        origem: "cosmos",
        produto: {
          "cod de barra": codigo,
          nome: nomeOnline,
          produto: nomeOnline,
          foto: foto
        }
      });
    }
  } catch (erroCosmosGenerico) {
    console.error("❌ Erro ao buscar no Cosmos:", erroCosmosGenerico);
  }

  // Nada encontrado
  console.log("❌ Produto não encontrado em nenhuma base");
  res.json({ ok: false, mensagem: "Produto não encontrado em nenhuma base (local, cache ou Cosmos)" });
});

// -------------------------------------------
// SPA – sempre entrega o index.html
// -------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(projectRoot, "public", "index.html"));
});

// -------------------------------------------
// INICIA O SERVIDOR
// -------------------------------------------
app.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" MISE Scanner rodando!");
  console.log(` Porta: ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});