import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto (funciona local e no Render)
const projectRoot = __dirname;

const app = express();
const PORT = process.env.PORT || 10000;

// Cache em memória para acelerar buscas
let cacheBase = null;
let ultimaAtualizacao = 0;
const CACHE_TIMEOUT = 60000; // 1 minuto

app.use(express.json());

// Arquivos estáticos (HTML, imagens, etc)
app.use(express.static(path.join(projectRoot, "public")));

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
  if (cacheBase && (agora - ultimaAtualizacao) < CACHE_TIMEOUT) {
    return cacheBase;
  }

  const csvPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.csv");
  const xlsxPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.xlsx");

  let produtos = [];

  // Prioridade para CSV
  if (fs.existsSync(csvPath)) {
    const conteudo = fs.readFileSync(csvPath, "utf8");
    const linhas = conteudo.split("\n").filter(l => l.trim());

    if (linhas.length === 0) return produtos;

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

    // Atualizar cache
    cacheBase = produtos;
    ultimaAtualizacao = agora;
    return produtos;
  }

  // Se não tiver CSV, tenta XLSX
  if (fs.existsSync(xlsxPath)) {
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

    // Atualizar cache
    cacheBase = produtos;
    ultimaAtualizacao = agora;
  }

  return produtos;
}

// -------------------------------------------
// BUSCA ONLINE – COSMOS (Bluesoft)
// -------------------------------------------
async function buscarCosmos(codigo) {
  try {
    const url = `https://api.cosmos.bluesoft.com.br/gtins/${codigo}`;
    const resposta = await axios.get(url, {
      headers: { "X-Cosmos-Token": "" } // coloque sua chave aqui se tiver
    });

    if (resposta.data && resposta.data.description) {
      return resposta.data.description;
    }
  } catch (err) {
    // Silencioso – só retorna null se der erro
  }
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

  // 1ª BASE LOCAL (Excel/CSV)
  const baseLocal = carregarBase();
  const encontradoLocal = baseLocal.find(p => p["cod de barra"] === codigo);

  if (encontradoLocal) {
    console.log("✅ Encontrado na base local");
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
      return res.json({
        ok: true,
        origem: "cosmos",
        produto: {
          "cod de barra": noCache.codigo,
          nome: noCache.nome
        }
      });
    }
  }

  // 3ª BUSCA ONLINE (Cosmos)
  console.log("🌐 Buscando no Cosmos...");
  const nomeOnline = await buscarCosmos(codigo);
  if (nomeOnline) {
    console.log("✅ Encontrado no Cosmos:", nomeOnline);
    salvarProduto(codigo, nomeOnline);
    return res.json({
      ok: true,
      origem: "cosmos",
      produto: {
        "cod de barra": codigo,
        nome: nomeOnline
      }
    });
  }

  // Nada encontrado
  console.log("❌ Produto não encontrado em nenhuma fonte");
  res.json({ ok: false, mensagem: "Produto não encontrado" });
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