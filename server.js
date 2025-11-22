import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import XLSX from "xlsx";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { buscarFotoR2, baixarFotoR2, r2Habilitado } from "./r2-helper.js";
import { uploadParaOneDrive, onedriveHabilitado, getOneDriveStatus } from "./onedrive-helper.js";

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto (funciona local e no Render)
const projectRoot = __dirname;

const app = express();
const PORT = process.env.PORT || 10000;

// -------------------------------------------
// BANCO DE DADOS SQLite
// -------------------------------------------
const DB_PATH = path.join(projectRoot, "data", "produtos.db");
let db = null;
let sqliteDisponivel = true;

function getDatabase() {
  if (!sqliteDisponivel) return null;

  if (!db) {
    // Verificar se o arquivo do banco existe
    if (!fs.existsSync(DB_PATH)) {
      console.log("⚠️ Banco SQLite não encontrado em:", DB_PATH);
      console.log("⚠️ Execute: node migrate-to-sqlite.js");
      return null;
    }

    try {
      // Verificar tamanho do arquivo
      const stats = fs.statSync(DB_PATH);
      console.log(`📂 Arquivo do banco encontrado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      // Tentar abrir o banco
      db = new Database(DB_PATH, { readonly: false });
      db.pragma('journal_mode = WAL');
      db.pragma('cache_size = 5000');

      // Testar se o banco funciona
      const teste = db.prepare('SELECT COUNT(*) as total FROM produtos').get();
      console.log(`✅ Banco SQLite conectado: ${teste.total.toLocaleString()} produtos`);
    } catch (err) {
      console.error("❌ Erro ao abrir SQLite:", err.message);
      console.log("⚠️ Usando fallback para CSV");
      sqliteDisponivel = false;
      db = null;
      return null;
    }
  }
  return db;
}

// Fallback para CSV caso SQLite não exista
let cacheBase = null;
let cacheBaseMap = null;
let ultimaAtualizacao = 0;
const CACHE_TIMEOUT = 300000;

app.use(express.json());

// Arquivos estáticos (HTML, imagens, etc)
app.use(express.static(path.join(projectRoot, "public")));

// Servir fotos dos produtos (locais)
app.use("/fotos", express.static(path.join(projectRoot, "data", "fotos_produtos")));

// -------------------------------------------
// PROXY PARA FOTOS DO R2 (serve fotos do Cloudflare R2)
// -------------------------------------------
app.get("/foto-r2/:filename", async (req, res) => {
  const { filename } = req.params;

  if (!filename) {
    return res.status(400).send("Nome do arquivo não informado");
  }

  try {
    const resultado = await baixarFotoR2(filename);

    if (!resultado) {
      return res.status(404).send("Foto não encontrada");
    }

    // Configurar headers de cache (1 hora)
    res.set({
      'Content-Type': resultado.contentType,
      'Cache-Control': 'public, max-age=3600',
    });

    // Fazer pipe do stream para a resposta
    resultado.stream.pipe(res);
  } catch (error) {
    console.error("Erro ao servir foto do R2:", error);
    res.status(500).send("Erro ao carregar foto");
  }
});

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
// BUSCA NO SQLite (Principal)
// -------------------------------------------
function buscarNoSQLite(codigo) {
  const database = getDatabase();
  if (!database) return null;

  try {
    // Buscar na tabela principal
    const stmt = database.prepare(`
      SELECT codigo_barras, produto, grupo, subgrupo, marca, categoria, ncm,
             unidade_medida, quantidade, peso_liquido, peso_bruto, preco_medio, fonte
      FROM produtos
      WHERE codigo_barras = ?
    `);
    const produto = stmt.get(codigo);

    if (produto) {
      return {
        "cod de barra": produto.codigo_barras,
        "produto": produto.produto,
        "grupo": produto.grupo,
        "subgrupo": produto.subgrupo,
        "marca": produto.marca,
        "categoria": produto.categoria,
        "ncm": produto.ncm,
        "unidade medida": produto.unidade_medida,
        "quantidade": produto.quantidade,
        "peso líquido": produto.peso_liquido,
        "peso bruto": produto.peso_bruto,
        "preço médio": produto.preco_medio,
        "fonte": produto.fonte || "local"
      };
    }

    return null;
  } catch (err) {
    console.error("Erro ao buscar no SQLite:", err);
    return null;
  }
}

// -------------------------------------------
// BUSCA CACHE ONLINE NO SQLite
// -------------------------------------------
function buscarCacheOnline(codigo) {
  const database = getDatabase();
  if (!database) return null;

  try {
    const stmt = database.prepare(`
      SELECT codigo_barras, nome, marca, categoria, fonte, data_coleta
      FROM produtos_online
      WHERE codigo_barras = ?
    `);
    const produto = stmt.get(codigo);

    if (produto) {
      return {
        "cod de barra": produto.codigo_barras,
        "produto": produto.nome,
        "nome": produto.nome,
        "marca": produto.marca || "",
        "categoria": produto.categoria || "",
        "fonte": produto.fonte
      };
    }

    return null;
  } catch (err) {
    console.error("Erro ao buscar cache online:", err);
    return null;
  }
}

// -------------------------------------------
// SALVAR PRODUTO ONLINE NO SQLite
// -------------------------------------------
function salvarProdutoOnlineSQLite(codigo, nome, marca, categoria, fonte) {
  const database = getDatabase();
  if (!database) return;

  try {
    const stmt = database.prepare(`
      INSERT OR REPLACE INTO produtos_online (codigo_barras, nome, marca, categoria, fonte, data_coleta)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(codigo, nome, marca || '', categoria || '', fonte);
    console.log(`✅ Produto salvo no SQLite: ${codigo} - ${nome} (fonte: ${fonte})`);
  } catch (err) {
    console.error("Erro ao salvar no SQLite:", err);
  }
}

// -------------------------------------------
// CARREGA BASE LOCAL (CSV ou XLSX) - FALLBACK
// -------------------------------------------
function carregarBase() {
  // Se SQLite existe, não precisamos do CSV
  if (fs.existsSync(DB_PATH)) {
    return { produtos: [], map: new Map() };
  }

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

    const delimitador = linhas[0].includes(';') ? ';' : ',';
    const cabecalhos = linhas[0].split(delimitador).map(h => h.trim().toLowerCase());

    for (let i = 1; i < linhas.length; i++) {
      const colunas = linhas[i].split(delimitador);
      if (!colunas[0] || !colunas[0].trim()) continue;

      let obj = {};
      cabecalhos.forEach((cab, idx) => {
        obj[cab] = (colunas[idx] || "").trim();
      });

      const codigoOriginal = obj["cod. de barra"] || obj["cod de barra"] || obj["codigo de barra"] || obj["gtin"];
      obj["cod de barra"] = normalizarCodigo(codigoOriginal);

      if (obj["cod de barra"]) {
        produtos.push(obj);
      }
    }

    const map = new Map();
    produtos.forEach(produto => {
      const codigo = produto["cod de barra"];
      if (codigo) {
        map.set(codigo, produto);
      }
    });

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

      const codigoOriginal = p["cod. de barra"] || p["cod de barra"] || p["codigo de barra"] || p["gtin"];
      p["cod de barra"] = normalizarCodigo(codigoOriginal);

      if (p["cod de barra"]) {
        produtos.push(p);
      }
    });

    const map = new Map();
    produtos.forEach(produto => {
      const codigo = produto["cod de barra"];
      if (codigo) {
        map.set(codigo, produto);
      }
    });

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

    const foto = arquivos.find(arquivo => {
      if (arquivo.startsWith('.')) return false;

      const nomeArquivo = arquivo.toLowerCase();
      const extensoesValidas = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

      const temExtensaoValida = extensoesValidas.some(ext => nomeArquivo.endsWith(ext));
      if (!temExtensaoValida) return false;

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
        url: `/foto-r2/${fotoR2.filename}`,
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

  const separadores = [" | ", " - ", " — ", " – "];
  for (const sep of separadores) {
    if (nome.includes(sep)) {
      nome = nome.split(sep)[0].trim();
    }
  }

  return nome;
}

// -------------------------------------------
// BUSCA ONLINE – OPEN FOOD FACTS (API gratuita)
// -------------------------------------------
async function buscarOpenFoodFacts(codigo) {
  console.log("🥫 Buscando no Open Food Facts...");

  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${codigo}.json`;
    const resposta = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "MISE-Scanner/1.0 (contact@mise.ws)"
      }
    });

    if (resposta.data && resposta.data.status === 1 && resposta.data.product) {
      const produto = resposta.data.product;
      const nome = produto.product_name_pt || produto.product_name || produto.generic_name || null;

      if (nome) {
        console.log("✅ Open Food Facts: Encontrado -", nome);
        return {
          nome: nome,
          codigo: codigo,
          marca: produto.brands || "",
          categoria: produto.categories || "",
          origem: "Open Food Facts"
        };
      }
    }
  } catch (err) {
    console.log("❌ Open Food Facts: Erro -", err.message);
  }

  return null;
}

// -------------------------------------------
// BUSCA ONLINE – OPEN BEAUTY FACTS (cosméticos)
// -------------------------------------------
async function buscarOpenBeautyFacts(codigo) {
  console.log("💄 Buscando no Open Beauty Facts...");

  try {
    const url = `https://world.openbeautyfacts.org/api/v2/product/${codigo}.json`;
    const resposta = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "MISE-Scanner/1.0 (contact@mise.ws)"
      }
    });

    if (resposta.data && resposta.data.status === 1 && resposta.data.product) {
      const produto = resposta.data.product;
      const nome = produto.product_name_pt || produto.product_name || produto.generic_name || null;

      if (nome) {
        console.log("✅ Open Beauty Facts: Encontrado -", nome);
        return {
          nome: nome,
          codigo: codigo,
          marca: produto.brands || "",
          categoria: produto.categories || "",
          origem: "Open Beauty Facts"
        };
      }
    }
  } catch (err) {
    console.log("❌ Open Beauty Facts: Erro -", err.message);
  }

  return null;
}

// -------------------------------------------
// BUSCA ONLINE – OPEN PET FOOD FACTS (ração/pet)
// -------------------------------------------
async function buscarOpenPetFoodFacts(codigo) {
  console.log("🐕 Buscando no Open Pet Food Facts...");

  try {
    const url = `https://world.openpetfoodfacts.org/api/v2/product/${codigo}.json`;
    const resposta = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "MISE-Scanner/1.0 (contact@mise.ws)"
      }
    });

    if (resposta.data && resposta.data.status === 1 && resposta.data.product) {
      const produto = resposta.data.product;
      const nome = produto.product_name_pt || produto.product_name || produto.generic_name || null;

      if (nome) {
        console.log("✅ Open Pet Food Facts: Encontrado -", nome);
        return {
          nome: nome,
          codigo: codigo,
          marca: produto.brands || "",
          categoria: produto.categories || "",
          origem: "Open Pet Food Facts"
        };
      }
    }
  } catch (err) {
    console.log("❌ Open Pet Food Facts: Erro -", err.message);
  }

  return null;
}

// -------------------------------------------
// BUSCA ONLINE – UPCITEMDB (banco de dados UPC/EAN)
// -------------------------------------------
async function buscarUPCItemDB(codigo) {
  console.log("🏷️ Buscando no UPCItemDB...");

  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${codigo}`;
    const resposta = await axios.get(url, {
      timeout: 10000,
      headers: {
        "Accept": "application/json",
        "User-Agent": "MISE-Scanner/1.0"
      }
    });

    if (resposta.data && resposta.data.code === "OK" && resposta.data.items && resposta.data.items.length > 0) {
      const item = resposta.data.items[0];
      const nome = item.title || item.description || null;

      if (nome) {
        console.log("✅ UPCItemDB: Encontrado -", nome);
        return {
          nome: nome,
          codigo: codigo,
          marca: item.brand || "",
          categoria: item.category || "",
          origem: "UPCItemDB"
        };
      }
    }
  } catch (err) {
    if (err.response && err.response.status === 429) {
      console.log("⚠️ UPCItemDB: Limite de requisições atingido");
    } else {
      console.log("❌ UPCItemDB: Erro -", err.message);
    }
  }

  return null;
}

// -------------------------------------------
// BUSCA EM TODAS AS FONTES ONLINE
// -------------------------------------------
async function buscarEmTodasFontes(codigo) {
  const [openFood, openBeauty, openPet, upcItem] = await Promise.all([
    buscarOpenFoodFacts(codigo).catch(() => null),
    buscarOpenBeautyFacts(codigo).catch(() => null),
    buscarOpenPetFoodFacts(codigo).catch(() => null),
    buscarUPCItemDB(codigo).catch(() => null)
  ]);

  return openFood || openBeauty || openPet || upcItem || null;
}

// -------------------------------------------
// BUSCA ONLINE – COSMOS (seguindo lógica do script Python)
// -------------------------------------------
async function buscarCosmos(codigo) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌐 INICIANDO BUSCA NO COSMOS");
  console.log(`📋 Código: ${codigo}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://cosmos.bluesoft.com.br/"
  };

  const urls = [
    `https://api.cosmos.bluesoft.com.br/produtos/${codigo}`,
    `https://cosmos.bluesoft.com.br/produtos/${codigo}`
  ];

  for (const url of urls) {
    try {
      console.log(`\n🔗 Tentando: ${url}`);

      const resposta = await axios.get(url, {
        headers,
        timeout: 20000,
        validateStatus: (status) => status < 500,
        maxRedirects: 5
      });

      console.log(`📊 Status: ${resposta.status}`);

      if (resposta.status !== 200) {
        console.log(`⚠️ Status ${resposta.status}, tentando próxima URL...`);
        continue;
      }

      const html = resposta.data;
      if (!html) continue;

      const $ = cheerio.load(html);
      let nome = null;

      const prodDesc = $('span#product_description').text().trim();
      if (prodDesc) {
        nome = limparNome(prodDesc);
        console.log("✅ Nome encontrado (span#product_description):", nome);
      }

      if (!nome) {
        const ogTitle = $('meta[property="og:title"]').attr('content');
        if (ogTitle && ogTitle.trim()) {
          nome = limparNome(ogTitle);
          console.log("✅ Nome encontrado (og:title):", nome);
        }
      }

      if (!nome) {
        const h1Text = $('h1').first().text().trim();
        if (h1Text) {
          nome = limparNome(h1Text);
          console.log("✅ Nome encontrado (h1):", nome);
        }
      }

      if (nome && nome !== "-") {
        return { nome: nome, codigo: codigo, origem: "Cosmos" };
      }

    } catch (err) {
      console.log(`❌ Erro em ${url}: ${err.message}`);
      continue;
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("❌ COSMOS: Produto NÃO encontrado");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  return null;
}

// -------------------------------------------
// SALVA PRODUTOS ENCONTRADOS ONLINE NO EXCEL
// -------------------------------------------
function salvarProduto(codigo, nome, fonte) {
  console.log(`\n📝 SALVANDO PRODUTO ONLINE:`);
  console.log(`   Código: ${codigo}`);
  console.log(`   Nome: ${nome}`);
  console.log(`   Fonte: ${fonte}`);

  const excelPath = path.join(projectRoot, "data", "OK BASE DO APP COLETADO.xlsx");
  const jsonPath = path.join(projectRoot, "data", "produtos.json");

  // Salvar no JSON (cache rápido)
  try {
    let lista = [];
    try {
      if (fs.existsSync(jsonPath)) {
        const conteudo = fs.readFileSync(jsonPath, "utf8");
        lista = JSON.parse(conteudo);
        if (!Array.isArray(lista)) lista = [];
      }
    } catch (e) {
      console.warn("⚠️ Erro ao ler JSON, criando novo:", e.message);
      lista = [];
    }

    if (!lista.find(x => x.codigo === codigo)) {
      lista.push({ codigo, nome, fonte, data: new Date().toISOString() });
      fs.writeFileSync(jsonPath, JSON.stringify(lista, null, 2));
      console.log(`✅ Produto salvo no JSON cache`);
    }
  } catch (errJson) {
    console.error("❌ Erro ao salvar no JSON:", errJson.message);
  }

  // Salvar no SQLite também
  try {
    salvarProdutoOnlineSQLite(codigo, nome, '', '', fonte);
  } catch (errSqlite) {
    console.error("❌ Erro ao salvar no SQLite:", errSqlite.message);
  }

  // Salvar no Excel
  try {
    let dados = [];

    if (fs.existsSync(excelPath)) {
      try {
        const workbook = XLSX.readFile(excelPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        dados = XLSX.utils.sheet_to_json(sheet);
        if (!Array.isArray(dados)) dados = [];
      } catch (e) {
        console.warn("⚠️ Erro ao ler Excel existente, criando novo:", e.message);
        dados = [];
      }
    }

    const jaExiste = dados.some(item => {
      const codigoExistente = normalizarCodigo(item["Código de Barra"] || item["codigo"] || item["Cod. de Barra"] || "");
      return codigoExistente === codigo;
    });

    if (!jaExiste) {
      dados.push({
        "Código de Barra": codigo,
        "Nome do Produto": nome,
        "Fonte": fonte,
        "Data de Coleta": new Date().toLocaleString("pt-BR")
      });

      const novaSheet = XLSX.utils.json_to_sheet(dados);

      // Ajustar largura das colunas
      novaSheet['!cols'] = [
        { wch: 18 }, // Código de Barra
        { wch: 50 }, // Nome do Produto
        { wch: 20 }, // Fonte
        { wch: 20 }  // Data de Coleta
      ];

      const novoWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(novoWorkbook, novaSheet, "Produtos Coletados");

      XLSX.writeFile(novoWorkbook, excelPath);
      console.log(`✅ Produto salvo no Excel: ${codigo} - ${nome} (fonte: ${fonte})`);

      if (onedriveHabilitado()) {
        uploadParaOneDrive(excelPath).catch(err => {
          console.error("⚠️ Erro ao sincronizar com OneDrive:", err.message);
        });
      }
    } else {
      console.log(`ℹ️ Produto já existe no Excel, não duplicando`);
    }
  } catch (errExcel) {
    console.error("❌ Erro ao salvar no Excel:", errExcel.message);
  }
}

// -------------------------------------------
// API BUSCA POR NOME (autocomplete) - SQLite
// -------------------------------------------
app.get("/api/buscar-por-nome/:termo", (req, res) => {
  const termo = (req.params.termo || "").toLowerCase().trim();

  if (!termo || termo.length < 2) {
    return res.json({ ok: true, produtos: [] });
  }

  console.log("🔍 Buscando produtos por nome:", termo);

  const database = getDatabase();

  // Se SQLite existe, usa ele
  if (database) {
    try {
      const stmt = database.prepare(`
        SELECT codigo_barras, produto, marca, categoria
        FROM produtos
        WHERE produto LIKE ?
        LIMIT 10
      `);
      const resultados = stmt.all(`%${termo}%`);

      console.log(`✅ Encontrados ${resultados.length} produtos para "${termo}"`);

      return res.json({
        ok: true,
        produtos: resultados.map(p => ({
          codigo: p.codigo_barras,
          nome: p.produto,
          marca: p.marca || "",
          categoria: p.categoria || ""
        }))
      });
    } catch (err) {
      console.error("Erro na busca por nome:", err);
    }
  }

  // Fallback para CSV
  const { produtos } = carregarBase();

  const resultados = produtos.filter(p => {
    const nome = (p.produto || p.nome || "").toLowerCase();
    return nome.includes(termo);
  }).slice(0, 10);

  console.log(`✅ Encontrados ${resultados.length} produtos para "${termo}"`);

  res.json({
    ok: true,
    produtos: resultados.map(p => ({
      codigo: p["cod de barra"] || p.codigo || "",
      nome: p.produto || p.nome || "",
      marca: p.marca || "",
      categoria: p.categoria || ""
    }))
  });
});

// -------------------------------------------
// ROTA PRINCIPAL DE CONSULTA
// -------------------------------------------
app.get("/consulta/:codigo", async (req, res) => {
  const codigo = normalizarCodigo(req.params.codigo);
  if (!codigo || codigo.length < 8) {
    return res.json({ ok: false, mensagem: "Código inválido" });
  }

  console.log("🔍 Buscando código:", codigo);

  // 1ª SQLITE (se disponível)
  const produtoSQLite = buscarNoSQLite(codigo);
  if (produtoSQLite) {
    console.log("✅ Encontrado no SQLite (base local)");

    const foto = await buscarFoto(codigo);
    if (foto) {
      produtoSQLite.foto = foto;
    }

    return res.json({
      ok: true,
      origem: "local",
      fonte: "Base Local",
      produto: produtoSQLite
    });
  }

  // 2ª CACHE ONLINE NO SQLITE
  const cacheOnline = buscarCacheOnline(codigo);
  if (cacheOnline) {
    console.log("✅ Encontrado no cache online (SQLite)");

    const foto = await buscarFoto(codigo);

    return res.json({
      ok: true,
      origem: "cache",
      fonte: cacheOnline.fonte,
      produto: {
        ...cacheOnline,
        foto: foto
      }
    });
  }

  // 3ª BASE LOCAL CSV (fallback se SQLite não existe)
  const { map: baseLocalMap } = carregarBase();
  const encontradoLocal = baseLocalMap.get(codigo);

  if (encontradoLocal) {
    console.log("✅ Encontrado na base local (CSV)");

    const foto = await buscarFoto(codigo);
    if (foto) {
      encontradoLocal.foto = foto;
    }

    return res.json({
      ok: true,
      origem: "local",
      fonte: "Base Local",
      produto: encontradoLocal
    });
  }

  // 4ª produtos.json (cache de buscas online anteriores)
  const jsonPath = path.join(projectRoot, "data", "produtos.json");
  if (fs.existsSync(jsonPath)) {
    const cache = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const noCache = cache.find(p => p.codigo === codigo);
    if (noCache) {
      console.log("✅ Encontrado no cache JSON");

      const foto = await buscarFoto(codigo);

      return res.json({
        ok: true,
        origem: "cache",
        fonte: noCache.fonte || "Cache",
        produto: {
          "cod de barra": noCache.codigo,
          nome: noCache.nome,
          foto: foto
        }
      });
    }
  }

  // 5ª BUSCA ONLINE - APIs abertas (Open Food Facts, UPCItemDB, etc.)
  console.log("🌐 Buscando em APIs abertas...");
  try {
    const resultadoAPIs = await buscarEmTodasFontes(codigo);
    if (resultadoAPIs && resultadoAPIs.nome) {
      console.log(`✅ Encontrado em ${resultadoAPIs.origem}:`, resultadoAPIs.nome);
      salvarProduto(codigo, resultadoAPIs.nome, resultadoAPIs.origem);

      const foto = await buscarFoto(codigo);

      return res.json({
        ok: true,
        origem: "online",
        fonte: resultadoAPIs.origem,
        produto: {
          "cod de barra": codigo,
          nome: resultadoAPIs.nome,
          produto: resultadoAPIs.nome,
          marca: resultadoAPIs.marca || "",
          categoria: resultadoAPIs.categoria || "",
          foto: foto
        }
      });
    }
  } catch (erroAPIs) {
    console.error("❌ Erro nas APIs abertas:", erroAPIs.message);
  }

  // 6ª BUSCA ONLINE - Cosmos (fallback, faz scraping de HTML)
  console.log("🌐 Buscando no Cosmos (fallback)...");
  try {
    const resultadoCosmos = await buscarCosmos(codigo);
    if (resultadoCosmos && resultadoCosmos.nome) {
      const nomeOnline = resultadoCosmos.nome;
      console.log("✅ Encontrado no Cosmos:", nomeOnline);
      salvarProduto(codigo, nomeOnline, "Cosmos");

      const foto = await buscarFoto(codigo);

      return res.json({
        ok: true,
        origem: "online",
        fonte: "Cosmos",
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

  // Nada encontrado em nenhuma fonte
  console.log("❌ Produto não encontrado em nenhuma base");
  res.json({ ok: false, mensagem: "Produto não encontrado em nenhuma base (local, cache, APIs abertas ou Cosmos)" });
});

// -------------------------------------------
// API INVENTÁRIO - Salvar produtos no Excel
// -------------------------------------------
app.post("/api/inventario", async (req, res) => {
  try {
    const { codigo, produto, quantidade, peso, dataHora } = req.body;

    if (!codigo) {
      return res.json({ ok: false, error: "Código de barras é obrigatório" });
    }

    const inventarioPath = path.join(projectRoot, "data", "Inventário.xlsx");
    let dados = [];

    if (fs.existsSync(inventarioPath)) {
      try {
        const workbook = XLSX.readFile(inventarioPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        dados = XLSX.utils.sheet_to_json(sheet);
      } catch (e) {
        console.error("Erro ao ler Inventário.xlsx:", e);
        dados = [];
      }
    }

    const codigoNormalizado = normalizarCodigo(codigo);
    const indexExistente = dados.findIndex(item => {
      const codigoItem = normalizarCodigo(item["Código de Barras"] || item["codigo"] || "");
      return codigoItem === codigoNormalizado;
    });

    let mensagem = "";
    if (indexExistente >= 0) {
      const qtdAnterior = parseInt(dados[indexExistente]["Quantidade"]) || 0;
      const qtdNova = parseInt(quantidade) || 1;
      dados[indexExistente]["Quantidade"] = qtdAnterior + qtdNova;
      dados[indexExistente]["Data/Hora"] = dataHora ? new Date(dataHora).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR");
      if (peso) {
        dados[indexExistente]["Peso (kg)"] = peso;
      }
      mensagem = `Quantidade atualizada: ${qtdAnterior} + ${qtdNova} = ${dados[indexExistente]["Quantidade"]}`;
      console.log(`📦 Inventário: Item existente atualizado - ${codigo} - Nova qtd: ${dados[indexExistente]["Quantidade"]}`);
    } else {
      dados.push({
        "Código de Barras": codigo,
        "Produto": produto || "",
        "Quantidade": quantidade || 1,
        "Peso (kg)": peso || "",
        "Data/Hora": dataHora ? new Date(dataHora).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR")
      });
      mensagem = "Produto adicionado ao inventário";
      console.log(`✅ Inventário: Novo item adicionado - ${codigo} - ${produto}`);
    }

    const novaSheet = XLSX.utils.json_to_sheet(dados);

    novaSheet['!cols'] = [
      { wch: 18 },
      { wch: 40 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 }
    ];

    const novoWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(novoWorkbook, novaSheet, "Inventário");

    XLSX.writeFile(novoWorkbook, inventarioPath);

    if (onedriveHabilitado()) {
      uploadParaOneDrive(inventarioPath)
        .catch(err => {
          console.error("⚠️ Erro ao sincronizar inventário com OneDrive:", err.message);
        });
    }

    res.json({
      ok: true,
      mensagem: mensagem,
      total: dados.length,
      atualizado: indexExistente >= 0,
      onedrive: onedriveHabilitado() ? "sincronizando" : "não configurado"
    });

  } catch (error) {
    console.error("❌ Erro ao salvar inventário:", error);
    res.json({ ok: false, error: error.message });
  }
});

// -------------------------------------------
// API ONEDRIVE - Status e sincronização
// -------------------------------------------

app.get("/api/onedrive/status", (req, res) => {
  res.json(getOneDriveStatus());
});

app.post("/api/onedrive/sincronizar", async (req, res) => {
  if (!onedriveHabilitado()) {
    return res.json({
      ok: false,
      error: "OneDrive não configurado. Configure as variáveis ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET e ONEDRIVE_REFRESH_TOKEN no arquivo .env"
    });
  }

  const inventarioPath = path.join(projectRoot, "data", "Inventário.xlsx");
  const okBasePath = path.join(projectRoot, "data", "OK BASE DO APP COLETADO.xlsx");

  const resultados = [];

  if (fs.existsSync(inventarioPath)) {
    const result = await uploadParaOneDrive(inventarioPath);
    resultados.push({ arquivo: "Inventário.xlsx", ...result });
  }

  if (fs.existsSync(okBasePath)) {
    const result = await uploadParaOneDrive(okBasePath);
    resultados.push({ arquivo: "OK BASE DO APP COLETADO.xlsx", ...result });
  }

  res.json({
    ok: true,
    mensagem: "Sincronização concluída",
    resultados
  });
});

// -------------------------------------------
// API ESTATÍSTICAS DO BANCO
// -------------------------------------------
app.get("/api/stats", (req, res) => {
  const database = getDatabase();

  if (!database) {
    return res.json({
      ok: false,
      usandoSQLite: false,
      mensagem: "SQLite não configurado. Execute: node migrate-to-sqlite.js"
    });
  }

  try {
    const totalProdutos = database.prepare('SELECT COUNT(*) as total FROM produtos').get();
    const totalOnline = database.prepare('SELECT COUNT(*) as total FROM produtos_online').get();

    res.json({
      ok: true,
      usandoSQLite: true,
      totalProdutos: totalProdutos.total,
      totalProdutosOnline: totalOnline.total
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err.message
    });
  }
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
  console.log(` Diretorio: ${projectRoot}`);
  console.log(` Banco: ${DB_PATH}`);

  // Verificar se SQLite está disponível
  try {
    const database = getDatabase();
    if (database) {
      const stats = database.prepare('SELECT COUNT(*) as total FROM produtos').get();
      const statsOnline = database.prepare('SELECT COUNT(*) as total FROM produtos_online').get();
      console.log(` SQLite: ${stats.total.toLocaleString()} produtos locais`);
      console.log(` Cache online: ${statsOnline.total.toLocaleString()} produtos`);
    } else {
      console.log(" SQLite: NAO CONFIGURADO");
      // Carregar CSV como fallback
      const { produtos } = carregarBase();
      console.log(` CSV Fallback: ${produtos.length.toLocaleString()} produtos`);
    }
  } catch (err) {
    console.error(" Erro ao verificar banco:", err.message);
    // Carregar CSV como fallback
    const { produtos } = carregarBase();
    console.log(` CSV Fallback: ${produtos.length.toLocaleString()} produtos`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});
